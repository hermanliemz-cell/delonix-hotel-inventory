# Langkah Eksekusi: Timeline Reconstruct Unit Cost & Avg Cost

**Tanggal dibuat:** 8 April 2026
**File SQL:** `fix-unit-cost-timeline-reconstruct-v2-2026-04-08.sql` (versi terbaru)
**File SQL lama:** `fix-unit-cost-timeline-reconstruct-2026-04-08.sql` (v1, ada bug GOODS_RECEIVE)
**Estimasi waktu:** 5-10 menit
**Prasyarat:** System dalam maintenance mode

---

## Ringkasan Masalah

Fix sebelumnya (6 April 2026) menggunakan CURRENT stock_balance avg_cost sebagai sumber kebenaran. Namun stock_balance avg_cost sendiri sudah corrupt karena trigger bug lama yang menghitung WAC untuk semua IN movements (bukan hanya purchases).

Contoh: AMN-001 — Opening Balance @ Rp 2,000, tidak ada purchase lain, tapi stock_balance avg_cost = 945.33 (corrupt).

## Prinsip: AVG COST = Per ITEM, Bukan Per Warehouse

Warehouse hanya fungsi lokasi (track qty). Nilai per unit (avg_cost) adalah satu angka per item. Transfer antar warehouse tidak mengubah avg_cost — hanya purchase yang mengubah avg_cost.

## Yang Akan Dilakukan

1. Reconstruct avg_cost timeline PER ITEM dari semua purchase movements (chronological)
2. Fix `stock_movements.unit_cost` = avg_cost item pada saat movement itu terjadi
3. Fix `stock_balance.avg_cost` = avg_cost final item (SAMA untuk semua warehouse)
4. Fix `stock_balance.total_value` = qty × new avg_cost

## Yang TIDAK Terpengaruh

- stock_balance.quantity → TIDAK BERUBAH
- Purchase movements (GR, DIRECT_PURCHASE, OPENING_BALANCE) unit_cost → TIDAK DIUBAH
- ADJUSTMENT movements → TIDAK DIUBAH
- Trigger INSERT/DELETE → TIDAK TERPENGARUH

---

## Langkah-langkah

### 0. Pastikan System dalam Maintenance Mode

Tidak boleh ada user lain yang membuat movements selama fix berjalan.

### 1. Jalankan STEP 0: Pre-Check

Buka Supabase SQL Editor dan jalankan query STEP 0 dari file SQL.

Verifikasi:
- **0a:** Catat `total_stock_value_before` (akan berubah setelah fix karena avg_cost diperbaiki)
- **0b:** Items dengan status `PERLU FIX` — ini yang akan diperbaiki
- **0c:** AMN-001 avg_cost = 945.33 (corrupt, seharusnya 2,000)
- **0d:** Catat jumlah `movements_to_check`

### 2. Jalankan STEP 1: Timeline Reconstruct

- Copy SELURUH STEP 1 (dari `DO $$` sampai `$$;`)
- **Jalankan sekaligus dalam satu kali Run**
- Proses yang terjadi:
  1. Disable trigger block UPDATE (sementara)
  2. Loop semua movements per item chronologically
  3. Track running qty & avg_cost (hanya purchase mengubah avg)
  4. Update unit_cost pada movements yang salah
  5. Update stock_balance avg_cost (semua warehouse = same avg per item)
  6. Re-enable trigger block UPDATE
- Cek tab Messages untuk melihat jumlah rows yang diupdate

### 3. Jalankan STEP 2: Post-Check

Verifikasi:
- **2a:** AMN-001 avg_cost = **2,000** di semua warehouse → `PASS`
- **2b:** AMN-001 semua non-purchase movements unit_cost = **2,000**
- **2c:** Catat `total_stock_value_after` (akan berbeda dari 0a — ini normal)
- **2d:** `trg_block_stock_movement_update` → tgenabled = `O` (enabled)
- **2e:** **0 rows** — semua item avg_cost konsisten antar warehouse
- **2f:** **0 rows** — semua single-price items cocok

### 4. Cek Visual di Aplikasi

- Buka **Bin Card AMN-001** → consumption unit_cost harus 2,000 (bukan 945)
- Buka **Stock Balance** page → total value akan berubah (ini benar)

---

## Rollback

### Jika STEP 1 gagal di tengah (trigger block tidak re-enable):
```sql
ALTER TABLE inventory.stock_movements
  ENABLE TRIGGER trg_block_stock_movement_update;
```

### Jika perlu revert total:
Restore dari backup database. Catat total stock value dari STEP 0a sebelum menjalankan fix.

---

## Catatan Penting

- **JANGAN** panggil `reconcile_stock_balance` setelah fix
- Fix ini mengubah `stock_balance.avg_cost` dan `total_value` — ini DISENGAJA
- Total stock value akan berubah karena avg_cost diperbaiki ke nilai yang benar
- Setelah fix, semua warehouse untuk item yang sama akan punya avg_cost yang SAMA
- ADJUSTMENT movements sengaja TIDAK diubah (unit_cost = 0 by design)

---

## Prompt untuk Eksekusi di Masa Depan

Jika perlu menjalankan fix ini lagi (misalnya setelah data baru masuk):

> **Prompt:** "Jalankan timeline reconstruct dari file `fix-unit-cost-timeline-reconstruct-v2-2026-04-08.sql`. Ikuti langkah di `LANGKAH-EKSEKUSI-TIMELINE-RECONSTRUCT.md`. System sudah dalam maintenance mode."

---

## Hasil Eksekusi 8 April 2026 — v1 (OBSOLETE, ada bug)

- **STEP 0a:** Total stock value sebelum = Rp 485,797,288.19
- **STEP 1:** DO block berhasil
- **STEP 2c:** Total stock value sesudah = Rp 513,781,585.95
- **BUG:** Menggunakan `'GOODS_RECEIVE'` — reference_type yang benar adalah `'GR'`
- **AKIBAT:** 7 GR movements tidak ikut WAC calculation

## Hasil Eksekusi 8 April 2026 — v2 (FIXED)

**File SQL:** `fix-unit-cost-timeline-reconstruct-v2-2026-04-08.sql`

**Perbaikan sebelum v2 dijalankan:**
1. Trigger `fn_apply_stock_movement`: `'GOODS_RECEIVE'` → `'GR'` (via dynamic SQL REPLACE)
2. GR-DAS-0001 harga sementara: update PI items, GR items, dan stock_movements
   dengan harga dari Opening Balance (karena user belum input harga di PI)
3. Bug duplikat GR number: `PurchaseReceivedPage.jsx` query ke tabel `goods_receipts`
   (salah) → diperbaiki ke `purchase_received`

**Hasil v2:**
- **Total stock value:** Rp 514,238,441.10 (1131 rows)
- **MISMATCH:** 0 rows → semua total_value = qty × avg_cost
- **Zero avg_cost items:** 155 (normal — item tanpa purchase movement)
- **AMN-001:** avg_cost = 2,000.00 → PASS
- **AMN-002:** avg_cost = 1,221.00 → PASS
- **Trigger:** `'GR'` terpasang, `'GOODS_RECEIVE'` sudah dihapus → PASS

**Catatan GR-DAS-0001:**
- Ada 2 dokumen GR-DAS-0001 (duplikat — bug di generateGRNumber)
- GR 1: 6 items (AMN-001,002,003,005,006,007), GR 2: 1 item (AMN-001)
- Harga sementara diambil dari Opening Balance
- User akan perbaiki harga asli dari PI besok, lalu re-run reconstruct

---

## Rencana Migrasi Selanjutnya (Opsi C + Audit Table)

Setelah fix ini selesai, langkah arsitektur berikutnya:

### Fase 1: Audit Table (item_cost_history)
1. Buat tabel `inventory.item_cost_history` untuk log perubahan avg_cost
2. Kolom: `id, organization_id, item_id, reference_type, reference_number, purchase_qty, purchase_price, qty_before, avg_cost_before, qty_after, avg_cost_after, created_at`
3. Tambahkan INSERT ke tabel ini di dalam trigger saat purchase

### Fase 2: Migrasi avg_cost ke Items
4. Tambah kolom `avg_cost` di tabel `items`
5. Populate dari stock_balance (sudah benar setelah fix)
6. Ubah trigger `fn_apply_stock_movement` → update `items.avg_cost` saat purchase
7. Ubah trigger → untuk non-purchase movements, baca unit_cost dari `items.avg_cost`

### Fase 3: Cleanup
8. Hapus kolom cost/value dari Bin Card UI
9. Buat halaman "Item Cost History" (menampilkan data dari item_cost_history)
10. Hapus kolom `avg_cost` dan `total_value` dari `stock_balance`
11. Update Stock Valuation query: `SUM(sb.qty) × items.avg_cost`

> **Prompt untuk migrasi:** "Implementasi Opsi C: migrasi avg_cost ke tabel items + buat item_cost_history audit table. Ikuti rencana di LANGKAH-EKSEKUSI-TIMELINE-RECONSTRUCT.md bagian Rencana Migrasi."
