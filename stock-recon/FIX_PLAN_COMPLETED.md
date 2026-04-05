# Stock Reconciliation — Fix Plan Completed

**Tanggal:** 2026-04-05 s.d. 2026-04-06
**Status:** ✅ **DB hardening + Frontend FULL migration complete** — Fase 6b READY TO EXECUTE
**Baseline reconciliation:** `OK | total=1117 mismatch=0 neg=0 sb_only_nonzero=0 bin_only_nonzero=0`

---

## Ringkasan

Masalah awal: ada 5 mismatch antara `stock_balance` (cache) dan `stock_movements` (ledger), plus 11 baris `stock_balance` dengan qty negatif. Akar masalahnya adalah trigger lama `fn_sync_stock_balance` menggunakan **`Math.max(0, ...)` clamp** pada OUT, sehingga jika user over-issue, movement tetap tercatat tapi balance dibulatkan ke 0 — menciptakan divergensi permanen antara ledger dan cache.

Fix ini dibagi jadi 10 fase. Fase 1–5 dan 8 sudah **fully deployed** ke DB production. Fase 6 (frontend RPC migration) partial — 6 file sudah dimigrasi, sisanya tetap aman karena **trigger DB selalu override `balance_after`** dan selalu reject over-issue.

---

## Fase yang sudah selesai

### Fase 1 — Backfill data lama ✅
- 5 mismatch awal di-backfill dengan Opsi A (trust stock_balance)
- Ditemukan 11 negative SB rows tambahan saat eksekusi → di-backfill terpisah pakai `SET LOCAL session_replication_role = 'replica'` untuk bypass trigger
- Script: `sql/01_backfill_5_mismatches.sql`

### Fase 2+3+9 — Trigger hardening + constraints ✅
Script: `sql/02_harden_trigger_and_constraints.sql`

**CHECK constraints ditambahkan:**
- `stock_balance_qty_nonneg`: quantity >= 0
- `stock_movements_qty_positive`: quantity > 0
- `stock_movements_type_whitelist`: IN/OUT only
- `stock_movements_ref_whitelist`: 32 reference_type yang valid
- NOT NULL guards di kolom kritis

**Trigger lama di-drop:**
- `trg_sync_stock_balance` (clamp-based)
- `trg_stock_movements_after_delete`
- `fn_sync_stock_balance` (legacy function)

**Trigger baru dipasang:**
- `fn_apply_stock_movement` (BEFORE INSERT): row-lock `FOR UPDATE`, **strict reject** bila OUT membuat stok negatif, auto-stamp `balance_after`, weighted average cost calculation
- `fn_revert_stock_movement` (BEFORE DELETE): reverse effect, reject kalau delete IN bikin negatif
- `fn_block_stock_movement_update` (BEFORE UPDATE): `stock_movements` sekarang **immutable** — semua koreksi harus lewat DELETE+INSERT
- `fn_block_stock_balance_direct` (stub): akan diaktifkan di Fase 6b setelah semua frontend sudah migrasi ke RPC

### Fase 5 — RPC functions ✅
Dibuat di DB dengan `SECURITY DEFINER` + `auth.uid()` untuk audit:
- `inventory.record_movement(...)` — single IN/OUT
- `inventory.record_transfer(...)` — atomic OUT+IN dalam 1 transaction
- `inventory.delete_movements_by_ref(...)` — bulk delete by reference (untuk reversal)

Semua di-GRANT ke role `authenticated`.

### Fase 8 — Monitoring ✅
Script: `sql/03_monitoring.sql`

- Tabel `inventory.reconciliation_log` — log hasil audit
- Fungsi `inventory.run_reconciliation(org_id)` — audit penuh, return status OK/DRIFT
- View `inventory.v_reconciliation_recent` — 30 hari terakhir

**Logika drift diperbaiki:** baris dengan qty=0 di SB atau net=0 di bin card tidak lagi dianggap drift (harmless residual).

**Rekomendasi:** panggil `inventory.run_reconciliation()` harian lewat Supabase cron.

### Fase 6 — Frontend RPC migration (COMPLETE) ✅
Helper dibuat: `src/services/stockService.js` dengan 3 fungsi `recordMovement`, `recordTransfer`, `deleteMovementsByRef`.

**Sudah dimigrasi ke RPC (operasional):**
- ✅ `SingleItemUsagePage.jsx` (USAGE + reversal)
- ✅ `AdjustmentPage.jsx` (ADJUSTMENT)
- ✅ `DirectPurchasePage.jsx` (DIRECT_PURCHASE + reversal)
- ✅ `PurchaseReceivedPage.jsx` (GR + reversal)
- ✅ `LaundryPage.jsx` — LAUNDRY_SEND/RECEIVE via `recordTransfer` + `vendorId` (RPC extended)
- ✅ `TransferPage.jsx` — TRANSFER + TRANSFER-REV via `recordTransfer`
- ✅ `InUseWarehousePage.jsx` — IU-TRANSFER, IU-TRANSFER-REV, DEPLETED, DEPLETED-REV (6 sites)
- ✅ `RoomMakeUpPageNew.jsx` — helper `doStockMovement` delegasi ke `recordMovement`
- ✅ `RoomAdditionalRequestPage.jsx` — helper `doStockMovement` delegasi ke `recordMovement`
- ✅ `ApprovalPage.jsx` — WRITEOFF insert via `recordMovement`; DP/WO revoke via `deleteMovementsByRef`
- ✅ `StockBalancePage.jsx` — `handleReconcile` delegasi ke RPC `run_reconciliation`
- ✅ `OpeningBalancePage.jsx` — post-save reconciliation delegasi ke RPC `run_reconciliation`

**RPC extensions (DB):**
- ✅ `record_movement` — tambah param `p_vendor_id uuid DEFAULT NULL`
- ✅ `record_transfer` — tambah param `p_vendor_id uuid DEFAULT NULL`
- ✅ `fn_run_daily_reconciliation()` — wrapper baru untuk cron, loop semua org → `run_reconciliation`
- ✅ Cron job `daily-stock-reconciliation` schedule `0 18 * * *` UTC (= 01:00 WIB) aktif

**Admin/setup flow — migrated 2026-04-06:**
- ✅ `OpeningBalancePage.jsx` main OB flow → `fn_set_opening_balance` RPC (script 04). Lines 372-500 diganti satu call RPC. Lock/unlock/relock tetap langsung ke `opening_balance_locks` (tabel ini tidak di-REVOKE).
- ✅ `ItemsPage.jsx:409` → `fn_delete_orphan_stock_balance` RPC (script 04).

**Verifikasi akhir:** grep seluruh `src/` tidak ada lagi `.insert/.update/.delete/.upsert` ke `stock_movements` atau `stock_balance`. Syntax kedua file parse OK via babel.

### Fase 6 — RPC baru (DB)
Script: `sql/04_ob_and_orphan_rpcs.sql`

- ✅ `inventory.fn_set_opening_balance(p_organization_id, p_category_id, p_ob_date, p_movements jsonb, p_created_by)` — atomic replace OB movements + run reconciliation safety net. SECURITY DEFINER + search_path locked.
- ✅ `inventory.fn_delete_orphan_stock_balance(p_organization_id, p_item_id)` — hapus row qty=0 untuk item yang di-delete.

Keduanya GRANTed ke `authenticated`.

---

### Fase 6b — REVOKE direct write access ✅ READY TO EXECUTE
Script: `sql/05_fase6b_revoke.sql`

Prasyarat sudah terpenuhi:
- ✅ Semua file frontend sudah lewat RPC (operasional + admin)
- ✅ Script 04 (fn_set_opening_balance + fn_delete_orphan_stock_balance) siap di-deploy
- ✅ Baseline reconciliation OK

Script melakukan:
```sql
REVOKE INSERT, UPDATE, DELETE ON inventory.stock_movements FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON inventory.stock_balance   FROM authenticated;
-- + aktifkan trg_block_stock_balance_direct
```

**Urutan eksekusi di DB production:**
1. `psql ... -f sql/04_ob_and_orphan_rpcs.sql` → pastikan RPC baru terpasang
2. Smoke test frontend: save OB baru, edit OB existing, unlock+re-lock, delete item kosong — semua harus sukses
3. `psql ... -f sql/05_fase6b_revoke.sql`
4. Final verification: `SELECT inventory.run_reconciliation('<org_id>')` harus return status=OK

Rollback commands ada di header `05_fase6b_revoke.sql`.

### Fase 7 — Integration tests
Rekomendasi: buat test per transaction type (GR, USAGE, TRANSFER, MAKEUP, CONSUMPTION, ADJUSTMENT, WRITEOFF, LAUNDRY, IN-USE DEPLETED, OPENING_BALANCE).

### Fase 10 — Cleanup
- Backup tables yang bisa dihapus setelah ~30 hari: `stock_balance_backup_20260405`, `stock_movements_backup_20260405`

---

## Penting untuk diingat

1. **Stock movements sekarang immutable.** Koreksi harus lewat DELETE + INSERT baru. Ada RPC `delete_movements_by_ref` untuk reversal.

2. **Over-issue strict reject.** Trigger akan `RAISE EXCEPTION` dengan pesan `'Stok tidak cukup untuk OUT: item=... warehouse=... saldo=... diminta=...'`. Frontend harus catch error ini.

3. **Whitelist reference_type.** Kalau ada type baru, tambahkan ke constraint `stock_movements_ref_whitelist` dulu, baru dipakai.

4. **Weighted average cost** sekarang dihitung di trigger, tidak perlu lagi dari frontend.

5. **Monitoring**: jalankan `SELECT * FROM inventory.run_reconciliation('<org_id>')` minimal sekali sehari. Kalau status = 'DRIFT', cek `details` column.

---

## File artifacts

- `sql/01_backfill_5_mismatches.sql` — Fase 1
- `sql/02_harden_trigger_and_constraints.sql` — Fase 2+3+9
- `sql/03_monitoring.sql` — Fase 8
- `sql/04_ob_and_orphan_rpcs.sql` — Fase 6 (OB + orphan cleanup RPC)
- `sql/05_fase6b_revoke.sql` — Fase 6b (REVOKE + trigger lockdown)
- `src/services/stockService.js` — Frontend RPC helper
