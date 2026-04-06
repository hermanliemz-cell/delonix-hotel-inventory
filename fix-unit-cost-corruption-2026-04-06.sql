-- ============================================================
-- FIX UNIT_COST CORRUPTION - Stock Movements
-- Tanggal: 6 April 2026 (eksekusi jam 02:00 WIB)
-- ============================================================
--
-- LATAR BELAKANG:
-- Bug di COALESCE(p_unit_cost, 0) pada RPC record_movement
-- menyebabkan WAC (Weighted Average Cost) membengkak secara
-- compounding pada movement MAKEUP-DIRTY dan MAKEUP-LINEN REPLACE
-- dari 31 Maret - 4 April 2026.
--
-- DAMPAK:
-- - 13 item terdampak
-- - 3,067 movement dengan unit_cost abnormal (> 2x avg_cost)
-- - stock_balance SUDAH BENAR (dari backup restore 4 Apr)
-- - Hanya bincard display yang menampilkan data korup
--
-- STRATEGI:
-- 1. Disable trigger block UPDATE (sementara)
-- 2. UPDATE unit_cost ke harga beli standar (receive_mode)
-- 3. Re-enable trigger
-- 4. Verifikasi
--
-- KEAMANAN:
-- - Trigger fn_apply_stock_movement (INSERT) -> TIDAK TERPENGARUH
-- - Trigger fn_revert_stock_movement (DELETE) -> TIDAK TERPENGARUH
-- - stock_balance -> TIDAK BERUBAH (hanya INSERT/DELETE trigger yg affect)
-- - Hanya kolom unit_cost yang diubah, kolom lain tetap
--
-- 13 ITEM TERDAMPAK:
-- ┌─────────┬──────────────────────────────────────────────┬──────────┬────────────┬───────────────┐
-- │ Code    │ Name                                         │ Corrupt  │ Correct    │ Max Bad Cost  │
-- ├─────────┼──────────────────────────────────────────────┼──────────┼────────────┼───────────────┤
-- │ LIN-010 │ Bath Towel 69x137cm Wonderful                │ 536      │ 96,000     │ 10,365,127,436│
-- │ LIN-032 │ Pillow Case 50x90cm + Flap Wonderful         │ 503      │ 40,000     │ 3,540,429,848 │
-- │ LIN-007 │ Duvet Cover King 260x240cm + Flap Wonderful  │ 466      │ 459,000    │ 63,449,100,000│
-- │ LIN-041 │ Bedsheet King 260x300cm Wonderful             │ 432      │ 270,000    │ 19,214,696,527│
-- │ LIN-012 │ Bath Mat 50x75cm Wonderful                   │ 432      │ 58,350     │ 486,120,342   │
-- │ LIN-011 │ Hand Towel 41x76cm Wonderful                 │ 325      │ 27,700     │ 1,789,421,700 │
-- │ LIN-015 │ Bed Sheet Twin 215x300cm Wonderful            │ 154      │ 230,000    │ 58,008,335    │
-- │ LIN-006 │ Duvet Cover Twin 215x240cm + Flap Wonderful  │ 141      │ 353,000    │ 102,919,111   │
-- │ LIN-005 │ Duvet Cover Hollywood 320x235cm Wonderful    │ 31       │ 550,000    │ 79,291,669    │
-- │ AMN-002 │ Comb Budi Jaya                               │ 18       │ 1,221      │ 3,108         │
-- │ AMN-003 │ Shower Cap Budi Jaya                         │ 17       │ 800        │ 2,377         │
-- │ LIN-002 │ Bed Sheet Hollywood 340x300cm Wonderful       │ 9        │ 345,000    │ 6,555,000     │
-- │ LIN-013 │ Face Towel 33x33cm Wonderful                 │ 3        │ 9,500      │ 36,733        │
-- ├─────────┼──────────────────────────────────────────────┼──────────┼────────────┼───────────────┤
-- │ TOTAL   │                                              │ 3,067    │            │               │
-- └─────────┴──────────────────────────────────────────────┴──────────┴────────────┴───────────────┘


-- ============================================================
-- STEP 0: PRE-CHECK (Jalankan SEBELUM fix, terpisah)
-- ============================================================

-- 0a. Cek jumlah corrupt per item
WITH item_stats AS (
  SELECT sb.item_id,
    SUM(sb.total_value) / NULLIF(SUM(sb.quantity), 0) AS sb_avg_cost
  FROM inventory.stock_balance sb
  GROUP BY sb.item_id
)
SELECT i.code, i.name,
  COUNT(*) FILTER (WHERE sm.unit_cost > ist.sb_avg_cost * 2) AS corrupt_count,
  COUNT(*) AS total_movements
FROM inventory.stock_movements sm
JOIN inventory.items i ON sm.item_id = i.id
JOIN item_stats ist ON sm.item_id = ist.item_id
WHERE ist.sb_avg_cost > 0
  AND sm.item_id IN (
    'e7a4ffa1-1135-4014-bff1-49e314404dd0', -- LIN-010
    'ba8fc859-464e-43cd-b9db-c7e8035c5d3b', -- LIN-032
    'a003c87c-dfd6-4fa5-b74d-0d247e2e8633', -- LIN-007
    '03302bdc-27d9-4f69-a8d5-ecbd1bea2144', -- LIN-041
    '342df13e-e0b9-4430-b5d3-6c85054d4dc7', -- LIN-012
    'd418a723-9ef3-4093-a8c3-c30fbf1c7913', -- LIN-011
    '085bad25-dbc2-4374-bfe0-fdf34f7276d1', -- LIN-015
    '27baa038-bad1-498f-90b9-3885b326f3a4', -- LIN-006
    '43f67875-b756-4c7a-b138-740196379c12', -- LIN-005
    '9c48d033-54f0-47d1-b5b1-8377d472a9e5', -- AMN-002
    '92bd07c4-e46e-4bcc-b3a2-09ee4b5ee374', -- AMN-003
    'eca218d9-0b42-4c4a-9c7c-9d3b334ba9b5', -- LIN-002
    '1c7441f2-9fab-4b1c-911f-b22b8c1d4f9d'  -- LIN-013
  )
GROUP BY i.code, i.name
ORDER BY COUNT(*) FILTER (WHERE sm.unit_cost > ist.sb_avg_cost * 2) DESC;
-- Expected: total corrupt_count across all rows = 3,067


-- ============================================================
-- STEP 1: Snapshot stock_balance SEBELUM fix
-- ============================================================
-- Jalankan terpisah dari STEP 2

CREATE TEMP TABLE _sb_snapshot_before AS
SELECT sb.item_id, i.code, sb.warehouse_id, w.name AS wh_name,
  sb.quantity, sb.avg_cost, sb.total_value
FROM inventory.stock_balance sb
JOIN inventory.items i ON sb.item_id = i.id
JOIN inventory.warehouses w ON sb.warehouse_id = w.id
WHERE sb.item_id IN (
  'e7a4ffa1-1135-4014-bff1-49e314404dd0', -- LIN-010
  'ba8fc859-464e-43cd-b9db-c7e8035c5d3b', -- LIN-032
  'a003c87c-dfd6-4fa5-b74d-0d247e2e8633', -- LIN-007
  '03302bdc-27d9-4f69-a8d5-ecbd1bea2144', -- LIN-041
  '342df13e-e0b9-4430-b5d3-6c85054d4dc7', -- LIN-012
  'd418a723-9ef3-4093-a8c3-c30fbf1c7913', -- LIN-011
  '085bad25-dbc2-4374-bfe0-fdf34f7276d1', -- LIN-015
  '27baa038-bad1-498f-90b9-3885b326f3a4', -- LIN-006
  '43f67875-b756-4c7a-b138-740196379c12', -- LIN-005
  '9c48d033-54f0-47d1-b5b1-8377d472a9e5', -- AMN-002
  '92bd07c4-e46e-4bcc-b3a2-09ee4b5ee374', -- AMN-003
  'eca218d9-0b42-4c4a-9c7c-9d3b334ba9b5', -- LIN-002
  '1c7441f2-9fab-4b1c-911f-b22b8c1d4f9d'  -- LIN-013
);


-- ============================================================
-- STEP 2: DISABLE TRIGGER + UPDATE + RE-ENABLE
-- ============================================================
-- JALANKAN SEMUA DALAM SATU TRANSAKSI!

BEGIN;

  -- 2a. Disable trigger block
  ALTER TABLE inventory.stock_movements
    DISABLE TRIGGER trg_block_stock_movement_update;

  -- 2b. Update setiap item ke harga beli standar (receive_mode)

  -- LIN-010: Bath Towel 69x137cm Wonderful -> 96,000
  UPDATE inventory.stock_movements
  SET unit_cost = 96000
  WHERE item_id = 'e7a4ffa1-1135-4014-bff1-49e314404dd0'
    AND unit_cost > 192000;

  -- LIN-032: Pillow Case 50x90cm + Flap Wonderful -> 40,000
  UPDATE inventory.stock_movements
  SET unit_cost = 40000
  WHERE item_id = 'ba8fc859-464e-43cd-b9db-c7e8035c5d3b'
    AND unit_cost > 80000;

  -- LIN-007: Duvet Cover King 260x240cm + Flap Wonderful -> 459,000
  UPDATE inventory.stock_movements
  SET unit_cost = 459000
  WHERE item_id = 'a003c87c-dfd6-4fa5-b74d-0d247e2e8633'
    AND unit_cost > 830576;

  -- LIN-041: Bedsheet King 260x300cm Wonderful -> 270,000
  UPDATE inventory.stock_movements
  SET unit_cost = 270000
  WHERE item_id = '03302bdc-27d9-4f69-a8d5-ecbd1bea2144'
    AND unit_cost > 495244;

  -- LIN-012: Bath Mat 50x75cm Wonderful -> 58,350
  UPDATE inventory.stock_movements
  SET unit_cost = 58350
  WHERE item_id = '342df13e-e0b9-4430-b5d3-6c85054d4dc7'
    AND unit_cost > 114004;

  -- LIN-011: Hand Towel 41x76cm Wonderful -> 27,700
  UPDATE inventory.stock_movements
  SET unit_cost = 27700
  WHERE item_id = 'd418a723-9ef3-4093-a8c3-c30fbf1c7913'
    AND unit_cost > 54330;

  -- LIN-015: Bed Sheet Twin 215x300cm Wonderful -> 230,000
  UPDATE inventory.stock_movements
  SET unit_cost = 230000
  WHERE item_id = '085bad25-dbc2-4374-bfe0-fdf34f7276d1'
    AND unit_cost > 418650;

  -- LIN-006: Duvet Cover Twin 215x240cm + Flap Wonderful -> 353,000
  UPDATE inventory.stock_movements
  SET unit_cost = 353000
  WHERE item_id = '27baa038-bad1-498f-90b9-3885b326f3a4'
    AND unit_cost > 687452;

  -- LIN-005: Duvet Cover Hollywood 320x235cm Wonderful -> 550,000
  UPDATE inventory.stock_movements
  SET unit_cost = 550000
  WHERE item_id = '43f67875-b756-4c7a-b138-740196379c12'
    AND unit_cost > 1100000;

  -- AMN-002: Comb Budi Jaya -> 1,221
  UPDATE inventory.stock_movements
  SET unit_cost = 1221
  WHERE item_id = '9c48d033-54f0-47d1-b5b1-8377d472a9e5'
    AND unit_cost > 2442;

  -- AMN-003: Shower Cap Budi Jaya -> 800
  UPDATE inventory.stock_movements
  SET unit_cost = 800
  WHERE item_id = '92bd07c4-e46e-4bcc-b3a2-09ee4b5ee374'
    AND unit_cost > 1600;

  -- LIN-002: Bed Sheet Hollywood 340x300cm Wonderful -> 345,000
  UPDATE inventory.stock_movements
  SET unit_cost = 345000
  WHERE item_id = 'eca218d9-0b42-4c4a-9c7c-9d3b334ba9b5'
    AND unit_cost > 656880;

  -- LIN-013: Face Towel 33x33cm Wonderful -> 9,500
  UPDATE inventory.stock_movements
  SET unit_cost = 9500
  WHERE item_id = '1c7441f2-9fab-4b1c-911f-b22b8c1d4f9d'
    AND unit_cost > 16808;

  -- 2c. Re-enable trigger
  ALTER TABLE inventory.stock_movements
    ENABLE TRIGGER trg_block_stock_movement_update;

COMMIT;


-- ============================================================
-- STEP 3: POST-CHECK (Verifikasi setelah fix)
-- ============================================================

-- 3a. Pastikan tidak ada lagi corrupt movements
WITH item_stats AS (
  SELECT sb.item_id,
    SUM(sb.total_value) / NULLIF(SUM(sb.quantity), 0) AS sb_avg_cost
  FROM inventory.stock_balance sb
  GROUP BY sb.item_id
)
SELECT COUNT(*) AS remaining_corrupt
FROM inventory.stock_movements sm
JOIN item_stats ist ON sm.item_id = ist.item_id
WHERE sm.unit_cost > ist.sb_avg_cost * 2
  AND ist.sb_avg_cost > 0;
-- Expected: 0

-- 3b. Pastikan stock_balance TIDAK BERUBAH
SELECT 'BEFORE' AS timing, code, wh_name, quantity, avg_cost, total_value
FROM _sb_snapshot_before
UNION ALL
SELECT 'AFTER', i.code, w.name, sb.quantity, sb.avg_cost, sb.total_value
FROM inventory.stock_balance sb
JOIN inventory.items i ON sb.item_id = i.id
JOIN inventory.warehouses w ON sb.warehouse_id = w.id
WHERE sb.item_id IN (SELECT DISTINCT item_id FROM _sb_snapshot_before)
ORDER BY code, wh_name, timing;
-- Expected: BEFORE dan AFTER harus IDENTIK (qty, avg_cost, total_value sama)

-- 3c. Spot check bincard LIN-012 - pastikan tidak ada unit_cost > 60000
SELECT unit_cost, COUNT(*) AS cnt
FROM inventory.stock_movements
WHERE item_id = '342df13e-e0b9-4430-b5d3-6c85054d4dc7'
GROUP BY unit_cost
ORDER BY unit_cost DESC
LIMIT 5;
-- Expected: max unit_cost = 58350
