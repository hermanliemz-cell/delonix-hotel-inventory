---
name: stock-control-audit
description: >
  Audit menyeluruh kontrol stok se-sistem, berbasis bukti dari database produksi, lalu
  susun laporan risiko berperingkat. Gunakan skill ini saat diminta menginspeksi logika
  dan urutan proses stock movement secara keseluruhan, menyelidiki keluhan "stok sering
  kurang / tidak cocok", mencari sumber selisih stok, atau menyusun laporan risiko dan
  usulan kontrol. Berbeda dari stock-movement-audit yang menilai SATU halaman — skill ini
  mengaudit SELURUH sistem dan mewajibkan setiap temuan diverifikasi ke data sebelum
  dilaporkan. Triggers: audit stok, inspeksi proses stok, stok sering kurang, selisih stok,
  stock tidak cocok, cari sumber kehilangan stok, laporan risiko stok, usulan kontrol stok,
  review menyeluruh stock movement.
---

# Stock Control Audit

Audit se-sistem untuk menemukan **dari mana stok benar-benar berkurang**, lalu menyusun
laporan yang bisa ditindaklanjuti.

## Aturan utama: verifikasi sebelum melapor

Ini bukan formalitas. Pada audit 29 Juli 2026, pembacaan kode menghasilkan tiga klaim
"kritis" yang ternyata **salah** setelah dicek ke database:

| Klaim dari baca kode | Kenyataan |
|---|---|
| `DELETE` mentah pada `stock_movements` meninggalkan saldo terpotong | **Salah.** Trigger `fn_revert_stock_movement` (BEFORE DELETE) membalik saldo otomatis |
| Race pada INSERT `stock_balance` menyebabkan baris ganda | **Salah.** Ada UNIQUE `(organization_id, item_id, warehouse_id)` |
| Saldo bisa minus | **Salah.** Ditolak trigger DAN CHECK `quantity >= 0` |

Melaporkan ketiganya akan membuang waktu tim mengejar masalah yang tidak ada, dan
menggerus kepercayaan pada seluruh laporan.

**Setiap temuan wajib punya salah satu dari ini sebelum masuk laporan:**
- kueri database yang membuktikannya, atau
- kutipan kode dengan nomor baris yang sudah dibaca sendiri, atau
- label eksplisit "belum terverifikasi" beserta cara mengujinya

## Urutan kerja

### Langkah 1 — Petakan dulu, jangan langsung baca kode

```sql
-- Fungsi apa saja yang menyentuh stok
SELECT p.proname, pg_get_function_identity_arguments(p.oid), p.prosecdef
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'inventory'
  AND (p.prosrc ILIKE '%stock_movements%' OR p.prosrc ILIKE '%stock_balance%')
ORDER BY p.proname;

-- Trigger: ini yang menentukan apakah saldo dijaga DB atau aplikasi
SELECT c.relname, t.tgname, p.proname
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'inventory' AND NOT t.tgisinternal
  AND c.relname IN ('stock_movements', 'stock_balance');

-- Pertahanan yang sudah ada — CEK INI SEBELUM melaporkan celah apa pun
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid = 'inventory.stock_balance'::regclass;
```

Baca isi trigger BEFORE INSERT sepenuhnya. Kalau saldo dijaga trigger, aplikasi tidak
mungkin membuat saldo menyimpang — dan itu mempersempit pencarian secara drastis.

### Langkah 2 — Kueri penentu: apakah pembukuan konsisten?

Jalankan ini **lebih dulu**. Hasilnya menentukan seluruh arah audit.

```sql
WITH ledger AS (
  SELECT organization_id, item_id, warehouse_id,
         SUM(CASE WHEN movement_type = 'IN' THEN quantity ELSE -quantity END) AS qty_ledger
  FROM inventory.stock_movements
  GROUP BY 1, 2, 3
)
SELECT count(*) FILTER (WHERE COALESCE(sb.quantity,0) <> COALESCE(l.qty_ledger,0)) AS tidak_cocok,
       count(*) AS total_kombinasi,
       round(SUM(ABS(COALESCE(sb.quantity,0) - COALESCE(l.qty_ledger,0))), 2) AS selisih_unit
FROM ledger l
FULL OUTER JOIN inventory.stock_balance sb
  ON sb.organization_id = l.organization_id
 AND sb.item_id = l.item_id
 AND sb.warehouse_id = l.warehouse_id;
```

- **Selisih 0** → pembukuan bersih. Stok yang "hilang" berasal dari **proses**, bukan
  perhitungan. Lanjut ke Langkah 3 dan 4; jangan buang waktu mencari bug aritmetika.
- **Ada selisih** → ada penulisan langsung ke `stock_balance` yang melewati trigger,
  atau trigger pernah dimatikan. Telusuri itu lebih dulu.

### Langkah 3 — Cari pergerakan yang tidak berpasangan

Jenis movement transfer (OUT di satu tempat, IN di tempat lain) **harus** berjumlah sama.
Ketidakseimbangan berarti barang keluar tapi tidak pernah sampai.

```sql
SELECT reference_type, movement_type, count(*) AS jml, round(sum(quantity),0) AS qty
FROM inventory.stock_movements GROUP BY 1, 2 ORDER BY 3 DESC;
```

Bandingkan pasangan OUT/IN per `reference_type`. Yang memang sepihak: `CONSUMPTION`,
`ITEM_LOST`, `GR`, `OPENING_BALANCE`, `DIRECT_PURCHASE`. Sisanya harus seimbang.

Lalu turunkan ke dokumennya — **dan selalu lihat tanggalnya**:

```sql
WITH per_ref AS (
  SELECT reference_type, reference_number,
         count(*) FILTER (WHERE movement_type='OUT') AS n_out,
         count(*) FILTER (WHERE movement_type='IN')  AS n_in,
         min(created_at) AS dibuat
  FROM inventory.stock_movements
  WHERE reference_type IN ('MAKEUP-LINEN REPLACE','MAKEUP-DIRTY','MAKEUP-TO-HK','TRANSFER')
  GROUP BY 1, 2
)
SELECT * FROM per_ref WHERE n_out <> n_in ORDER BY dibuat;
```

**Tanggal adalah kuncinya.** Kalau semua kerusakan berhenti di suatu tanggal, bug-nya
sudah diperbaiki dan yang tersisa hanya residu — laporkan begitu, jangan sebagai masalah
aktif. Pada audit Juli 2026, seluruh 16 dokumen rusak terjadi 1–16 April dan berhenti
tepat setelah migrasi ke RPC atomik.

### Langkah 4 — Bukti double-posting

Ini uji yang menentukan, bukan sekadar dugaan dari baca kode. Bandingkan jumlah movement
terhadap jumlah baris dokumen:

```sql
WITH a AS (
  SELECT ad.id,
         (SELECT count(*) FROM inventory.adjustment_items ai WHERE ai.adjustment_id = ad.id) AS baris,
         (SELECT count(*) FROM inventory.stock_movements m
           WHERE m.reference_id = ad.id AND m.reference_type = 'ADJUSTMENT') AS movement
  FROM inventory.adjustments ad WHERE ad.status = 'CONFIRMED'
)
SELECT count(*) FILTER (WHERE movement > baris) AS kelebihan,
       count(*) FILTER (WHERE movement = baris) AS normal,
       count(*) FILTER (WHERE movement < baris) AS kurang
FROM a;
```

Untuk transfer, pembandingnya `baris * 2` (OUT + IN).

**Peringatan tafsir:** sebelum menyimpulkan "kurang movement", cek dulu kelengkapan
`reference_id` — bisa jadi movement-nya ada tapi tidak tertaut:

```sql
SELECT reference_type, count(*) AS total,
       count(*) FILTER (WHERE reference_id IS NULL) AS tanpa_ref_id
FROM inventory.stock_movements GROUP BY 1 ORDER BY 3 DESC;
```

Jangan pakai "movement kembar dalam N detik" sebagai bukti double-submit. Dokumen dengan
dua baris item yang sama menghasilkan movement kembar yang **sah**.

### Langkah 5 — Dokumen mangkrak

Sering jadi sumber terbesar selisih fisik vs sistem: pekerjaan fisik sudah dilakukan,
stok tidak pernah tercatat berpindah.

```sql
SELECT 'transfers' AS dok, status, count(*), min(transfer_date) AS tertua
FROM inventory.transfers WHERE lower(status) NOT IN ('confirmed','completed') GROUP BY 1,2
UNION ALL
SELECT 'room_makeups', status, count(*), min(makeup_date)
FROM inventory.room_makeups WHERE status <> 'CONFIRMED' GROUP BY 1,2
UNION ALL
SELECT 'room_additional_requests', status, count(*), min(request_date)
FROM inventory.room_additional_requests WHERE lower(status) <> 'confirmed' GROUP BY 1,2;
```

Perhatikan **casing status tidak konsisten** antar tabel: `room_additional_requests`
memakai huruf kecil, tabel lain huruf besar. Selalu pakai `lower(status)` atau
`IN ('DRAFT','draft')`.

### Langkah 6 — Audit sisi aplikasi secara paralel

Sebar beberapa subagent, satu per kelompok halaman, masing-masing menilai
**checklist 9 titik** dari skill `stock-movement-audit`. Kelompok yang terbukti efektif:

1. Alur confirm lewat RPC (RoomMakeUp, RoomAdditionalRequest, Approval)
2. Halaman yang menggerakkan stok langsung (Transfer, WriteOff, Adjustment, SingleItemUsage, InUseWarehouse, Laundry)
3. Pemasukan & penghitungan + helper bersama (OpeningBalance, StockOpname, DirectPurchase, PurchaseReceived, stockService.js, utils/stock.js)

Wajib disebutkan dalam prompt subagent:
- baca berkas **utuh**, jangan menyampel
- sertakan **nomor baris** sebagai bukti untuk setiap vonis
- kalau alurnya satu panggilan RPC, checklist dijawab NA — yang dinilai justru
  penanganan error, penjaga double-submit, dan refresh state
- **jangan usulkan perbaikan**, hanya temuan
- urutkan berdasarkan kemampuannya benar-benar menghilangkan stok

### Langkah 7 — Verifikasi silang temuan subagent

Klaim yang **selalu** salah kalau tidak dicek:

```sql
-- Nama tabel & kolom yang disebut kode benar-benar ada?
SELECT table_name FROM information_schema.tables WHERE table_schema = 'inventory';
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'inventory' AND table_name = '<tabel>';
```

Pada audit Juli 2026 cara ini mengungkap tiga cacat nyata sekaligus menggugurkan
klaim-klaim palsu: tabel `stock_balances` (jamak) tidak ada, `stock_opname_items` tidak
ada, `write_off_items` berkolom `wo_id` bukan `write_off_id` dan tidak punya kolom
`reason`, serta `period_locks` memakai `period_month`/`period_year` sementara helper
mencari `month`/`year` — artinya penguncian periode tidak pernah aktif.

Untuk klaim scope JavaScript (misal variabel rollback dideklarasikan di `try` tapi
dipakai di `catch`), verifikasi sendiri dengan melihat nomor baris `try`/`catch`-nya.

## Menyusun laporan

Susun sebagai artifact bila temuannya banyak — ini dokumen rujukan yang akan dibuka
berulang dan dibagikan ke tim.

**Urutan yang terbukti berhasil:**

1. **Kesimpulan utama lebih dulu.** Kalau pembukuan bersih, katakan di paragraf pertama.
   Pembaca perlu tahu ini sebelum membaca daftar risiko, kalau tidak mereka akan mengira
   sistemnya rusak total.
2. **Apa yang sudah aman.** Cegah tim "memperbaiki" yang sudah benar. Sertakan angka.
3. **Daftar risiko berperingkat**, diurutkan berdasarkan kemampuan nyata menghilangkan
   stok — bukan berdasarkan keanggunan teknis. Setiap butir: apa yang rusak, akibat
   nyatanya bagi orang, lalu `berkas:baris`.
4. **Usulan perbaikan berurutan** berdasarkan rasio manfaat/usaha. Tunjukkan bila satu
   perbaikan menutup beberapa risiko sekaligus.
5. **Catatan koreksi.** Cantumkan klaim yang terbukti salah, supaya tidak ada yang
   mengejarnya.

**Selalu tunjuk contoh yang sudah benar di dalam sistem itu sendiri.** Jauh lebih mudah
diterima daripada pola dari luar. Contoh: `LaundryPage.handleSendToLaundry` dan
`record_batch_transfer` adalah pola yang seharusnya ditiru halaman lain.

## Yang mudah salah tafsir

- **Selisih nol bukan berarti tidak ada masalah.** Artinya masalahnya ada di proses,
  bukan di perhitungan. Arahkan pencarian ke sana.
- **Konfirmasi terjadwal menciptakan bercak buta.** Kalau dokumen baru dikonfirmasi jam
  02:00, sepanjang hari sistem menampilkan stok lebih banyak dari kenyataan. Ini sering
  jadi jawaban sesungguhnya atas keluhan "sistem bilang ada, gudang kosong".
- **Gudang kamar berbeda sifat dari gudang HK.** Kegagalan `to_hk_store` biasanya berarti
  saldo kamar tidak akurat, bukan barang kurang.
- **Cek riwayat cron sebelum menyalahkan logika.** `cron.job_run_details` bisa
  menunjukkan `job startup timeout` — job tidak pernah jalan sama sekali, dan tabel log
  aplikasi tidak akan punya entri apa pun untuk malam itu.
