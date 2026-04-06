# Langkah Eksekusi Fix Komprehensif: Unit Cost + Trigger WAC

**Jadwal:** 6 April 2026, jam 02:00 WIB (jam sepi)
**File SQL:** `fix-unit-cost-comprehensive-2026-04-06.sql`
**Estimasi waktu:** 10-15 menit

---

## Ringkasan Masalah

Trigger `fn_apply_stock_movement` menghitung ulang WAC (Weighted Average Cost) untuk SEMUA movement type IN, padahal seharusnya hanya untuk purchase-type (Goods Receive, Direct Purchase, Opening Balance). Akibatnya setiap MAKEUP-DIRTY IN, TRANSFER IN, LAUNDRY_RECEIVE IN, dll ikut mengubah avg_cost.

**Scope:** 29 item terdampak, 8,041 stock_movements dengan unit_cost menyimpang.

## Yang Akan Dilakukan

**PART A** — Modifikasi trigger `fn_apply_stock_movement` agar WAC hanya dihitung ulang untuk purchase-type IN movements.

**PART B** — UPDATE kolom `unit_cost` pada 8,041 movements ke avg_cost yang benar dari stock_balance.

## Yang TIDAK Terpengaruh

- stock_balance (qty, avg_cost, total_value) → TIDAK BERUBAH
- Trigger INSERT/DELETE → TIDAK TERPENGARUH
- Kolom selain unit_cost → TIDAK BERUBAH
- ADJUSTMENT movements → TIDAK DIUBAH

---

## Langkah-langkah

### 0. Backup trigger lama (PENTING!)

Sebelum apapun, simpan definisi trigger lama untuk rollback:

1. Buka Supabase SQL Editor: https://supabase.com/dashboard/project/ahompvfhgndlyjdocmiq/sql
2. Jalankan:
   ```sql
   SELECT pg_get_functiondef(oid)
   FROM pg_proc
   WHERE proname = 'fn_apply_stock_movement'
     AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'inventory');
   ```
3. **Copy hasilnya dan simpan** di notepad/file terpisah sebagai backup

### 1. Jalankan STEP 0: Pre-Check

- Copy STEP 0 dari file SQL
- Jalankan dan verifikasi:
  - `total_rows_to_fix` = **8,041**
  - `items_affected` = **29**
  - `makeup_dirty` = **3,101**
  - `makeup_replace` = **3,280**
  - `consumption` = **964**
  - `transfer` = **423**
  - `laundry` = **250**
  - `makeup_hk` = **14**
  - `reconciliation` = **9**
- Jika angka berbeda signifikan, STOP dan investigasi dulu

### 2. Jalankan STEP 1: Snapshot

- Copy STEP 1 (CREATE TEMP TABLE _sb_snapshot_before)
- Ini menyimpan snapshot stock_balance untuk verifikasi nanti

### 3. Jalankan STEP 2 (PART A): Fix Trigger

- Copy SELURUH STEP 2 (CREATE OR REPLACE FUNCTION)
- **Ini aman** — CREATE OR REPLACE tidak ada side effect
- Pastikan ada pesan "Success"
- **CATATAN:** Setelah langkah ini, semua movement baru (MAKEUP, TRANSFER, dll) sudah tidak akan mengubah avg_cost lagi

### 4. Jalankan STEP 3 (PART B): Fix Historical Unit Cost

- Copy SELURUH STEP 3 (dari BEGIN sampai COMMIT)
- **PENTING: Jalankan sekaligus dalam satu kali Run!**
- Urutan yang terjadi:
  1. Disable trigger block UPDATE (sementara)
  2. UPDATE 8,041 rows unit_cost ke avg_cost yang benar
  3. Re-enable trigger block UPDATE
- Pastikan ada pesan "Success" dan tidak ada error

### 5. Jalankan STEP 4: Post-Check

- **4a:** `remaining_wrong` → harus = **0**
- **4b:** `stock_balance_check` → harus = **PASS - stock_balance TIDAK BERUBAH**
- **4c:** LIN-012 max unit_cost → harus sekitar **57,002**
- **4d:** AMN-001 max unit_cost → harus = **2,000**

### 6. Cek Visual di Aplikasi

- Buka **Stock Balance** page → total value harus tetap ~485 juta (tidak berubah)
- Buka **Bin Card LIN-012** → avg cost tidak lagi menampilkan lonjakan miliaran
- Buka **Bin Card AMN-001** → avg cost tidak lagi berfluktuasi setiap baris

---

## Rollback (Jika Ada Masalah)

### Jika STEP 3 gagal di tengah (trigger block tidak re-enable):
```sql
ALTER TABLE inventory.stock_movements
  ENABLE TRIGGER trg_block_stock_movement_update;
```

### Jika trigger STEP 2 perlu di-rollback:
Jalankan isi file `backup-fn_apply_stock_movement-ORIGINAL.sql` di SQL Editor.
File ini berisi definisi trigger asli sebelum modifikasi.

---

## Catatan Penting

- **JANGAN** gunakan DELETE + INSERT untuk fix ini (cascading ke stock_balance)
- **JANGAN** panggil `reconcile_stock_balance` setelah fix
- Fix trigger (PART A) bersifat **permanen** — mencegah masalah terulang
- Fix historical (PART B) hanya mengubah data display di bincard
- Stock balance tidak akan terpengaruh sama sekali
- ADJUSTMENT movements sengaja TIDAK diubah (unit_cost = 0 by design)
