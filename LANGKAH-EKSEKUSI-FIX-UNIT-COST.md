# Langkah Eksekusi Fix Unit Cost Corruption

**Jadwal:** 6 April 2026, jam 02:00 WIB (jam sepi)
**File SQL:** `fix-unit-cost-corruption-2026-04-06.sql`
**Estimasi waktu:** 5-10 menit

---

## Ringkasan Masalah

13 item memiliki 3,067 stock_movements dengan unit_cost yang korup (membengkak hingga miliaran) akibat bug WAC compounding pada periode 31 Mar - 4 Apr 2026. Stock balance sudah benar dari backup restore, tapi bincard masih menampilkan data korup.

## Yang Akan Dilakukan

UPDATE kolom `unit_cost` pada 3,067 movement ke harga beli standar masing-masing item.

## Yang TIDAK Terpengaruh

- stock_balance (qty, avg_cost, total_value) -> TIDAK BERUBAH
- Kolom selain unit_cost -> TIDAK BERUBAH
- Trigger INSERT/DELETE -> TIDAK TERPENGARUH

---

## Langkah-langkah

### 1. Buka Supabase SQL Editor
- URL: https://supabase.com/dashboard/project/ahompvfhgndlyjdocmiq/sql
- Login sebagai Herman Liem

### 2. Jalankan STEP 0: Pre-Check
- Copy STEP 0 dari file SQL
- Jalankan dan pastikan angka corrupt_count cocok dengan tabel di header file
- Total harus = 3,067

### 3. Jalankan STEP 1: Snapshot
- Copy STEP 1 (CREATE TEMP TABLE)
- Ini menyimpan snapshot stock_balance sebelum fix

### 4. Jalankan STEP 2: Fix Utama
- Copy SELURUH STEP 2 (dari BEGIN sampai COMMIT)
- **PENTING: Jalankan sekaligus dalam satu kali Run!**
- Ini akan:
  1. Disable trigger block sementara
  2. Update 3,067 rows unit_cost
  3. Re-enable trigger block
- Pastikan ada pesan "Success" dan tidak ada error

### 5. Jalankan STEP 3: Verifikasi
- **3a:** Cek remaining_corrupt -> harus = 0
- **3b:** Compare BEFORE vs AFTER stock_balance -> harus IDENTIK
- **3c:** Spot check LIN-012 -> max unit_cost harus 58,350

### 6. Cek Visual di Aplikasi
- Buka Stock Balance page -> cek avg cost LIN-012 (harus tetap Rp 57,002)
- Buka Bin Card LIN-012 -> avg cost seharusnya tidak lagi menampilkan lonjakan

---

## Rollback (Jika Ada Masalah)

Karena kita HANYA mengubah unit_cost di stock_movements (tanpa trigger cascading), rollback manual sangat mudah:

```sql
-- Rollback: kembalikan ke nilai sebelumnya
-- Tapi karena ini fix (bukan kerusakan),
-- seharusnya tidak perlu rollback
--
-- Jika trigger tidak re-enable karena error:
ALTER TABLE inventory.stock_movements
  ENABLE TRIGGER trg_block_stock_movement_update;
```

## Catatan Penting

- **JANGAN** gunakan DELETE + INSERT untuk fix ini (bisa cascading ke stock_balance)
- **JANGAN** panggil `reconcile_stock_balance` setelah fix
- Fix ini hanya mengubah data historis di stock_movements untuk bincard display
- Stock balance tidak akan terpengaruh sama sekali
