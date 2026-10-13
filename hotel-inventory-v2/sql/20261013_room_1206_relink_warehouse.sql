-- ============================================================
-- 20261013_room_1206_relink_warehouse.sql
-- Perbaikan data (dijalankan langsung 13 Okt 2026, dicatat di sini).
--
-- GEJALA: di halaman Rooms, kamar 1206 (DAI) menampilkan "Not a Warehouse".
--
-- SEBAB: inventory.rooms.warehouse_id kamar 1206 NULL. Gudang RM-DAI-1206
-- sudah ada sejak 26 Mar 2026. Kamar 1206 dibuat ULANG 4 Okt 2026 02:18
-- (semenit sesudah kamar salah ketik "12066" dibuat lalu dihapus).
-- RoomsPage SELALU meng-insert gudang baru saat kamar disimpan, padahal ada
-- unique index warehouses(organization_id, code) -- insert gagal, proses
-- berhenti, baris kamar terlanjur tersimpan tanpa warehouse_id.
--
-- DAMPAK: fn_auto_confirm_room_makeups (cron 02:00 WIB) tidak menolak
-- dokumen tanpa gudang kamar; ia hanya melewati kaki jurnal sisi kamar
-- (IF v_room_wh IS NOT NULL). 7 dokumen 1206 yang CONFIRMED 4-11 Okt hanya
-- memposting separuh pasangan:
--   48 helai OUT dari HK Store tanpa IN ke mana pun (stok lenyap dari buku)
--   11 helai IN ke DRT-DAI tanpa OUT dari kamar (stok muncul dari ketiadaan)
-- Saldo RM-DAI-1206 tetap 0. Kamar 1206 satu-satunya kamar dengan
-- warehouse_id NULL di seluruh sistem.
-- ============================================================

UPDATE inventory.rooms r
   SET warehouse_id = '8cd72bb8-fbf0-4136-8186-989dbb0ac0d0',  -- RM-DAI-1206
       updated_at = now()
 WHERE r.id = 'a726e2f7-a255-4029-adc2-1c7ced632129'           -- Room 1206 DAI
   AND r.warehouse_id IS NULL
   AND EXISTS (SELECT 1 FROM inventory.warehouses w
                WHERE w.id = '8cd72bb8-fbf0-4136-8186-989dbb0ac0d0'
                  AND w.organization_id = r.organization_id
                  AND w.warehouse_type = 'room' AND w.is_active);
-- 1 baris. Tidak ada stok yang berpindah.

-- VERIFIKASI SESUDAH: rooms tanpa warehouse_id = 0; RM-DAI-1206 ditunjuk
-- tepat 1 kamar. Dokumen DRAFT MU-DAI-26101093 (12 Okt) kini akan diposting
-- utuh oleh cron.
--
-- CATATAN: "Enable as Warehouse" di UI TIDAK bisa dipakai untuk kasus ini --
-- tombol itu meng-insert gudang baru dengan kode yang sama dan akan gagal.


-- ============================================================
-- BELUM DIKERJAKAN
--
-- 1. Kode: RoomsPage harus memakai gudang RM-<org>-<nomor> yang sudah ada
--    bila ada, dan kamar tidak boleh tersimpan tanpa gudang bila pembuatan
--    gudang gagal.
-- 2. Kode: fn_auto_confirm_room_makeups harus GAGAL BERSUARA untuk kamar
--    tanpa warehouse_id, bukan diam-diam memposting separuh jurnal.
-- 3. Data: 48 helai hilang dan 11 helai muncul sendiri perlu penyesuaian --
--    SESUDAH cek fisik isi kamar 1206, bukan dihitung di atas kertas.
-- ============================================================
