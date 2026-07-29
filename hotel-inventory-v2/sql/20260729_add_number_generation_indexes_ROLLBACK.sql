-- ============================================================
-- ROLLBACK untuk 20260729_add_number_generation_indexes.sql
--
-- Menghapus index tidak menyentuh data sama sekali.
-- DROP INDEX CONCURRENTLY tidak mengunci tabel -- aman kapan saja.
-- ============================================================

DROP INDEX CONCURRENTLY IF EXISTS inventory.idx_room_consumption_org_created;
DROP INDEX CONCURRENTLY IF EXISTS inventory.idx_rmu_activity_history_org_created;


-- ============================================================
-- KONDISI AWAL (state yang dipulihkan)
-- Sebelum perubahan, kedua tabel tidak punya index apa pun
-- pada organization_id.
--
-- Verifikasi setelah rollback -- kedua nama index di bawah
-- harus TIDAK muncul:
--
-- SELECT tablename, indexname FROM pg_indexes
-- WHERE schemaname = 'inventory'
--   AND tablename IN ('room_consumption','rmu_activity_history')
-- ORDER BY tablename, indexname;
-- ============================================================
