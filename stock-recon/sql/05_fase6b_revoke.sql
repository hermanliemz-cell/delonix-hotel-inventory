-- =====================================================================
-- Fase 6b — REVOKE direct write + enable block trigger
-- =====================================================================
-- Prasyarat yang HARUS sudah terpenuhi sebelum script ini dijalankan:
--   1. Semua RPC Fase 5 terpasang (record_movement, record_transfer,
--      delete_movements_by_ref, run_reconciliation).
--   2. Script 04_ob_and_orphan_rpcs.sql sudah dijalankan
--      (fn_set_opening_balance, fn_delete_orphan_stock_balance).
--   3. Semua file frontend sudah dimigrasi ke RPC:
--      - LaundryPage, TransferPage, InUseWarehousePage
--      - RoomMakeUpPageNew, RoomAdditionalRequestPage, ApprovalPage
--      - StockBalancePage
--      - OpeningBalancePage (via fn_set_opening_balance)
--      - ItemsPage (via fn_delete_orphan_stock_balance)
--   4. Baseline reconciliation OK: total=... mismatch=0 neg=0.
--
-- Efek script:
--   - Role `authenticated` kehilangan hak INSERT/UPDATE/DELETE pada
--     inventory.stock_movements dan inventory.stock_balance.
--   - SELECT tetap diizinkan (dashboard, reports, bin card masih jalan).
--   - Trigger fn_block_stock_balance_direct diaktifkan sebagai defense
--     in depth: bahkan role lain tidak bisa write langsung ke stock_balance
--     (kecuali dari dalam trigger sync yang SECURITY DEFINER).
--   - Semua RPC yang SECURITY DEFINER tetap bisa write karena fungsinya
--     dijalankan dengan hak owner (biasanya postgres/supabase_admin).
--
-- Cara rollback jika ada masalah:
--   GRANT INSERT, UPDATE, DELETE ON inventory.stock_movements TO authenticated;
--   GRANT INSERT, UPDATE, DELETE ON inventory.stock_balance   TO authenticated;
--   DROP TRIGGER IF EXISTS trg_block_stock_balance_direct ON inventory.stock_balance;
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) REVOKE direct write dari role authenticated
-- ---------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON inventory.stock_movements FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON inventory.stock_balance   FROM authenticated;

-- Pastikan SELECT tetap ada (idempotent)
GRANT SELECT ON inventory.stock_movements TO authenticated;
GRANT SELECT ON inventory.stock_balance   TO authenticated;

-- ---------------------------------------------------------------------
-- 2) Aktifkan trigger fn_block_stock_balance_direct
-- ---------------------------------------------------------------------
-- Stub sudah dipasang di Fase 2+3+9. Sekarang kita aktifkan agar
-- direct write ke stock_balance yang bukan berasal dari trigger sync
-- akan di-reject.
--
-- Implementasi fungsi ini mengecek flag session `inventory.in_sync_trigger`
-- yang di-set ke 'on' oleh fn_apply_stock_movement / fn_revert_stock_movement
-- sebelum mereka update stock_balance. Jadi trigger sync tetap lolos,
-- tapi write dari client / RPC lain akan diblokir.
--
-- Jika trigger belum ada (misal di env test), buat ulang stub:
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'inventory' AND p.proname = 'fn_block_stock_balance_direct'
  ) THEN
    RAISE NOTICE 'fn_block_stock_balance_direct belum ada — lewati create trigger. Jalankan script Fase 2+3+9 dulu.';
  ELSE
    -- Drop existing trigger (idempotent)
    DROP TRIGGER IF EXISTS trg_block_stock_balance_direct ON inventory.stock_balance;
    -- Attach trigger: BEFORE INSERT OR UPDATE OR DELETE
    EXECUTE $trig$
      CREATE TRIGGER trg_block_stock_balance_direct
      BEFORE INSERT OR UPDATE OR DELETE ON inventory.stock_balance
      FOR EACH ROW EXECUTE FUNCTION inventory.fn_block_stock_balance_direct()
    $trig$;
    RAISE NOTICE 'trg_block_stock_balance_direct aktif.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------
-- 3) Smoke test — pastikan SELECT dari role authenticated masih jalan
-- ---------------------------------------------------------------------
-- (Hanya NOTICE, tidak fail)
DO $$
DECLARE
  v_ok boolean;
BEGIN
  SELECT has_table_privilege('authenticated', 'inventory.stock_movements', 'SELECT')
    INTO v_ok;
  RAISE NOTICE 'authenticated SELECT stock_movements: %', v_ok;

  SELECT has_table_privilege('authenticated', 'inventory.stock_movements', 'INSERT')
    INTO v_ok;
  RAISE NOTICE 'authenticated INSERT stock_movements (should be false): %', v_ok;

  SELECT has_table_privilege('authenticated', 'inventory.stock_balance', 'UPDATE')
    INTO v_ok;
  RAISE NOTICE 'authenticated UPDATE stock_balance (should be false): %', v_ok;
END
$$;

COMMIT;

-- =====================================================================
-- END Fase 6b REVOKE script
-- =====================================================================
-- Setelah COMMIT:
--   1. Jalankan final reconciliation:
--        SELECT inventory.run_reconciliation(
--          '<organization_id>'::uuid
--        );
--      Hasil harus: status=OK, mismatch=0, neg=0.
--   2. Verifikasi di aplikasi: coba
--      - Input Room Make-Up (IN/OUT)  → harus sukses
--      - Transfer antar warehouse     → harus sukses
--      - Set Opening Balance baru     → harus sukses
--      - Edit Opening Balance yang ada → harus sukses
--      - Hapus item kosong            → harus sukses
--      - Coba insert langsung via SQL sebagai role authenticated
--        (mis. via Supabase SQL editor dengan set role authenticated)
--        → harus gagal dengan permission denied.
-- =====================================================================
