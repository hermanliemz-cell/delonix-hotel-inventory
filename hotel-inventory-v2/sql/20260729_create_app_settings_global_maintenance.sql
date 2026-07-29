-- ============================================================
-- 20260729_create_app_settings_global_maintenance.sql
-- Applied via Supabase migration: create_app_settings_global_maintenance
--
-- MASALAH:
--   maintenance_mode sebelumnya disimpan di inventory.system_settings,
--   yang organization_id-nya NOT NULL dengan FK ke organizations --
--   artinya nilainya selalu terikat ke SATU hotel.
--
--   Pemeriksaan login membaca setting milik organisasi USER YANG LOGIN,
--   bukan organisasi yang dipilih admin saat menyalakan toggle. Akibatnya
--   menyalakan maintenance di DAS sama sekali tidak memblokir user DCI
--   maupun DAI. Terbukti 29 Jul 2026: user "user" (milik DCI) tetap bisa
--   login saat maintenance dinyalakan dari DAS.
--
--   Dua lubang turunan:
--     1. User dengan organization_id NULL melewati pemeriksaan sepenuhnya
--        (blok `if (orgId)` di AppContext.jsx).
--     2. Hotel yang belum pernah punya baris maintenance_mode tidak akan
--        pernah bisa dikunci -- DAI berada dalam kondisi ini.
--
-- SOLUSI:
--   Tabel global tanpa organization_id. Satu saklar mencakup seluruh
--   hotel, termasuk hotel yang dibuat di kemudian hari.
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory.app_settings (
  setting_key   text PRIMARY KEY,
  setting_value text,
  updated_at    timestamptz DEFAULT now(),
  updated_by    uuid REFERENCES inventory.users(id)
);

ALTER TABLE inventory.app_settings ENABLE ROW LEVEL SECURITY;

-- Meniru policy yang sudah ada di inventory.system_settings agar
-- perilaku akses konsisten dengan tabel lain di schema ini.
DROP POLICY IF EXISTS "Allow all authenticated" ON inventory.app_settings;
CREATE POLICY "Allow all authenticated" ON inventory.app_settings
  FOR ALL USING (true) WITH CHECK (true);

INSERT INTO inventory.app_settings (setting_key, setting_value)
VALUES ('maintenance_mode', 'false')
ON CONFLICT (setting_key) DO NOTHING;


-- ============================================================
-- VERIFIKASI YANG SUDAH DIJALANKAN (29 Jul 2026)
--
-- Pemeriksaan login kini FAIL-CLOSED: bila baris tidak terbaca karena
-- alasan apa pun, login DITOLAK. Karena itu hak akses PostgREST wajib
-- dipastikan SEBELUM deploy -- kalau tidak, seluruh user terkunci.
--
--   anon / authenticated / service_role : SELECT tersedia  OK
--   GET /rest/v1/app_settings?select=setting_value
--       &setting_key=eq.maintenance_mode
--       (Accept-Profile: inventory)      -> HTTP 200 [{"setting_value":"false"}]
--
-- Jalankan ulang pemeriksaan ini bila tabel dibuat ulang di lingkungan lain.
-- ============================================================


-- ============================================================
-- CATATAN
--
-- Baris maintenance_mode lama di inventory.system_settings sengaja
-- DIBIARKAN. Pemeriksaan login tidak lagi membacanya, dan halaman
-- Settings mengeluarkannya dari upsert per-organisasi. Membiarkannya
-- membuat rollback ke versi aplikasi sebelumnya tetap berfungsi.
--
-- BATASAN PENTING:
--   Seluruh alur autentikasi berjalan di sisi klien -- handleLogin
--   membaca tabel users langsung dan membandingkan hash password di
--   JavaScript. Maintenance mode adalah pagar UX bagi user biasa yang
--   memakai aplikasi, BUKAN batas keamanan. Siapa pun yang memegang anon
--   key dapat melewatinya. Menjadikannya benar-benar dipaksakan menuntut
--   pemindahan autentikasi ke sisi server.
-- ============================================================


-- ============================================================
-- ROLLBACK
--
-- Kembalikan juga kode aplikasi ke versi sebelum 2.0.54, karena versi
-- 2.0.54+ membaca tabel ini dan akan menolak semua login bila tabel
-- dihapus (fail-closed).
--
--   DROP TABLE IF EXISTS inventory.app_settings;
-- ============================================================
