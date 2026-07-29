-- ============================================================
-- ROLLBACK untuk 20260729_add_fk_indexes.sql
--
-- Menghapus index mengembalikan database ke kondisi persis
-- sebelum perubahan. TIDAK ADA data yang hilang -- CREATE INDEX
-- sama sekali tidak menyentuh isi tabel, hanya menambah
-- struktur bantu pencarian.
--
-- Eksekusi: aman kapan saja, termasuk saat jam sibuk.
-- DROP INDEX CONCURRENTLY tidak mengunci tabel.
-- ============================================================

DROP INDEX CONCURRENTLY IF EXISTS inventory.idx_room_consumption_makeup;
DROP INDEX CONCURRENTLY IF EXISTS inventory.idx_rmu_activity_history_items_history;
DROP INDEX CONCURRENTLY IF EXISTS inventory.idx_room_consumption_items_consumption;
DROP INDEX CONCURRENTLY IF EXISTS inventory.idx_room_additional_request_items_request;
DROP INDEX CONCURRENTLY IF EXISTS inventory.idx_adjustment_items_adjustment;


-- ============================================================
-- KONDISI AWAL (state yang dipulihkan oleh skrip ini)
-- Diambil 2026-07-29. Kelima tabel HANYA punya primary key:
--
--   adjustment_items_pkey              (id)
--   rmu_activity_history_items_pkey    (id)
--   room_additional_request_items_pkey (id)
--   room_consumption_pkey              (id)
--   room_consumption_items_pkey        (id)
--
-- Verifikasi setelah rollback -- harus mengembalikan
-- tepat 5 baris, semuanya *_pkey:
--
-- SELECT tablename, indexname FROM pg_indexes
-- WHERE schemaname = 'inventory'
--   AND tablename IN ('room_consumption','rmu_activity_history_items',
--                     'room_consumption_items','room_additional_request_items',
--                     'adjustment_items')
-- ORDER BY tablename, indexname;
-- ============================================================
