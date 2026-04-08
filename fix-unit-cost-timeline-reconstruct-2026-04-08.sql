-- ============================================================
-- FIX TIMELINE RECONSTRUCT: Unit Cost + Stock Balance Avg Cost
-- Tanggal: 8 April 2026
-- Pendekatan: AVG COST PER ITEM (bukan per warehouse)
-- ============================================================
--
-- LATAR BELAKANG:
-- Fix sebelumnya (6 April 2026) menggunakan CURRENT stock_balance
-- avg_cost untuk set unit_cost pada semua non-purchase movements.
-- Namun stock_balance avg_cost sendiri sudah CORRUPT karena trigger
-- bug lama (WAC dihitung untuk semua IN movements, bukan hanya purchases).
--
-- Contoh: AMN-001
-- - Opening Balance: 1,855 pcs @ Rp 2,000
-- - Tidak ada purchase lain
-- - stock_balance avg_cost = 945.33 (CORRUPT, seharusnya 2,000)
-- - Fix lama set semua consumption unit_cost = 945 (SALAH)
-- - Seharusnya semua unit_cost = 2,000
--
-- PRINSIP AKUNTANSI:
-- AVG COST melekat pada ITEM, bukan pada WAREHOUSE.
-- Warehouse hanya track lokasi & qty. Transfer antar warehouse
-- tidak mengubah avg_cost. Hanya PURCHASE yang mengubah avg_cost.
--
-- FIX INI:
-- 1. Reconstruct avg_cost timeline PER ITEM dari purchase movements
-- 2. Fix unit_cost pada non-purchase movements = avg_cost item saat itu
-- 3. Fix stock_balance avg_cost + total_value (SEMUA warehouse = same avg)
--
-- PERUBAHAN:
-- - stock_movements.unit_cost → diupdate untuk non-purchase movements
-- - stock_balance.avg_cost → diupdate ke nilai benar (SAME across warehouses)
-- - stock_balance.total_value → dihitung ulang (qty × new avg_cost)
-- - stock_balance.quantity → TIDAK BERUBAH
--
-- KEAMANAN:
-- - qty di stock_balance TIDAK berubah
-- - Trigger fn_apply_stock_movement (INSERT) → TIDAK terpengaruh
-- - Trigger fn_revert_stock_movement (DELETE) → TIDAK terpengaruh
-- - trg_block_stock_movement_update → sementara disabled, lalu re-enabled


-- ============================================================
-- STEP 0: PRE-CHECK (Jalankan terpisah, SEBELUM fix)
-- ============================================================

-- 0a: Total stock value SEBELUM fix (CATAT ANGKA INI!)
SELECT
  ROUND(SUM(total_value)::numeric, 2) AS total_stock_value_before,
  COUNT(*) AS total_sb_rows,
  COUNT(*) FILTER (WHERE quantity > 0) AS active_sb_rows
FROM inventory.stock_balance
WHERE organization_id = '979bd176-a71b-47c7-a4e1-e60227f9d728';


-- 0b: Items dengan avg_cost kemungkinan salah
--     (item single-price: mudah diverifikasi)
WITH single_purchase AS (
  SELECT sm.item_id, i.code,
    MIN(sm.unit_cost) AS purchase_price,
    COUNT(*) AS purchase_count
  FROM inventory.stock_movements sm
  JOIN inventory.items i ON sm.item_id = i.id
  WHERE sm.organization_id = '979bd176-a71b-47c7-a4e1-e60227f9d728'
    AND sm.reference_type IN ('GOODS_RECEIVE','DIRECT_PURCHASE','OPENING_BALANCE')
  GROUP BY sm.item_id, i.code
  HAVING COUNT(DISTINCT ROUND(sm.unit_cost::numeric, 0)) = 1
),
sb_avg AS (
  SELECT item_id,
    SUM(total_value) / NULLIF(SUM(quantity), 0) AS sb_avg_cost
  FROM inventory.stock_balance
  WHERE organization_id = '979bd176-a71b-47c7-a4e1-e60227f9d728'
  GROUP BY item_id
  HAVING SUM(quantity) > 0
)
SELECT sp.code, sp.purchase_count,
  ROUND(sp.purchase_price::numeric, 2) AS correct_avg,
  ROUND(sa.sb_avg_cost::numeric, 2) AS current_sb_avg,
  CASE WHEN ABS(sp.purchase_price - sa.sb_avg_cost) > 1
    THEN 'PERLU FIX' ELSE 'OK' END AS status
FROM single_purchase sp
JOIN sb_avg sa ON sp.item_id = sa.item_id
ORDER BY status DESC, sp.code;


-- 0c: AMN-001 specific — avg_cost harus 2000, bukan 945
SELECT i.code, w.name AS warehouse, sb.quantity, sb.avg_cost, sb.total_value
FROM inventory.stock_balance sb
JOIN inventory.items i ON sb.item_id = i.id
JOIN inventory.warehouses w ON sb.warehouse_id = w.id
WHERE sb.organization_id = '979bd176-a71b-47c7-a4e1-e60227f9d728'
  AND i.code = 'AMN-001';


-- 0d: Total movements yang akan dicek
SELECT
  COUNT(*) AS total_movements,
  COUNT(*) FILTER (WHERE reference_type IN ('GOODS_RECEIVE','DIRECT_PURCHASE','OPENING_BALANCE')) AS purchase_movements,
  COUNT(*) FILTER (WHERE reference_type = 'ADJUSTMENT') AS adjustment_movements,
  COUNT(*) FILTER (WHERE reference_type NOT IN ('GOODS_RECEIVE','DIRECT_PURCHASE','OPENING_BALANCE','ADJUSTMENT')) AS movements_to_check
FROM inventory.stock_movements
WHERE organization_id = '979bd176-a71b-47c7-a4e1-e60227f9d728';


-- ============================================================
-- STEP 1: RECONSTRUCT TIMELINE & FIX
-- ============================================================
-- JALANKAN SELURUHNYA DALAM SATU KALI RUN!
--
-- Logika:
-- 1. Loop semua movements per ITEM (bukan per warehouse), urut created_at
-- 2. Track running total_qty dan avg_cost per item
-- 3. Hanya PURCHASE movements yang mengubah avg_cost (WAC formula)
-- 4. Non-purchase movements: set unit_cost = avg_cost saat itu
-- 5. Update stock_balance: semua warehouse untuk item yang sama = avg_cost sama

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
  -- Disable update trigger
  ALTER TABLE inventory.stock_movements
    DISABLE TRIGGER trg_block_stock_movement_update;

  -- Process ALL movements per ITEM chronologically (across ALL warehouses)
  FOR r IN
    SELECT sm.id, sm.item_id, sm.movement_type,
           sm.reference_type, sm.quantity, sm.unit_cost, sm.created_at
    FROM inventory.stock_movements sm
    WHERE sm.organization_id = v_org
    ORDER BY sm.item_id, sm.created_at, sm.id
  LOOP
    -- New item → save previous item's final avg to stock_balance, then reset
    IF v_prev_item IS DISTINCT FROM r.item_id THEN
      IF v_prev_item IS NOT NULL AND v_avg > 0 THEN
        UPDATE inventory.stock_balance
        SET avg_cost = ROUND(v_avg::numeric, 2),
            total_value = ROUND((quantity * v_avg)::numeric, 2),
            updated_at = NOW()
        WHERE organization_id = v_org
          AND item_id = v_prev_item
          AND ABS(avg_cost - ROUND(v_avg::numeric, 2)) > 0.01;
        GET DIAGNOSTICS v_rowcount = ROW_COUNT;
        v_sb_updated := v_sb_updated + v_rowcount;
      END IF;

      v_total_qty := 0;
      v_avg := 0;
      v_prev_item := r.item_id;
    END IF;

    -- === Track qty dan avg ===
    IF r.movement_type = 'IN' THEN
      IF r.reference_type IN ('GOODS_RECEIVE', 'DIRECT_PURCHASE', 'OPENING_BALANCE') THEN
        -- PURCHASE: recalculate WAC based on TOTAL item qty
        IF (v_total_qty + r.quantity) > 0 THEN
          v_avg := (
            (v_total_qty * v_avg) + (r.quantity * r.unit_cost)
          ) / (v_total_qty + r.quantity);
        END IF;
      END IF;
      -- Non-purchase IN: avg tetap, qty bertambah
      v_total_qty := v_total_qty + r.quantity;

    ELSIF r.movement_type = 'OUT' THEN
      -- OUT: avg tetap, qty berkurang
      v_total_qty := GREATEST(v_total_qty - r.quantity, 0);
    END IF;

    -- === Update non-purchase movement unit_cost ===
    IF r.reference_type NOT IN (
         'GOODS_RECEIVE', 'DIRECT_PURCHASE', 'OPENING_BALANCE', 'ADJUSTMENT'
       )
       AND v_avg > 0
       AND ABS(COALESCE(r.unit_cost, 0) - v_avg) > 0.01
    THEN
      UPDATE inventory.stock_movements
      SET unit_cost = ROUND(v_avg::numeric, 2)
      WHERE id = r.id;
      v_moves_updated := v_moves_updated + 1;
    END IF;
  END LOOP;

  -- Handle last item
  IF v_prev_item IS NOT NULL AND v_avg > 0 THEN
    UPDATE inventory.stock_balance
    SET avg_cost = ROUND(v_avg::numeric, 2),
        total_value = ROUND((quantity * v_avg)::numeric, 2),
        updated_at = NOW()
    WHERE organization_id = v_org
      AND item_id = v_prev_item
      AND ABS(avg_cost - ROUND(v_avg::numeric, 2)) > 0.01;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    v_sb_updated := v_sb_updated + v_rowcount;
  END IF;

  -- Re-enable trigger
  ALTER TABLE inventory.stock_movements
    ENABLE TRIGGER trg_block_stock_movement_update;

  RAISE NOTICE '=== TIMELINE RECONSTRUCT COMPLETE ===';
  RAISE NOTICE 'Movement unit_costs updated: %', v_moves_updated;
  RAISE NOTICE 'Stock balance rows updated: %', v_sb_updated;
END;
$$;


-- ============================================================
-- STEP 2: POST-CHECK (Jalankan setelah STEP 1)
-- ============================================================

-- 2a: AMN-001 — avg_cost harus = 2000 di semua warehouse
SELECT i.code, w.name AS warehouse, sb.quantity,
  ROUND(sb.avg_cost::numeric, 2) AS avg_cost,
  ROUND(sb.total_value::numeric, 2) AS total_value,
  CASE WHEN ABS(sb.avg_cost - 2000) < 1 THEN 'PASS' ELSE 'FAIL' END AS check_result
FROM inventory.stock_balance sb
JOIN inventory.items i ON sb.item_id = i.id
JOIN inventory.warehouses w ON sb.warehouse_id = w.id
WHERE sb.organization_id = '979bd176-a71b-47c7-a4e1-e60227f9d728'
  AND i.code = 'AMN-001';


-- 2b: AMN-001 movements — semua non-purchase harus = 2000
SELECT
  ROUND(unit_cost::numeric, 2) AS unit_cost,
  reference_type,
  COUNT(*) AS cnt
FROM inventory.stock_movements
WHERE item_id = (
    SELECT id FROM inventory.items
    WHERE code = 'AMN-001'
      AND organization_id = '979bd176-a71b-47c7-a4e1-e60227f9d728'
    LIMIT 1
  )
  AND organization_id = '979bd176-a71b-47c7-a4e1-e60227f9d728'
GROUP BY ROUND(unit_cost::numeric, 2), reference_type
ORDER BY unit_cost DESC;


-- 2c: Total stock value SETELAH fix (bandingkan dengan 0a)
SELECT
  ROUND(SUM(total_value)::numeric, 2) AS total_stock_value_after,
  COUNT(*) AS total_sb_rows,
  COUNT(*) FILTER (WHERE quantity > 0) AS active_sb_rows
FROM inventory.stock_balance
WHERE organization_id = '979bd176-a71b-47c7-a4e1-e60227f9d728';


-- 2d: Verify trigger re-enabled
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgname = 'trg_block_stock_movement_update';


-- 2e: Cross-check — semua warehouse untuk item yang sama harus avg_cost sama
SELECT i.code,
  COUNT(DISTINCT ROUND(sb.avg_cost::numeric, 2)) AS distinct_avg_costs,
  MIN(ROUND(sb.avg_cost::numeric, 2)) AS min_avg,
  MAX(ROUND(sb.avg_cost::numeric, 2)) AS max_avg,
  CASE WHEN COUNT(DISTINCT ROUND(sb.avg_cost::numeric, 2)) <= 1
    THEN 'OK' ELSE 'MISMATCH' END AS status
FROM inventory.stock_balance sb
JOIN inventory.items i ON sb.item_id = i.id
WHERE sb.organization_id = '979bd176-a71b-47c7-a4e1-e60227f9d728'
  AND sb.quantity > 0
GROUP BY i.code
HAVING COUNT(DISTINCT ROUND(sb.avg_cost::numeric, 2)) > 1
ORDER BY i.code;
-- Expected: 0 rows (semua item avg_cost konsisten antar warehouse)


-- 2f: Spot check — items single-price tidak boleh menyimpang
WITH single_purchase AS (
  SELECT sm.item_id, i.code,
    MIN(sm.unit_cost) AS purchase_price
  FROM inventory.stock_movements sm
  JOIN inventory.items i ON sm.item_id = i.id
  WHERE sm.organization_id = '979bd176-a71b-47c7-a4e1-e60227f9d728'
    AND sm.reference_type IN ('GOODS_RECEIVE','DIRECT_PURCHASE','OPENING_BALANCE')
  GROUP BY sm.item_id, i.code
  HAVING COUNT(DISTINCT ROUND(sm.unit_cost::numeric, 0)) = 1
)
SELECT sp.code, sp.purchase_price,
  ROUND(sb.avg_cost::numeric, 2) AS sb_avg_cost,
  CASE WHEN ABS(sp.purchase_price - sb.avg_cost) > 1
    THEN 'FAIL' ELSE 'PASS' END AS check_result
FROM single_purchase sp
JOIN inventory.stock_balance sb ON sp.item_id = sb.item_id
  AND sb.organization_id = '979bd176-a71b-47c7-a4e1-e60227f9d728'
  AND sb.quantity > 0
WHERE ABS(sp.purchase_price - sb.avg_cost) > 1
ORDER BY sp.code;
-- Expected: 0 rows


-- ============================================================
-- ROLLBACK
-- ============================================================
-- Jika trigger tidak re-enable:
-- ALTER TABLE inventory.stock_movements
--   ENABLE TRIGGER trg_block_stock_movement_update;
--
-- Jika perlu revert, restore dari backup dan catat:
-- - Total stock value dari STEP 0a
-- - Backup trigger: file backup-fn_apply_stock_movement-ORIGINAL.sql
