-- ============================================================
-- FIX TIMELINE RECONSTRUCT v2: Unit Cost + Stock Balance Avg Cost
-- Tanggal: 8 April 2026 (v2 — fixed GR reference_type)
-- Pendekatan: AVG COST PER ITEM (bukan per warehouse)
-- ============================================================
--
-- PERUBAHAN DARI v1:
-- - CRITICAL FIX: 'GOODS_RECEIVE' → 'GR' (sesuai database)
-- - Tambah guard: COALESCE(r.unit_cost, 0) > 0 pada WAC calc
--   agar GR dengan unit_cost=0 tidak menurunkan avg_cost
--
-- LATAR BELAKANG:
-- Fix v1 menggunakan 'GOODS_RECEIVE' sebagai reference_type,
-- padahal di database reference_type untuk Goods Receive adalah 'GR'.
-- Akibatnya 7 GR movements completely missed — tidak ikut WAC calc.
--
-- PRINSIP AKUNTANSI:
-- AVG COST melekat pada ITEM, bukan pada WAREHOUSE.
-- Warehouse hanya track lokasi & qty. Transfer antar warehouse
-- tidak mengubah avg_cost. Hanya PURCHASE yang mengubah avg_cost.
-- Purchase-type: GR, DIRECT_PURCHASE, OPENING_BALANCE
--
-- KEAMANAN:
-- - qty di stock_balance TIDAK BERUBAH
-- - Trigger fn_apply_stock_movement (INSERT) → TIDAK terpengaruh
-- - trg_block_stock_movement_update → sementara disabled, lalu re-enabled


-- ============================================================
-- STEP 0: PRE-CHECK (Jalankan terpisah, SEBELUM fix)
-- ============================================================

-- 0a: Total stock value SEBELUM fix
SELECT
  ROUND(SUM(total_value)::numeric, 2) AS total_stock_value_before,
  COUNT(*) AS total_sb_rows,
  COUNT(*) FILTER (WHERE quantity > 0) AS active_sb_rows
FROM inventory.stock_balance
WHERE organization_id = '979bd176-a71b-47c7-a4e1-e60227f9d728';

-- 0b: Cek apakah ada MISMATCH total_value vs qty*avg_cost
SELECT i.code, i.name, sb.quantity, sb.avg_cost, sb.total_value,
       ROUND(sb.quantity * sb.avg_cost, 2) as expected,
       sb.total_value - ROUND(sb.quantity * sb.avg_cost, 2) as diff
FROM inventory.stock_balance sb
JOIN inventory.items i ON sb.item_id = i.id
WHERE sb.organization_id = '979bd176-a71b-47c7-a4e1-e60227f9d728'
AND ABS(sb.total_value - ROUND(sb.quantity * sb.avg_cost, 2)) > 1
ORDER BY ABS(sb.total_value - ROUND(sb.quantity * sb.avg_cost, 2)) DESC;


-- ============================================================
-- STEP 1: TIMELINE RECONSTRUCT (Jalankan sebagai satu block)
-- ============================================================

DO $$
DECLARE
  v_org UUID := '979bd176-a71b-47c7-a4e1-e60227f9d728';
  r RECORD;
  v_total_qty NUMERIC := 0;
  v_avg NUMERIC := 0;
  v_prev_item UUID := NULL;
  v_moves_updated INT := 0;
  v_sb_updated INT := 0;
  v_rowcount INT;
BEGIN
  -- Disable immutability trigger
  ALTER TABLE inventory.stock_movements
    DISABLE TRIGGER trg_block_stock_movement_update;

  FOR r IN
    SELECT sm.id, sm.item_id, sm.movement_type,
           sm.reference_type, sm.quantity, sm.unit_cost, sm.created_at
    FROM inventory.stock_movements sm
    WHERE sm.organization_id = v_org
    ORDER BY sm.item_id, sm.created_at, sm.id
  LOOP
    -- New item? Save previous item's avg_cost to stock_balance
    IF v_prev_item IS DISTINCT FROM r.item_id THEN
      IF v_prev_item IS NOT NULL AND v_avg > 0 THEN
        UPDATE inventory.stock_balance
        SET avg_cost = ROUND(v_avg::numeric, 2),
            total_value = ROUND((quantity * v_avg)::numeric, 2),
            updated_at = NOW()
        WHERE organization_id = v_org AND item_id = v_prev_item
          AND ABS(avg_cost - ROUND(v_avg::numeric, 2)) > 0.01;
        GET DIAGNOSTICS v_rowcount = ROW_COUNT;
        v_sb_updated := v_sb_updated + v_rowcount;
      END IF;
      -- Reset for new item
      v_total_qty := 0; v_avg := 0;
      v_prev_item := r.item_id;
    END IF;

    -- Process movement
    IF r.movement_type = 'IN' THEN
      -- Purchase-type IN: recalculate WAC
      -- FIXED v2: 'GR' bukan 'GOODS_RECEIVE'
      IF r.reference_type IN ('GR', 'DIRECT_PURCHASE', 'OPENING_BALANCE') THEN
        -- Guard: hanya hitung WAC jika unit_cost > 0
        IF (v_total_qty + r.quantity) > 0 AND COALESCE(r.unit_cost, 0) > 0 THEN
          v_avg := ((v_total_qty * v_avg) + (r.quantity * r.unit_cost))
                   / (v_total_qty + r.quantity);
        END IF;
      END IF;
      v_total_qty := v_total_qty + r.quantity;
    ELSIF r.movement_type = 'OUT' THEN
      v_total_qty := GREATEST(v_total_qty - r.quantity, 0);
    END IF;

    -- Non-purchase movements: stamp current avg_cost if different
    IF r.reference_type NOT IN ('GR', 'DIRECT_PURCHASE', 'OPENING_BALANCE', 'ADJUSTMENT')
       AND v_avg > 0 AND ABS(COALESCE(r.unit_cost, 0) - v_avg) > 0.01
    THEN
      UPDATE inventory.stock_movements
      SET unit_cost = ROUND(v_avg::numeric, 2) WHERE id = r.id;
      GET DIAGNOSTICS v_rowcount = ROW_COUNT;
      v_moves_updated := v_moves_updated + v_rowcount;
    END IF;
  END LOOP;

  -- Handle last item
  IF v_prev_item IS NOT NULL AND v_avg > 0 THEN
    UPDATE inventory.stock_balance
    SET avg_cost = ROUND(v_avg::numeric, 2),
        total_value = ROUND((quantity * v_avg)::numeric, 2),
        updated_at = NOW()
    WHERE organization_id = v_org AND item_id = v_prev_item
      AND ABS(avg_cost - ROUND(v_avg::numeric, 2)) > 0.01;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    v_sb_updated := v_sb_updated + v_rowcount;
  END IF;

  -- Re-enable trigger
  ALTER TABLE inventory.stock_movements
    ENABLE TRIGGER trg_block_stock_movement_update;

  RAISE NOTICE 'TIMELINE RECONSTRUCT v2 COMPLETE';
  RAISE NOTICE 'Movement unit_costs updated: %', v_moves_updated;
  RAISE NOTICE 'Stock balance rows updated: %', v_sb_updated;
END;
$$;


-- ============================================================
-- STEP 2: POST-CHECK (Jalankan terpisah, SETELAH fix)
-- ============================================================

-- 2a: Total stock value SESUDAH fix (bandingkan dengan 0a)
SELECT
  ROUND(SUM(total_value)::numeric, 2) AS total_stock_value_after,
  COUNT(*) AS total_sb_rows,
  COUNT(*) FILTER (WHERE quantity > 0) AS active_sb_rows
FROM inventory.stock_balance
WHERE organization_id = '979bd176-a71b-47c7-a4e1-e60227f9d728';

-- 2b: Cek MISMATCH (harus 0 row)
SELECT i.code, i.name, sb.quantity, sb.avg_cost, sb.total_value,
       ROUND(sb.quantity * sb.avg_cost, 2) as expected,
       sb.total_value - ROUND(sb.quantity * sb.avg_cost, 2) as diff
FROM inventory.stock_balance sb
JOIN inventory.items i ON sb.item_id = i.id
WHERE sb.organization_id = '979bd176-a71b-47c7-a4e1-e60227f9d728'
AND ABS(sb.total_value - ROUND(sb.quantity * sb.avg_cost, 2)) > 1
ORDER BY i.code;

-- 2c: Spot check AMN-001
SELECT i.code, sm.reference_type, sm.reference_number, sm.movement_type,
       sm.quantity, sm.unit_cost, sm.created_at
FROM inventory.stock_movements sm
JOIN inventory.items i ON sm.item_id = i.id
WHERE i.code = 'AMN-001'
AND sm.organization_id = '979bd176-a71b-47c7-a4e1-e60227f9d728'
ORDER BY sm.created_at, sm.id;
