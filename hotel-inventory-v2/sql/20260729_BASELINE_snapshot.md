# Baseline Snapshot — sebelum penambahan FK indexes

**Tanggal:** 2026-07-29
**Project Supabase:** `delonix-dashboard` (`ahompvfhgndlyjdocmiq`), region ap-northeast-1
**Plan:** Pro — daily backup otomatis, retensi 7 hari
**Tujuan:** titik pembanding untuk mengukur hasil `20260729_add_fk_indexes.sql`

---

## 1. Struktur index — kondisi awal

Kelima tabel target **hanya memiliki primary key**, tidak ada index lain:

| Tabel | Index yang ada |
|---|---|
| `adjustment_items` | `adjustment_items_pkey (id)` |
| `rmu_activity_history_items` | `rmu_activity_history_items_pkey (id)` |
| `room_additional_request_items` | `room_additional_request_items_pkey (id)` |
| `room_consumption` | `room_consumption_pkey (id)` |
| `room_consumption_items` | `room_consumption_items_pkey (id)` |

Kolom FK yang akan di-index (semua bertipe `uuid`, sudah diverifikasi ada):
`room_consumption.makeup_id`, `rmu_activity_history_items.history_id`,
`room_consumption_items.consumption_id`, `room_additional_request_items.request_id`,
`adjustment_items.adjustment_id`

## 2. Statistik scan — kondisi awal

| Tabel | seq_scan | seq_tup_read | idx_scan | rows | ukuran |
|---|---:|---:|---:|---:|---:|
| `rmu_activity_history_items` | 81.277 | **7.109.051.421** | 0 | 206.738 | 27 MB |
| `room_consumption_items` | 128.747 | **4.194.723.389** | 1 | 65.467 | 12 MB |
| `room_consumption` | 113.792 | **1.403.188.121** | 182.386 | 25.666 | 5.240 kB |
| `room_additional_request_items` | 12.829 | 22.113.648 | 0 | 3.429 | 552 kB |
| `adjustment_items` | 1.276 | 1.514.324 | 0 | 2.084 | 360 kB |

Total ± **12,7 miliar row** dibaca secara sequential.

## 3. Query lambat yang ditargetkan

| Query | calls | mean_ms | total_ms |
|---|---:|---:|---:|
| `DELETE FROM room_consumption WHERE makeup_id = $1` | 4.664 | **1.101,7** | 5.138.323 |
| `SELECT rmu_activity_history + items` (nested) | 12.816 | 277,6 | 3.557.942 |
| `SELECT room_consumption + items` (nested) | 15.333 | 115,0 | 1.763.309 |
| `DELETE FROM rmu_activity_history_items WHERE history_id = $1` | 6.450 | 215,4 | 1.389.569 |
| `SELECT rmu_activity_history.id + items` | 3.576 | 345,2 | 1.234.288 |
| `SELECT room_consumption.id + ...` | 3.581 | 195,3 | 699.240 |

## 4. Pola trafik (30 hari, WIB)

Puncak **18:00** (1.398 aktivitas), diikuti 19:00 (987), 16–17:00 (786).
Sepi **21:00–08:00** (2–94 aktivitas/jam).
Saat snapshot diambil: 12 koneksi idle, 1 active, tidak ada transaksi panjang.

## 5. Rencana pemulihan

| Lapis | Cakupan | Cara |
|---|---|---|
| 1. `DROP INDEX` | Pembatalan langsung perubahan ini | Jalankan `20260729_add_fk_indexes_ROLLBACK.sql` — hitungan detik, tanpa lock |
| 2. Daily backup Supabase | Seluruh database | Dashboard Supabase → Database → Backups (retensi 7 hari) |
| 3. Snapshot ini | Verifikasi kondisi awal | Bandingkan tabel di bagian 1 & 2 |

**Catatan penting:** `CREATE INDEX` tidak menulis, mengubah, atau menghapus satu baris data pun.
Lapis 2 dicatat sebagai kelengkapan prosedur, bukan karena perubahan ini berisiko terhadap data.

## 6. TEMUAN KRITIS — Disk I/O budget habis

Ditemukan dari Supabase Dashboard → Settings → Infrastructure (29 Jul 2026).
Banner peringatan aktif: *"Your project is currently exhausting multiple
resources, and its performance is affected."*

**Compute instance: `Nano`** (tingkat terkecil)

| Spesifikasi | Nilai |
|---|---|
| CPU | Shared cores |
| Memory | 0,5 GB |
| Baseline disk I/O | 43 Mbps |
| Burst disk I/O | 2.085 Mbps (48x baseline) |
| Jatah burst harian | 30 menit |

Disk I/O terpakai per hari: 22 Jul 22%, 23 Jul 22%, 24 Jul 65%, 25 Jul 58%,
**26 Jul 100%**, 27 Jul 78%, 28 Jul 50%, **29 Jul 100%**.
Max CPU 29 Jul melonjak ke ~90% (hari lain hanya 18–35%). Memory stabil 35–45%.

**Rantai sebab-akibat:**
index FK tidak ada → sequential scan miliaran row → konsumsi disk I/O besar →
jatah burst 30 menit habis di pagi hari → turun ke 43 Mbps baseline →
seluruh sistem melambat drastis.

Ini menjelaskan pola yang dilaporkan user: lambat di jam tertentu, dan
makin parah seiring pertumbuhan data.

**Status backup saat itu:** 6 daily backup tersedia (terbaru 28 Jul 23:58 UTC),
ada jeda di 25 Jul. PITR belum aktif (add-on berbayar).

## 7. HASIL — sesudah index terpasang

Diterapkan 29 Jul 2026 via `CREATE INDEX CONCURRENTLY`, tanpa downtime.
Kelima index `indisvalid = true`, `indisready = true`, nol index invalid tersisa.

| Index | Ukuran |
|---|---:|
| `idx_rmu_activity_history_items_history` | 2.176 kB |
| `idx_room_consumption_items_consumption` | 1.248 kB |
| `idx_room_consumption_makeup` | 768 kB |
| `idx_room_additional_request_items_request` | 96 kB |
| `idx_adjustment_items_adjustment` | 48 kB |
| **Total** | **± 4,2 MB** |

Verifikasi lewat `EXPLAIN (ANALYZE, BUFFERS)` — semua beralih ke `Index Scan`:

| Tabel | Sebelum (cost seq scan) | Sesudah | Buffer dibaca | Waktu |
|---|---:|---|---:|---:|
| `room_consumption` | 764,67 | Index Scan | 5 | 0,572 ms |
| `rmu_activity_history_items` | 4.384,38 | Index Scan | 6 | 3,567 ms |
| `room_consumption_items` | 1.940,42 | Index Scan | 5 | 2,234 ms |

`DELETE FROM room_consumption WHERE makeup_id` — baseline 1.101,7 ms,
kini menempuh jalur index dengan 5 buffer.

**Tindakan penyerta:** `ANALYZE` dijalankan pada kelima tabel.
`pg_stat_statements_reset()` berhasil — pengukuran waktu query dimulai
bersih dari 29 Jul 2026. `pg_stat_reset()` **ditolak** (butuh superuser),
jadi penghitung `seq_scan`/`idx_scan` di bagian 2 tetap kumulatif —
bandingkan sebagai selisih terhadap angka baseline tersebut.

## 8. Advisor report — 217 temuan

Dibaca lengkap 29 Jul 2026.

| Jumlah | Level | Jenis |
|---:|---|---|
| 162 | INFO | `unindexed_foreign_keys` |
| 21 | INFO | `unused_index` |
| 13 | INFO | `no_primary_key` |
| 13 | **WARN** | `multiple_permissive_policies` |
| 7 | **WARN** | `auth_rls_initplan` |
| 1 | INFO | `auth_db_connections_absolute` |

**Penting: angka 162 tidak boleh ditelan mentah.** Advisor menandai semua
FK tanpa index tanpa memeriksa apakah kolomnya dipakai memfilter.
Mayoritas berada di tabel kecil — `items` (288 baris), `transfers` (2.282),
`room_additional_requests` (1.957), `stock_balance` (4.899, sudah 1,8 juta
`idx_scan`) — di mana Postgres tidak akan memakai index sekalipun dibuat.
Menambahkan seluruh 157 sisanya justru memperlambat operasi tulis dan
memboroskan disk. **Tidak disarankan.**

Temuan yang layak ditindaklanjuti terpisah:
- 7 `auth_rls_initplan` — policy RLS mengevaluasi ulang `auth.<fn>()`
  per baris; menambah overhead di setiap query.
- 13 `multiple_permissive_policies` — policy ganda pada peran/aksi yang
  sama (contoh: `inventory.roles` punya `anon_all_roles` + `anon_read`
  untuk `anon`/`SELECT`).
- 21 `unused_index` — membebani operasi tulis tanpa manfaat baca.
- 13 `no_primary_key` — sebagian besar tabel `backup_*`.

## 9. Index tahap kedua — pembuatan nomor dokumen

Diterapkan 29 Jul 2026. Detail: `20260729_add_number_generation_indexes.sql`.

| Index | Ukuran | Query | Sebelum | Sesudah |
|---|---:|---|---:|---:|
| `idx_room_consumption_org_created` | 1.032 kB | number gen `RC-` | 90,6 ms | **0,113 ms** |
| `idx_rmu_activity_history_org_created` | 1.032 kB | number gen `AH-` | 69,9 ms | **0,088 ms** |

Keduanya `indisvalid = true`, memakai Index Scan, 3 buffer, berhenti di
baris pertama. Gabungan ± 7% beban database di baseline.

### Bug laten yang ditemukan saat pengujian

Index ini cepat **hanya selama prefix yang dicari ada di dalam data.**
Bila prefix tidak cocok dengan satu baris pun milik organisasi tersebut,
Postgres menelusuri seluruh baris organisasi itu:

```
Rows Removed by Filter: 9.491
Buffers: 3.067
Execution Time: 596 ms      <-- vs 0,088 ms bila prefix cocok
```

Pemicu di produksi: perubahan `organizations.code`, atau **perubahan format
nomor dokumen** — dan yang terakhir bukan hipotesis, commit `07abc29`
mengubah format makeup menjadi `MU-{code}-YYMMXXXX`.

Ditambah, pola `generateNumber()` membaca nomor terakhir lalu menambah 1
di sisi client — **dua user yang membuat dokumen bersamaan bisa mendapat
nomor kembar.** Pola RPC atomik `fn_generate_makeup_number` (sudah dipakai
`room_makeups`) menutup kedua masalah sekaligus. Tabel yang masih memakai
pola lama: `room_consumption`, `direct_purchases`, `transfers`,
`single_item_usage`.

## 10. Langkah lanjutan

1. **Pantau 1–2 hari.** Cek ulang grafik Disk I/O di Settings →
   Infrastructure. Jika konsumsi harian turun dari 100%, perbaikan berhasil
   dan upgrade compute kemungkinan tidak diperlukan.
2. **Ganti `generateNumber()` dengan RPC atomik** — memperbaiki race
   condition sekaligus menghilangkan skenario 596 ms di atas.
3. **Bereskan temuan RLS** — 7 `auth_rls_initplan` + 13 policy ganda.
4. **Periksa pg_cron.** Schema `cron` aktif; job terjadwal yang berat bisa
   ikut menyumbang beban I/O.
5. **Tabel backup lama.** `backup_20260419_*` (5 tabel) dan
   `stock_movements_backup_20260405` — total ± 17 MB, tidak dipakai
   aplikasi. Penghapusan bersifat permanen, perlu keputusan eksplisit.
6. **Jangka panjang:** strategi arsip/partisi `stock_movements`
   (502 rb baris, 173 MB, tumbuh paling cepat).
