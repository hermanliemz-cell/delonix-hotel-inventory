-- =====================================================================
-- Fase 6 — Opening Balance RPC + Orphan Cleanup RPC
-- =====================================================================
-- Tujuan:
--   1. Memindahkan semua direct write stock_movements / stock_balance dari
--      OpeningBalancePage.jsx ke server-side RPC agar Fase 6b REVOKE aman.
--   2. Menyediakan RPC untuk hapus orphan zero-balance rows dari ItemsPage.
--
-- Karakteristik:
--   - SECURITY DEFINER → bypass REVOKE terhadap role authenticated
--   - SET search_path = inventory, public, pg_temp
--   - Mengandalkan trigger fn_apply_stock_movement untuk auto-sync
--     stock_balance + strict over-issue check + balance_after stamping
--   - Setelah insert movements, memanggil run_reconciliation(p_org) sebagai
--     safety net untuk rebuild cache dari ledger.
--
-- Aman dijalankan berulang (CREATE OR REPLACE).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) fn_set_opening_balance
-- ---------------------------------------------------------------------
-- Menerima payload jsonb berisi daftar movement OB untuk satu kategori.
-- Flow:
--   a. Validasi organization_id & user ada
--   b. Hitung list item_id yang terdampak (dari p_movements)
--   c. DELETE semua stock_movements existing dengan reference_type=OPENING_BALANCE
--      untuk item-item tersebut (atomic replace)
--   d. INSERT stock_movements baru untuk setiap entry qty>0
--      - Trigger fn_apply_stock_movement akan auto-update stock_balance
--   e. PERFORM run_reconciliation() untuk rebuild cache dari ledger
--
-- Parameter p_movements (jsonb array) schema per item:
-- {
--   "item_id":        "<uuid>",
--   "warehouse_id":   "<uuid>",
--   "department_id":  "<uuid>" | null,
--   "quantity":       <numeric>,
--   "unit_cost":      <numeric>,
--   "reference_number": "<text>",
--   "notes":          "<text>"
-- }
-- Entry dengan quantity<=0 akan di-skip di INSERT (tapi affected_items
-- tetap dihitung supaya movement lama tetap dihapus = behaviour "edit to 0").
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inventory.fn_set_opening_balance(
  p_organization_id uuid,
  p_category_id     uuid,
  p_ob_date         date,
  p_movements       jsonb,
  p_created_by      uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = inventory, public, pg_temp
AS $$
DECLARE
  v_affected_items uuid[];
  v_ob_timestamp   timestamptz;
  v_mov            jsonb;
  v_inserted       integer := 0;
  v_deleted        integer := 0;
  v_qty            numeric;
BEGIN
  -- Guard
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'p_organization_id wajib diisi';
  END IF;

  IF p_movements IS NULL OR jsonb_typeof(p_movements) <> 'array' THEN
    RAISE EXCEPTION 'p_movements harus berupa jsonb array';
  END IF;

  -- Extract affected item IDs (termasuk yang qty=0, supaya OB lama terhapus)
  SELECT COALESCE(array_agg(DISTINCT (m->>'item_id')::uuid), ARRAY[]::uuid[])
    INTO v_affected_items
  FROM jsonb_array_elements(p_movements) AS m
  WHERE (m->>'item_id') IS NOT NULL;

  IF array_length(v_affected_items, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'noop',
      'message', 'tidak ada item terdampak',
      'deleted', 0,
      'inserted', 0
    );
  END IF;

  -- Timestamp OB = awal hari p_ob_date (UTC). Konsisten dgn perilaku lama
  -- yang pakai `obDate + 'T00:00:00'`.
  v_ob_timestamp := COALESCE(
    (p_ob_date::text || ' 00:00:00')::timestamptz,
    now()
  );

  -- Step 1: hapus semua OB movement lama untuk item-item ini.
  -- Trigger fn_revert_stock_movement akan auto-decrement stock_balance.
  DELETE FROM inventory.stock_movements
   WHERE organization_id = p_organization_id
     AND reference_type  = 'OPENING_BALANCE'
     AND item_id = ANY(v_affected_items);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- Step 2: insert movement baru untuk entry qty>0.
  -- Trigger fn_apply_stock_movement akan auto-update stock_balance +
  -- stamp balance_after + reject over-issue (tidak akan kena karena IN).
  FOR v_mov IN SELECT * FROM jsonb_array_elements(p_movements) LOOP
    v_qty := COALESCE((v_mov->>'quantity')::numeric, 0);
    IF v_qty > 0 THEN
      INSERT INTO inventory.stock_movements (
        organization_id,
        item_id,
        movement_type,
        quantity,
        unit_cost,
        total_cost,
        reference_type,
        reference_number,
        notes,
        warehouse_id,
        department_id,
        created_by,
        created_at
      ) VALUES (
        p_organization_id,
        (v_mov->>'item_id')::uuid,
        'IN',
        v_qty,
        COALESCE((v_mov->>'unit_cost')::numeric, 0),
        v_qty * COALESCE((v_mov->>'unit_cost')::numeric, 0),
        'OPENING_BALANCE',
        COALESCE(v_mov->>'reference_number', 'OB'),
        v_mov->>'notes',
        NULLIF(v_mov->>'warehouse_id','')::uuid,
        NULLIF(v_mov->>'department_id','')::uuid,
        p_created_by,
        v_ob_timestamp
      );
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  -- Step 3: safety-net reconciliation.
  -- Jika fungsi tidak ada, abaikan supaya test env tanpa Fase 8 tetap jalan.
  BEGIN
    PERFORM inventory.run_reconciliation(p_organization_id);
  EXCEPTION WHEN undefined_function THEN
    -- run_reconciliation belum terpasang; skip
    NULL;
  END;

  RETURN jsonb_build_object(
    'status',         'ok',
    'deleted',        v_deleted,
    'inserted',       v_inserted,
    'affected_items', array_length(v_affected_items, 1),
    'ob_date',        p_ob_date,
    'category_id',    p_category_id
  );
END;
$$;

COMMENT ON FUNCTION inventory.fn_set_opening_balance(uuid, uuid, date, jsonb, uuid) IS
  'Atomic Opening Balance setter. Replaces existing OB movements for affected items and inserts new ones. Trigger auto-syncs stock_balance. Runs reconciliation as safety net. Used by OpeningBalancePage main save flow (Fase 6).';

GRANT EXECUTE ON FUNCTION inventory.fn_set_opening_balance(uuid, uuid, date, jsonb, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 2) fn_delete_orphan_stock_balance
-- ---------------------------------------------------------------------
-- Dipakai ItemsPage saat hapus item: bersihkan baris stock_balance qty=0
-- yang sudah tidak ada referensi movement-nya.
--
-- Aman karena:
--   - Hanya menghapus baris dengan quantity = 0 (no data loss)
--   - Scope ketat ke (organization_id, item_id)
--   - Tidak menyentuh stock_movements
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inventory.fn_delete_orphan_stock_balance(
  p_organization_id uuid,
  p_item_id         uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = inventory, public, pg_temp
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF p_organization_id IS NULL OR p_item_id IS NULL THEN
    RAISE EXCEPTION 'p_organization_id dan p_item_id wajib diisi';
  END IF;

  DELETE FROM inventory.stock_balance
   WHERE organization_id = p_organization_id
     AND item_id         = p_item_id
     AND quantity        = 0;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION inventory.fn_delete_orphan_stock_balance(uuid, uuid) IS
  'Hapus orphan stock_balance rows (qty=0) untuk satu item. Dipakai ItemsPage saat delete item.';

GRANT EXECUTE ON FUNCTION inventory.fn_delete_orphan_stock_balance(uuid, uuid) TO authenticated;

-- =====================================================================
-- END Fase 6 RPC script
-- =====================================================================
