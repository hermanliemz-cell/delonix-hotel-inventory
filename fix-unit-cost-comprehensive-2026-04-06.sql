-- ============================================================
-- FIX KOMPREHENSIF: UNIT_COST CORRUPTION + TRIGGER WAC
-- Tanggal: 6 April 2026 (eksekusi jam 02:00 WIB)
-- ============================================================
--
-- LATAR BELAKANG:
-- Trigger fn_apply_stock_movement menghitung ulang WAC (Weighted
-- Average Cost) untuk SEMUA movement type IN, padahal seharusnya
-- hanya untuk purchase-type (Goods Receive, Direct Purchase,
-- Opening Balance). Akibatnya setiap MAKEUP-DIRTY IN, TRANSFER IN,
-- LAUNDRY_RECEIVE IN, dll ikut mengubah avg_cost.
--
-- DAMPAK:
-- - 29 item terdampak dari total 53 item
-- - 8,041 stock_movements dengan unit_cost menyimpang
-- - Breakdown: MAKEUP-DIRTY 3,101 | MAKEUP-REPLACE 3,280 |
--   CONSUMPTION 964 | TRANSFER 423 | LAUNDRY 250 |
--   MAKEUP-HK 14 | RECONCILIATION 9
-- - stock_balance SUDAH BENAR (dari backup restore 5 Apr)
-- - Bincard display tercemar oleh unit_cost korup
--
-- FIX INI TERDIRI DARI 2 BAGIAN:
-- PART A: Fix trigger fn_apply_stock_movement
--         → WAC hanya dihitung ulang untuk purchase-type IN
-- PART B: Fix historical unit_cost di stock_movements
--         → Set unit_cost = avg_cost dari stock_balance (correct)
--
-- KEAMANAN:
-- - fn_apply_stock_movement (INSERT trigger) → TIDAK TERPENGARUH
--   oleh UPDATE kolom unit_cost
-- - fn_revert_stock_movement (DELETE trigger) → TIDAK TERPENGARUH
-- - stock_balance → TIDAK BERUBAH (hanya INSERT/DELETE trigger yg affect)
-- - Hanya kolom unit_cost pada stock_movements yang diubah
--
-- 29 ITEM TERDAMPAK:
-- ┌─────────┬──────────┬──────────────────────────────────────────┐
-- │ Code    │ Fix Rows │ Correct Avg Cost (IDR)                   │
-- ├─────────┼──────────┼──────────────────────────────────────────┤
-- │ LIN-007 │ 1,227    │ 415,824.37                               │
-- │ LIN-012 │ 1,189    │ 57,002.24                                │
-- │ LIN-041 │ 1,153    │ 247,662.16                               │
-- │ LIN-011 │   969    │ 27,164.94                                │
-- │ LIN-032 │   769    │ 40,000.00                                │
-- │ LIN-010 │   765    │ 96,000.00                                │
-- │ LIN-015 │   455    │ 209,325.14                               │
-- │ LIN-006 │   365    │ 343,725.91                               │
-- │ AMN-015 │   267    │ 1,700.46                                 │
-- │ AMN-001 │   182    │ 2,000.00                                 │
-- │ AMN-002 │   102    │ 1,221.00                                 │
-- │ AMN-004 │    98    │ 4,500.00                                 │
-- │ AMN-013 │    75    │ 1,350.00                                 │
-- │ AMN-003 │    69    │ 800.00                                   │
-- │ LIN-002 │    63    │ 328,440.00                               │
-- │ AMN-014 │    56    │ 265.00                                   │
-- │ LIN-013 │    43    │ 8,403.85                                 │
-- │ LIN-005 │    43    │ 550,000.00                               │
-- │ AMN-011 │    36    │ 275.00                                   │
-- │ AMN-010 │    34    │ 225.00                                   │
-- │ AMN-012 │    33    │ 210.00                                   │
-- │ LIN-029 │    13    │ 171,171.00                               │
-- │ LIN-014 │    11    │ 260,000.00                               │
-- │ LIN-031 │     9    │ 33,500.00                                │
-- │ AMN-017 │     4    │ 3,100.00                                 │
-- │ AMN-016 │     3    │ 210.00                                   │
-- │ LIN-030 │     3    │ 190,000.00                               │
-- │ AMN-022 │     3    │ 750.00                                   │
-- │ AMN-018 │     2    │ 800.00                                   │
-- ├─────────┼──────────┼──────────────────────────────────────────┤
-- │ TOTAL   │ 8,041    │                                          │
-- └─────────┴──────────┴──────────────────────────────────────────┘


-- ============================================================
-- STEP 0: PRE-CHECK (Jalankan terpisah, SEBELUM fix)
-- ============================================================

-- 0a. Hitung jumlah movements yang akan di-fix per reference_type
WITH correct_prices AS (
  SELECT item_id,
    SUM(total_value) / NULLIF(SUM(quantity), 0) AS correct_price
  FROM inventory.stock_balance
  WHERE organization_id = '979bd176-a71b-47c7-a4e1-e60227f9d728'
  GROUP BY item_id
  HAVING SUM(quantity) > 0
)
SELECT
  COUNT(*) AS total_rows_to_fix,
  COUNT(DISTINCT sm.item_id) AS items_affected,
  COUNT(*) FILTER (WHERE sm.reference_type = 'MAKEUP-DIRTY') AS makeup_dirty,
  COUNT(*) FILTER (WHERE sm.reference_type = 'MAKEUP-LINEN REPLACE') AS makeup_replace,
  COUNT(*) FILTER (WHERE sm.reference_type = 'CONSUMPTION') AS consumption,
  COUNT(*) FILTER (WHERE sm.reference_type LIKE 'TRANSFER%') AS transfer,
  COUNT(*) FILTER (WHERE sm.reference_type LIKE 'LAUNDRY%') AS laundry,
  COUNT(*) FILTER (WHERE sm.reference_type = 'MAKEUP-TO-HK') AS makeup_hk,
  COUNT(*) FILTER (WHERE sm.reference_type = 'RECONCILIATION') AS reconciliation
FROM inventory.stock_movements sm
JOIN correct_prices cp ON sm.item_id = cp.item_id
WHERE sm.organization_id = '979bd176-a71b-47c7-a4e1-e60227f9d728'
  AND sm.reference_type NOT IN ('GOODS_RECEIVE','DIRECT_PURCHASE','OPENING_BALANCE','ADJUSTMENT')
  AND ABS(sm.unit_cost - cp.correct_price) > 1;
-- Expected: total_rows_to_fix = 8041, items_affected = 29


-- ============================================================
-- STEP 1: SNAPSHOT stock_balance SEBELUM fix
-- ============================================================
-- Jalankan terpisah dari STEP 2 & 3

CREATE TEMP TABLE _sb_snapshot_before AS
SELECT sb.item_id, i.code, sb.warehouse_id, w.name AS wh_name,
  sb.quantity, sb.avg_cost, sb.total_value
FROM inventory.stock_balance sb
JOIN inventory.items i ON sb.item_id = i.id
JOIN inventory.warehouses w ON sb.warehouse_id = w.id
WHERE sb.organization_id = '979bd176-a71b-47c7-a4e1-e60227f9d728';


-- ============================================================
-- STEP 2 (PART A): FIX TRIGGER fn_apply_stock_movement
-- ============================================================
-- Modifikasi: WAC hanya dihitung ulang untuk purchase-type IN
-- (GOODS_RECEIVE, DIRECT_PURCHASE, OPENING_BALANCE)
-- Non-purchase IN → avg_cost tetap (v_old_avg)
--
-- JALANKAN TERPISAH (ini adalah CREATE OR REPLACE, aman)

CREATE OR REPLACE FUNCTION inventory.fn_apply_stock_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'pg_temp'
AS $function$
DECLARE
  v_sb_id    UUID;
  v_old_qty  NUMERIC;
  v_old_avg  NUMERIC;
  v_new_qty  NUMERIC;
  v_new_avg  NUMERIC;
  v_new_total NUMERIC;
BEGIN
  -- Validasi quantity
  IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
    RAISE EXCEPTION 'stock_movements.quantity harus > 0 (got %)', NEW.quantity;
  END IF;

  -- Lock dan baca stock_balance saat ini
  SELECT id, quantity, avg_cost
    INTO v_sb_id, v_old_qty, v_old_avg
  FROM inventory.stock_balance
  WHERE organization_id = NEW.organization_id
    AND item_id         = NEW.item_id
    AND warehouse_id    = NEW.warehouse_id
  FOR UPDATE;

  v_old_qty := COALESCE(v_old_qty, 0);
  v_old_avg := COALESCE(v_old_avg, 0);

  IF NEW.movement_type = 'IN' THEN
    v_new_qty := v_old_qty + NEW.quantity;

    IF v_new_qty > 0 THEN
      -- =====================================================
      -- FIX 2026-04-06: WAC hanya dihitung ulang untuk
      -- purchase-type IN movements. Non-purchase IN
      -- (MAKEUP, TRANSFER, LAUNDRY, CONSUMPTION, dll)
      -- mempertahankan avg_cost yang sudah ada.
      -- =====================================================
      IF NEW.reference_type IN ('GOODS_RECEIVE', 'DIRECT_PURCHASE', 'OPENING_BALANCE') THEN
        -- Purchase-type: hitung WAC baru
        v_new_avg := (
          (v_old_qty * v_old_avg)
          + (NEW.quantity * COALESCE(NEW.unit_cost, v_old_avg))
        ) / v_new_qty;
      ELSE
        -- Non-purchase: avg_cost tetap
        v_new_avg := v_old_avg;
      END IF;
    ELSE
      v_new_avg := 0;
    END IF;

  ELSIF NEW.movement_type = 'OUT' THEN
    v_new_qty := v_old_qty - NEW.quantity;
    IF v_new_qty < 0 THEN
      RAISE EXCEPTION 'Stok tidak cukup untuk OUT: item=% warehouse=% saldo=% diminta=%',
        NEW.item_id, NEW.warehouse_id, v_old_qty, NEW.quantity
        USING ERRCODE = 'check_violation';
    END IF;
    v_new_avg := v_old_avg;

  ELSE
    RAISE EXCEPTION 'Unknown movement_type: %', NEW.movement_type;
  END IF;

  v_new_total := v_new_qty * v_new_avg;

  -- Upsert stock_balance
  IF v_sb_id IS NOT NULL THEN
    UPDATE inventory.stock_balance
       SET quantity=v_new_qty, avg_cost=v_new_avg, total_value=v_new_total,
           department_id=COALESCE(NEW.department_id, department_id),
           last_movement_at=NOW(), updated_at=NOW(), last_updated=NOW()
     WHERE id = v_sb_id;
  ELSE
    INSERT INTO inventory.stock_balance (
      organization_id, item_id, warehouse_id, department_id,
      quantity, avg_cost, total_value,
      last_movement_at, updated_at, last_updated
    ) VALUES (
      NEW.organization_id, NEW.item_id, NEW.warehouse_id, NEW.department_id,
      v_new_qty, v_new_avg, v_new_total, NOW(), NOW(), NOW()
    );
  END IF;

  NEW.balance_after := v_new_qty;
  RETURN NEW;
END;
$function$;


-- ============================================================
-- STEP 3 (PART B): FIX HISTORICAL UNIT_COST
-- ============================================================
-- JALANKAN SEMUA DALAM SATU TRANSAKSI!
-- Disable trigger block → UPDATE unit_cost → Re-enable trigger

BEGIN;

  -- 3a. Disable trigger block UPDATE
  ALTER TABLE inventory.stock_movements
    DISABLE TRIGGER trg_block_stock_movement_update;

  -- 3b. Update unit_cost ke avg_cost yang benar (dari stock_balance)
  --     untuk SEMUA non-purchase movements yang menyimpang
  WITH correct_prices AS (
    SELECT item_id,
      SUM(total_value) / NULLIF(SUM(quantity), 0) AS correct_price
    FROM inventory.stock_balance
    WHERE organization_id = '979bd176-a71b-47c7-a4e1-e60227f9d728'
    GROUP BY item_id
    HAVING SUM(quantity) > 0
  )
  UPDATE inventory.stock_movements sm
  SET unit_cost = ROUND(cp.correct_price::numeric, 2)
  FROM correct_prices cp
  WHERE sm.item_id = cp.item_id
    AND sm.organization_id = '979bd176-a71b-47c7-a4e1-e60227f9d728'
    AND sm.reference_type NOT IN ('GOODS_RECEIVE','DIRECT_PURCHASE','OPENING_BALANCE','ADJUSTMENT')
    AND ABS(sm.unit_cost - cp.correct_price) > 1;

  -- 3c. Re-enable trigger block UPDATE
  ALTER TABLE inventory.stock_movements
    ENABLE TRIGGER trg_block_stock_movement_update;

COMMIT;


-- ============================================================
-- STEP 4: POST-CHECK (Verifikasi setelah fix)
-- ============================================================

-- 4a. Pastikan tidak ada lagi movements menyimpang
WITH correct_prices AS (
  SELECT item_id,
    SUM(total_value) / NULLIF(SUM(quantity), 0) AS correct_price
  FROM inventory.stock_balance
  WHERE organization_id = '979bd176-a71b-47c7-a4e1-e60227f9d728'
  GROUP BY item_id
  HAVING SUM(quantity) > 0
)
SELECT COUNT(*) AS remaining_wrong
FROM inventory.stock_movements sm
JOIN correct_prices cp ON sm.item_id = cp.item_id
WHERE sm.organization_id = '979bd176-a71b-47c7-a4e1-e60227f9d728'
  AND sm.reference_type NOT IN ('GOODS_RECEIVE','DIRECT_PURCHASE','OPENING_BALANCE','ADJUSTMENT')
  AND ABS(sm.unit_cost - cp.correct_price) > 1;
-- Expected: 0


-- 4b. Pastikan stock_balance TIDAK BERUBAH
SELECT
  CASE WHEN COUNT(*) = 0 THEN 'PASS - stock_balance TIDAK BERUBAH'
       ELSE 'FAIL - ' || COUNT(*) || ' baris berubah!'
  END AS stock_balance_check
FROM (
  SELECT b.code, b.wh_name,
    b.quantity AS qty_before, a.quantity AS qty_after,
    b.avg_cost AS avg_before, a.avg_cost AS avg_after,
    b.total_value AS val_before, a.total_value AS val_after
  FROM _sb_snapshot_before b
  JOIN inventory.stock_balance sb
    ON b.item_id = sb.item_id AND b.warehouse_id = sb.warehouse_id
  JOIN inventory.items a_i ON sb.item_id = a_i.id
  JOIN inventory.warehouses a_w ON sb.warehouse_id = a_w.id
  CROSS JOIN LATERAL (
    SELECT sb.quantity, sb.avg_cost, sb.total_value
  ) a
  WHERE b.quantity != a.quantity
     OR ROUND(b.avg_cost::numeric, 2) != ROUND(a.avg_cost::numeric, 2)
     OR ROUND(b.total_value::numeric, 2) != ROUND(a.total_value::numeric, 2)
) diff;
-- Expected: PASS - stock_balance TIDAK BERUBAH


-- 4c. Spot check LIN-012 bincard - max unit_cost
SELECT ROUND(unit_cost::numeric, 2) AS unit_cost, COUNT(*) AS cnt
FROM inventory.stock_movements
WHERE item_id = '342df13e-e0b9-4430-b5d3-6c85054d4dc7'
GROUP BY ROUND(unit_cost::numeric, 2)
ORDER BY unit_cost DESC
LIMIT 5;
-- Expected: max unit_cost sekitar 57,002


-- 4d. Spot check AMN-001 bincard - seharusnya semua unit_cost = 2000
SELECT ROUND(unit_cost::numeric, 2) AS unit_cost, COUNT(*) AS cnt
FROM inventory.stock_movements
WHERE item_id = 'a1cdb2ef-5781-4be6-a888-9b33fc7b9ed3'
GROUP BY ROUND(unit_cost::numeric, 2)
ORDER BY unit_cost DESC
LIMIT 5;
-- Expected: max unit_cost = 2000


-- 4e. Verifikasi trigger baru berfungsi
-- (Test ini HANYA untuk verifikasi, JANGAN jalankan di production)
-- Bisa di-test nanti di development environment:
--   INSERT movement MAKEUP-DIRTY IN → cek avg_cost tetap
--   INSERT movement GOODS_RECEIVE IN → cek avg_cost berubah


-- ============================================================
-- ROLLBACK (Jika ada masalah)
-- ============================================================

-- Jika STEP 3 gagal di tengah (trigger tidak re-enable):
-- ALTER TABLE inventory.stock_movements
--   ENABLE TRIGGER trg_block_stock_movement_update;

-- Jika trigger STEP 2 perlu di-rollback ke versi lama:
-- (Simpan output pg_get_functiondef SEBELUM menjalankan STEP 2)
-- CREATE OR REPLACE FUNCTION inventory.fn_apply_stock_movement()
-- ... [paste versi lama di sini] ...
