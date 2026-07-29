-- ============================================================
-- 20260729_add_number_generation_indexes.sql
-- Index pendukung pembuatan nomor dokumen otomatis.
--
-- MASALAH:
--   generateNumber() di src/pages/RoomMakeUpPageNew.jsx:176 menjalankan
--   query ini setiap kali dokumen dibuat:
--
--     WHERE organization_id = $1
--       AND <number_field> LIKE '<PREFIX>-<CODE>-%'
--     ORDER BY created_at DESC
--     LIMIT 1
--
--   Tanpa index pendukung, Postgres melakukan seq scan penuh + sort.
--   Baseline:
--     room_consumption      29.226 calls x 90,6 ms  = 3,9% total DB time
--     rmu_activity_history  31.612 calls x 69,9 ms  = 3,3% total DB time
--
-- SOLUSI:
--   Index (organization_id, created_at DESC) memungkinkan Postgres
--   menelusuri index secara terbalik dan berhenti di baris pertama
--   yang lolos filter LIKE.
--
-- CATATAN: jangan bungkus dalam transaction block (CONCURRENTLY).
-- Rollback: lihat 20260729_add_number_generation_indexes_ROLLBACK.sql
-- ============================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_room_consumption_org_created
  ON inventory.room_consumption (organization_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rmu_activity_history_org_created
  ON inventory.rmu_activity_history (organization_id, created_at DESC);


-- ============================================================
-- HASIL TERUKUR (EXPLAIN ANALYZE, 29 Jul 2026)
--
--   room_consumption      90,6 ms -> 0,113 ms  (3 buffer)
--   rmu_activity_history  69,9 ms -> 0,088 ms  (3 buffer)
--
-- Keduanya memakai Index Scan dan berhenti di baris pertama.
-- ============================================================


-- ============================================================
-- PERINGATAN: BUG LATEN PADA POLA generateNumber()
--
-- Index ini hanya cepat SELAMA prefix yang dicari benar-benar ada
-- di dalam data. Jika prefix TIDAK cocok dengan satu baris pun
-- milik organisasi tersebut, Postgres menelusuri SELURUH baris
-- organisasi itu sebelum menyerah.
--
-- Terukur saat pengujian dengan prefix yang salah:
--   Rows Removed by Filter: 9.491
--   Buffers: 3.067
--   Execution Time: 596 ms   <-- vs 0,088 ms bila prefix cocok
--
-- Kapan ini terjadi di produksi:
--   1. Kode organisasi (organizations.code) diubah -> prefix berubah,
--      tidak ada baris lama yang cocok.
--   2. Format nomor dokumen diganti. Ini BUKAN hipotesis: commit
--      07abc29 mengubah format makeup menjadi MU-{code}-YYMMXXXX.
--      Setiap perubahan format memicu skenario ini sampai baris
--      pertama berformat baru tercipta.
--   3. Organisasi baru yang tabelnya sudah berisi data organisasi lain.
--
-- Perbaikan yang disarankan (belum diterapkan):
--   Ganti pola baca-lalu-tambah-1 di sisi client dengan RPC atomik,
--   seperti fn_generate_makeup_number yang sudah dipakai room_makeups
--   (commit 07abc29). Selain menghilangkan masalah performa di atas,
--   ini juga menutup RACE CONDITION: dua user yang membuat dokumen
--   bersamaan saat ini bisa mendapat nomor kembar.
--
--   Tabel yang masih memakai pola lama:
--     room_consumption      (RoomMakeUpPageNew.jsx:594)
--     direct_purchases      (DirectPurchasePage.jsx:68)
--     transfers             (TransferPage.jsx)
--     single_item_usage     (SingleItemUsagePage.jsx)
-- ============================================================
