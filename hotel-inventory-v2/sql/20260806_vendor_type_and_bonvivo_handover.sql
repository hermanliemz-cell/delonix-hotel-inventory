-- ============================================================
-- 20260806_vendor_type_and_bonvivo_handover.sql
-- Migrasi Supabase:
--   create_vendor_types_master
--   grant_vendor_types_menu_access
-- Plus perbaikan data DAI (dijalankan langsung, dicatat di sini).
-- ============================================================


-- ============================================================
-- 1. MASTER VENDOR TYPE
--
-- inventory.vendors TIDAK punya organization_id -- vendor memang sudah
-- global. Master tipe mengikuti bentuk itu, bukan per hotel.
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory.vendor_types (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       varchar(20) NOT NULL UNIQUE,
  name       text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE inventory.vendor_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all authenticated" ON inventory.vendor_types
  FOR ALL USING (true) WITH CHECK (true);

INSERT INTO inventory.vendor_types (code, name) VALUES
  ('LDR','Laundry'), ('FDM','Food Material'), ('AMN','Amenities'),
  ('CHM','Chemical'), ('BVG','Beverage')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE inventory.vendors
  ADD COLUMN IF NOT EXISTS vendor_type_id uuid REFERENCES inventory.vendor_types(id);
CREATE INDEX IF NOT EXISTS idx_vendors_type ON inventory.vendors (vendor_type_id);


-- ============================================================
-- 2. HAK AKSES
--
-- Otorisasi dibaca dari permissions->menu_access; halaman yang tidak ada
-- di peta itu DITOLAK. superadmin dan findir memakai {"all": true} jadi
-- aman, tetapi gm, opdir dan warehouse memakai daftar eksplisit -- tanpa
-- ini mereka terkunci dari master yang vendornya mereka kelola sendiri.
-- Nilai barunya mengikuti hak 'vendors' masing-masing, bukan hak penuh.
-- ============================================================

UPDATE inventory.roles
   SET permissions = jsonb_set(permissions, '{menu_access,vendor-types}',
         to_jsonb(COALESCE((permissions->'menu_access'->>'vendors')::boolean, false)), true)
 WHERE permissions ? 'menu_access' AND permissions->'menu_access' ? 'vendors';


-- ============================================================
-- 3. PERALIHAN VENDOR LAUNDRY DAI: BonVivo -> Teddy Bear
--
-- LATAR: BonVivo melayani DAI 12 Mei - 13 Juni 2026, lalu Teddy Bear
-- mengambil alih. Sisa 176 helai yang belum tercatat kembali membuat
-- BonVivo tetap menampilkan saldo. Secara fisik seluruh linen di gudang
-- laundry DAI (736) kini dipegang Teddy Bear.
--
-- Keputusan (Opsi B): seluruh riwayat laundry BonVivo di DAI dialihkan.
-- Opsi memindahkan sisanya saja sempat dicoba dan DIBATALKAN -- baris
-- tidak bisa dipecah karena kuantitas dikunci trigger immutability, dan
-- pasangan IN/OUT tidak dapat dicocokkan andal karena satu (dokumen, item)
-- berisi rata-rata 22 baris. Hasilnya akan berupa dokumen bervendor campur.
--
-- HANYA DAI. Riwayat BonVivo di DAS (5.444 baris) dan DCI (1.306 baris)
-- tidak disentuh.
-- ============================================================

UPDATE inventory.stock_movements sm
   SET vendor_id = 'fa262204-68a2-4c04-a2aa-023f7e957a36'   -- Teddy Bear Laundry
  FROM inventory.organizations o
 WHERE o.id = sm.organization_id
   AND o.code = 'DAI'
   AND sm.vendor_id = '27a3bed2-7ff6-48f6-b579-e999def3dcfc' -- BonVivo
   AND sm.reference_type IN ('LAUNDRY_SEND','LAUNDRY_RECEIVE');
-- 1.694 baris: SEND 436 IN + 436 OUT, RECEIVE 411 OUT + 411 IN

UPDATE inventory.vendors SET is_active = false, updated_at = now()
 WHERE id = '27a3bed2-7ff6-48f6-b579-e999def3dcfc';


-- ============================================================
-- CATATAN: vendor_id BUKAN kolom yang dikunci
--
-- Trigger fn_block_stock_movement_update menolak perubahan pada
-- organization_id, item_id, warehouse_id, movement_type, quantity,
-- unit_cost, reference_type, reference_id dan balance_after -- tetapi
-- TIDAK pada vendor_id. Karena itu pengalihan atribusi ini sah tanpa
-- mematikan pengaman apa pun, dan tidak ada stok yang berpindah.
-- ============================================================


-- ============================================================
-- VERIFIKASI SESUDAH (6 Agu 2026)
--
--   BonVivo DAI tampil        : 0        (sebelumnya 176)
--   Teddy Bear DAI tampil     : 736      (= isi gudang laundry DAI)
--   Saldo vs buku besar       : 0 tidak cocok
--   Saldo negatif             : 0
--   BonVivo outstanding lain  : DAS -1.101, DCI -1.184 -- keduanya negatif,
--                               jadi tampil 0; aman dinonaktifkan
-- ============================================================


-- ============================================================
-- ROLLBACK
--
--   UPDATE inventory.stock_movements sm
--      SET vendor_id = '27a3bed2-7ff6-48f6-b579-e999def3dcfc'
--     FROM inventory.organizations o
--    WHERE o.id = sm.organization_id AND o.code = 'DAI'
--      AND sm.vendor_id = 'fa262204-68a2-4c04-a2aa-023f7e957a36'
--      AND sm.reference_type IN ('LAUNDRY_SEND','LAUNDRY_RECEIVE')
--      AND sm.created_at < '2026-06-13';
--
--   UPDATE inventory.vendors SET is_active = true
--    WHERE id = '27a3bed2-7ff6-48f6-b579-e999def3dcfc';
--
-- Batas 13 Juni memisahkan keduanya secara bersih: kiriman Teddy Bear yang
-- asli semuanya bertanggal 13 Juni ke atas, sedangkan seluruh riwayat
-- BonVivo berakhir 12 Juni. Pembatalan ini sudah teruji -- dipakai untuk
-- mengembalikan percobaan pertama yang keliru.
-- ============================================================


-- ============================================================
-- BELUM DIKERJAKAN: stok laundry tak terlacak di DAS dan DCI
--
-- Stok yang secara fisik ada di gudang laundry tetapi tidak berasal dari
-- movement bervendor -- masuk lewat ADJUSTMENT, TRANSFER atau
-- OPENING_BALANCE: DAS 645, DCI 1.198.
--
-- Sebelumnya jumlah itu "menumpang" di BonVivo lewat id hardcode di
-- LaundryPage. Setelah hardcode dihapus, stok tersebut tidak muncul di
-- vendor mana pun. Masih ada di gudang, tetapi tidak terjangkau lewat layar
-- serah terima dan perlu diselesaikan lewat penyesuaian stok per hotel.
-- ============================================================
