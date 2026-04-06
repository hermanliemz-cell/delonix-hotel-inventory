---
name: stock-movement-audit
description: >
  Audit checklist & pattern guide for any page that creates inventory stock movements via Supabase.
  Use this skill whenever building, reviewing, or debugging a page/function that inserts rows into
  stock_movements, stock_balance, or similar inventory tables. Triggers: stock movement, inventory confirm,
  pre-validation, rollback pattern, stok keluar, stok masuk, room makeup, write-off, additional request,
  transfer, opname, atau halaman apapun yang mengubah saldo stok.
---

# Stock Movement Audit

Skill ini adalah checklist & panduan pattern untuk memastikan setiap halaman input yang membuat stock movement di sistem hotel-inventory sudah aman dari data inconsistency.

## Kapan Menggunakan Skill Ini

Gunakan skill ini setiap kali:
- Membuat halaman baru yang melakukan INSERT ke `stock_movements`
- Me-review halaman existing yang melakukan confirm/approve dan membuat movement
- Debugging masalah stok tidak balance atau orphaned movements
- Menambahkan fitur baru yang mengubah `stock_balance`

## 3 Pilar Keamanan Stock Movement

### 1. Pre-Validation (Cek Sebelum Bertindak)

**Prinsip**: Kumpulkan SEMUA kebutuhan OUT terlebih dahulu, cek saldo stok, dan BATALKAN sepenuhnya jika ada yang tidak cukup. Jangan pernah membuat movement parsial.

**Mengapa ini penting**: Tanpa pre-validation, ketika item ke-5 dari 10 gagal karena stok tidak cukup, 4 movement yang sudah dibuat menjadi orphan dan merusak saldo stok. Membersihkan ini secara manual sangat menyakitkan dan error-prone.

**Pattern**:

```
Langkah 1: Kumpulkan semua kebutuhan OUT ke dalam satu map
           Key = item_id, Value = { totalQty, itemLabel }

Langkah 2: Untuk setiap item di map, query stock_balance

Langkah 3: Bandingkan saldo vs kebutuhan
           → Jika ADA yang kurang: kumpulkan SEMUA kekurangan ke array
           → Tampilkan SEMUA kekurangan sekaligus (bukan satu-satu)
           → BATALKAN seluruh operasi

Langkah 4: Baru lanjut ke pembuatan movement
```

Lihat `references/pre-validation-example.js` untuk contoh kode lengkap.

**Checklist Pre-Validation**:
- [ ] Semua item OUT dikumpulkan ke map sebelum query apapun
- [ ] Setiap item di-query saldo-nya dari `stock_balance`
- [ ] Filter warehouse yang benar (hk_store, floor_stock, dll)
- [ ] Semua kekurangan dikumpulkan, bukan gagal di item pertama
- [ ] Pesan error menampilkan SEMUA item yang kurang beserta angkanya
- [ ] Fungsi return/abort sepenuhnya jika ada kekurangan
- [ ] Tidak ada movement yang dibuat sebelum validasi selesai

### 2. Optimistic Locking (Cegah Double-Submit)

**Prinsip**: Gunakan transisi status atomik dengan `.select()` untuk mendeteksi akses konkuren. Jika dua user menekan Confirm bersamaan, hanya satu yang boleh lolos.

**Mengapa ini penting**: Tanpa locking, dua user bisa confirm dokumen yang sama secara bersamaan, menghasilkan movement ganda dan saldo stok yang rusak.

**Pattern**:

```javascript
// Atomic status transition: DRAFT → PROCESSING
const { data: locked, error: lockErr } = await supabase
  .from('nama_tabel')
  .update({ status: 'processing', updated_at: new Date().toISOString() })
  .eq('id', record.id)
  .eq('status', 'draft')        // ← hanya berhasil jika masih draft
  .select()
  .maybeSingle();

if (!locked) {
  showNotification('Dokumen sedang diproses user lain atau sudah di-confirm.', 'error');
  return;
}
```

**Checklist Optimistic Locking**:
- [ ] Status diubah secara atomik dengan `.eq('status', 'draft')` guard
- [ ] Menggunakan `.select().maybeSingle()` untuk verifikasi
- [ ] Handle kasus `!locked` → abort dengan pesan yang jelas
- [ ] Tidak ada gap antara check status dan update status (harus satu query)

### 3. Rollback on Failure (Bersihkan Jika Gagal)

**Prinsip**: Jika terjadi error di tengah pembuatan movement, bersihkan SEMUA movement yang sudah dibuat dan kembalikan status dokumen ke draft.

**Mengapa ini penting**: Supabase/PostgreSQL melalui REST API tidak mendukung transaction yang span multiple request. Setiap `.insert()` atau `.update()` adalah operasi independen. Jika operasi ke-3 gagal, operasi 1 dan 2 sudah committed. Kita harus membersihkan secara manual.

**Pattern ada dua pendekatan**:

#### a) Watermark Pattern (cocok untuk movement massal)

```javascript
const attemptStartedAt = new Date().toISOString();

try {
  // ... buat movements ...
  // ... update saldo ...
  // ... set status confirmed ...
} catch (err) {
  // Hapus semua movement yang dibuat setelah watermark
  await supabase.from('stock_movements')
    .delete()
    .eq('document_id', record.id)
    .gte('created_at', attemptStartedAt);

  // Revert status
  await supabase.from('nama_tabel')
    .update({ status: 'draft' })
    .eq('id', record.id)
    .eq('status', 'processing');
}
```

#### b) Document ID Tracking (cocok untuk multi-tabel)

```javascript
const createdDocIds = [];

try {
  // Setiap kali create, simpan ID-nya
  const { data } = await supabase.from('child_table').insert({...}).select('id');
  if (data) createdDocIds.push(data[0].id);
  // ... lanjut ...
} catch (err) {
  // Hapus berdasarkan collected IDs
  for (const id of createdDocIds) {
    await supabase.from('child_table').delete().eq('id', id);
  }
  // Revert status
  await supabase.from('parent_table')
    .update({ status: 'draft' })
    .eq('id', record.id);
}
```

**Checklist Rollback**:
- [ ] Ada try-catch yang membungkus seluruh blok pembuatan movement
- [ ] Catch block menghapus movement yang sudah dibuat (watermark ATAU id tracking)
- [ ] Status dokumen dikembalikan ke draft di catch block
- [ ] Catch block TIDAK throw ulang sebelum cleanup selesai
- [ ] `setSaving(false)` atau equivalent dipanggil di finally/catch

### 4. Bonus: Cost Handling

**Pattern**: Untuk movement OUT, capture `avg_cost` dari sumber SEBELUM membuat movement:

```javascript
const { data: sourceBalance } = await supabase
  .from('stock_balance')
  .select('avg_cost')
  .eq('item_id', itemId)
  .eq('warehouse_id', sourceWarehouseId)
  .maybeSingle();

const unitCost = sourceBalance?.avg_cost || 0;
// Gunakan unitCost ini di movement OUT dan IN yang terkait
```

**Mengapa**: Jika avg_cost diambil setelah OUT movement, nilainya mungkin sudah berubah karena recalculation.

## Quick Audit Checklist

Ketika mereview sebuah halaman, periksa secara berurutan:

```
□ 1. LOCK    — Apakah ada optimistic locking saat mulai confirm?
□ 2. COLLECT — Apakah semua kebutuhan OUT dikumpulkan dulu ke satu map?
□ 3. CHECK   — Apakah saldo dicek untuk SEMUA item sebelum movement apapun?
□ 4. ABORT   — Jika ada kekurangan, apakah operasi dibatalkan sepenuhnya?
□ 5. COST    — Apakah avg_cost di-capture SEBELUM OUT movement?
□ 6. TRY     — Apakah blok pembuatan movement dibungkus try-catch?
□ 7. CLEAN   — Apakah catch block menghapus orphaned movements?
□ 8. REVERT  — Apakah catch block mengembalikan status ke draft?
□ 9. NOTIFY  — Apakah error ditampilkan ke user dengan detail yang cukup?
```

## Halaman yang Sudah Diaudit

| Halaman | File | Status |
|---------|------|--------|
| Room Make Up | `RoomMakeUpPageNew.jsx` → `handleConfirmMakeup()` | ✅ Lengkap |
| Room Additional Request | `RoomAdditionalRequestPage.jsx` → `handleConfirm()` | ✅ Lengkap |
| Write Off | `WriteOffPage.jsx` | ✅ Lengkap |
| Approval | `ApprovalPage.jsx` | ✅ Lengkap |

## Anti-Pattern yang Harus Dihindari

1. **Destructive Save**: Jangan DELETE semua child items lalu re-INSERT saat save draft. Jika INSERT gagal, data hilang permanen. Gunakan upsert atau compare-and-patch.

2. **Partial Movement**: Jangan buat movement satu per satu tanpa pre-validasi. Jika item ke-5 gagal, item 1-4 sudah merusak saldo.

3. **Silent Failure**: Jangan catch error tanpa memberitahu user atau tanpa cleanup. Movement orphan yang tidak dibersihkan akan terakumulasi.

4. **Status tanpa Guard**: Jangan update status tanpa `.eq('status', 'expected_status')` guard. Ini membuka peluang double-submit.

5. **Cost After Movement**: Jangan ambil avg_cost setelah OUT movement dibuat. Nilai sudah berubah.
