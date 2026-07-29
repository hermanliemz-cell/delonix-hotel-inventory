-- ============================================================
-- 20260729_add_fk_indexes.sql
-- Tambah index pada kolom foreign key yang belum ter-index.
--
-- MASALAH: 5 tabel di bawah HANYA punya primary key, nol index lain.
-- Akibatnya Postgres melakukan sequential scan ~11 miliar row
-- untuk operasi yang seharusnya hanya menyentuh ratusan row.
--
-- CATATAN PENTING:
--   CREATE INDEX CONCURRENTLY tidak boleh dijalankan di dalam
--   transaction block. Jalankan satu per satu, JANGAN dibungkus
--   BEGIN/COMMIT dan jangan lewat migration runner yang auto-wrap.
--
-- Rollback: lihat 20260729_add_fk_indexes_ROLLBACK.sql
-- ============================================================

-- [1] PRIORITAS TERTINGGI
-- DELETE FROM room_consumption WHERE makeup_id = $1
-- Baseline: 4.664 calls x 1.101,7 ms = 5.138 detik (7,6% total DB time)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_room_consumption_makeup
  ON inventory.room_consumption (makeup_id);

-- [2] Tabel dengan seq_tup_read tertinggi: 7,1 miliar row
-- DELETE FROM rmu_activity_history_items WHERE history_id = $1
-- Baseline: 6.450 calls x 215,4 ms
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rmu_activity_history_items_history
  ON inventory.rmu_activity_history_items (history_id);

-- [3] seq_tup_read 4,19 miliar row; idx_scan hanya 1x seumur hidup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_room_consumption_items_consumption
  ON inventory.room_consumption_items (consumption_id);

-- [4] seq_scan 12.829x, idx_scan 0
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_room_additional_request_items_request
  ON inventory.room_additional_request_items (request_id);

-- [5] seq_scan 1.276x, idx_scan 0
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_adjustment_items_adjustment
  ON inventory.adjustment_items (adjustment_id);


-- ============================================================
-- VERIFIKASI (jalankan setelah semua index dibuat)
-- Semua baris harus indisvalid = false DAN indisready = true.
-- Jika ada yang indisvalid = true, index gagal dibangun:
-- DROP index tersebut lalu ulangi perintah CREATE-nya.
-- ============================================================
-- SELECT i.relname            AS index_name,
--        x.indisvalid         AS gagal_invalid,
--        x.indisready         AS siap_dipakai,
--        pg_size_pretty(pg_relation_size(i.oid)) AS ukuran
-- FROM pg_index x
-- JOIN pg_class i ON i.oid = x.indexrelid
-- JOIN pg_namespace n ON n.oid = i.relnamespace
-- WHERE n.nspname = 'inventory'
--   AND i.relname IN (
--     'idx_room_consumption_makeup',
--     'idx_rmu_activity_history_items_history',
--     'idx_room_consumption_items_consumption',
--     'idx_room_additional_request_items_request',
--     'idx_adjustment_items_adjustment'
--   );
