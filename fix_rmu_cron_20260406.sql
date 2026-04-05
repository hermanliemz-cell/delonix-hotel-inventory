-- =====================================================================
-- FIX SCRIPT: Kegagalan cron auto-confirm-room-makeups (06-Apr-2026)
-- Dibuat berdasarkan diagnosis Supabase:
--   1. HK Store habis untuk LIN-015, LIN-041, LIN-046
--   2. Sejumlah Room warehouse belum punya stok awal (untuk move_to_dirty)
--   3. Ada 21 movement lama dengan qty 0.50 (TRANSFER / TRANSFER-REV)
--
-- Script transaksional — bila ada error, seluruh perubahan dibatalkan.
-- REVIEW DULU sebelum klik Run. Setelah selesai, buka halaman CRON Jobs
-- dan tekan "Run Now" untuk re-run auto-confirm.
-- =====================================================================

BEGIN;

-- -------- HELPER: ambil organization_id aktif (pakai row pertama items) --------
-- (diasumsikan single-tenant; kalau tidak, sesuaikan manual)
-- id HK Store : 72809d39-4e04-4964-b244-78da56bde15a

-- =====================================================================
-- STEP 1: Top-up HK Store via ADJUSTMENT IN
--   LIN-015 +5, LIN-041 +15, LIN-046 +15
-- =====================================================================

INSERT INTO inventory.stock_movements
  (organization_id, item_id, warehouse_id, movement_type,
   quantity, unit_cost, reference_type, notes)
SELECT
  i.organization_id,
  i.id,
  '72809d39-4e04-4964-b244-78da56bde15a'::uuid,
  'IN',
  CASE i.code
    WHEN 'LIN-015' THEN 5
    WHEN 'LIN-041' THEN 15
    WHEN 'LIN-046' THEN 15
  END,
  0,
  'ADJUSTMENT',
  'Top-up HK Store (fix cron RMU 2026-04-06): habis karena konsumsi replace'
FROM inventory.items i
WHERE i.code IN ('LIN-015','LIN-041','LIN-046');

-- =====================================================================
-- STEP 2: Opening Balance per (room × item) untuk operasi move_to_dirty
--   Hanya kamar yang muncul di 18 draft MU yang gagal (opsi a).
--   Hanya inject kalau saldo saat ini = 0 (agar tidak over-fill).
-- =====================================================================

INSERT INTO inventory.stock_movements
  (organization_id, item_id, warehouse_id, movement_type,
   quantity, unit_cost, reference_type, notes)
SELECT
  i.organization_id,
  rmi.item_id,
  rmi.warehouse_id,
  'IN',
  SUM(rmi.actual_qty)::numeric AS need_qty,
  0,
  'OPENING_BALANCE',
  'OB retroaktif per room (fix cron RMU 2026-04-06): baseline sprei bersih'
FROM inventory.room_makeups rm
JOIN inventory.room_makeup_items rmi ON rmi.makeup_id = rm.id
JOIN inventory.items i ON i.id = rmi.item_id
LEFT JOIN inventory.stock_balance sb
  ON sb.item_id = rmi.item_id AND sb.warehouse_id = rmi.warehouse_id
WHERE rm.status = 'DRAFT'
  AND rmi.type = 'move_to_dirty'
  AND i.code IN ('LIN-007','LIN-015','LIN-041','LIN-046')
  AND COALESCE(sb.quantity, 0) = 0
GROUP BY i.organization_id, rmi.item_id, rmi.warehouse_id;

-- =====================================================================
-- STEP 3: Bulatkan 21 movement qty 0.50 menjadi 1.00
--   Pendekatan: UPDATE langsung + recompute stock_balance untuk setiap
--   (warehouse, item) yang terdampak, dari sum seluruh movements.
-- =====================================================================

-- 3a. Snapshot pair (warehouse, item) yang terkena
CREATE TEMP TABLE _affected_pairs ON COMMIT DROP AS
SELECT DISTINCT warehouse_id, item_id
FROM inventory.stock_movements
WHERE quantity = 0.5;

-- 3b. Update kuantitasnya
UPDATE inventory.stock_movements
SET quantity = 1,
    total_cost = unit_cost * 1,
    notes = COALESCE(notes, '') || ' [ROUND 0.5→1 2026-04-06]'
WHERE quantity = 0.5;

-- 3c. Recompute stock_balance untuk pair terdampak
UPDATE inventory.stock_balance sb
SET quantity = sub.new_qty,
    updated_at = now()
FROM (
  SELECT
    sm.warehouse_id,
    sm.item_id,
    SUM(CASE WHEN sm.movement_type = 'IN'  THEN sm.quantity
             WHEN sm.movement_type = 'OUT' THEN -sm.quantity
             ELSE 0 END)::numeric AS new_qty
  FROM inventory.stock_movements sm
  WHERE (sm.warehouse_id, sm.item_id) IN (SELECT warehouse_id, item_id FROM _affected_pairs)
  GROUP BY sm.warehouse_id, sm.item_id
) sub
WHERE sb.warehouse_id = sub.warehouse_id
  AND sb.item_id      = sub.item_id;

-- =====================================================================
-- STEP 4: Verifikasi pre-commit — tampilkan saldo 4 item di HK Store
-- =====================================================================

-- Jika hasilnya aneh, JANGAN COMMIT. Jalankan ROLLBACK.
SELECT i.code, sb.quantity AS hk_saldo_sekarang
FROM inventory.stock_balance sb
JOIN inventory.items i ON i.id = sb.item_id
WHERE sb.warehouse_id = '72809d39-4e04-4964-b244-78da56bde15a'
  AND i.code IN ('LIN-007','LIN-015','LIN-041','LIN-046')
ORDER BY i.code;

-- Jika angka sudah wajar dan integer, lanjut:
COMMIT;

-- =====================================================================
-- STEP 5 (MANUAL): setelah COMMIT, buka halaman CRON Jobs di app
--                  → klik "Run Now" pada auto-confirm-room-makeups
--                  → verifikasi cron_job_logs terakhir = confirmed=25, failed=0
-- =====================================================================
