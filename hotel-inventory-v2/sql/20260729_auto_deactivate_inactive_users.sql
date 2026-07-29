-- ============================================================
-- 20260729_auto_deactivate_inactive_users.sql
-- Migrasi Supabase:
--   auto_deactivate_inactive_users
--   move_auto_deactivate_exemption_to_roles
--
-- TUJUAN: user yang tidak aktif melebihi N hari (default 30) otomatis
--         dinonaktifkan.
-- ============================================================


-- ============================================================
-- KENAPA TIDAK MEMAKAI last_login
--
-- Kolom users.last_login sudah ada, tapi TIDAK layak jadi dasar.
-- Sesi dipulihkan dari localStorage tanpa masa berlaku:
--
--   const [currentUser, setCurrentUser] = useState(() => {
--     const saved = localStorage.getItem('inventory_user');
--     return saved ? JSON.parse(saved) : null;
--   });
--
-- User yang login bulan Maret dan tidak pernah logout MASIH login
-- sampai sekarang. Dia bisa memakai sistem tiap hari sementara
-- last_login-nya tetap Maret. Memakai last_login berarti
-- menonaktifkan justru orang-orang yang masih bekerja.
--
-- Karena itu ditambahkan users.last_activity_at, yang disegarkan
-- selama aplikasi terbuka (lihat AppContext.jsx), dibatasi 1x per jam
-- per browser agar tidak membebani disk IO instance Nano.
-- ============================================================

ALTER TABLE inventory.users
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz DEFAULT now();

-- Jam semua akun dimulai dari hari penerapan, sehingga deaktivasi
-- pertama berjarak satu periode penuh. Tanpa ini, 12 dari 52 akun aktif
-- -- termasuk 2 General Manager dan 1 Operation Director -- langsung
-- kehilangan akses pada jalannya yang pertama.
UPDATE inventory.users SET last_activity_at = now() WHERE last_activity_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_last_activity
  ON inventory.users (last_activity_at) WHERE is_active;


-- ============================================================
-- PENGECUALIAN BERBASIS ROLE
-- Dikelola dari halaman Role Management, sejajar dengan kolom
-- allow_maintenance_access yang sudah ada.
-- ============================================================

ALTER TABLE inventory.roles
  ADD COLUMN IF NOT EXISTS exempt_from_auto_deactivate boolean NOT NULL DEFAULT false;

UPDATE inventory.roles SET exempt_from_auto_deactivate = true WHERE code = 'superadmin';


-- ============================================================
-- JEJAK AUDIT
-- Agar admin tahu MENGAPA seseorang kehilangan akses.
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory.user_deactivation_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES inventory.users(id),
  username         text,
  last_activity_at timestamptz,
  days_threshold   integer,
  deactivated_at   timestamptz DEFAULT now()
);
ALTER TABLE inventory.user_deactivation_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all authenticated" ON inventory.user_deactivation_log;
CREATE POLICY "Allow all authenticated" ON inventory.user_deactivation_log
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- PENGATURAN GLOBAL (halaman System Settings, tab Maintenance)
-- ============================================================

INSERT INTO inventory.app_settings (setting_key, setting_value) VALUES
  ('auto_deactivate_enabled', 'true'),
  ('auto_deactivate_days', '30')
ON CONFLICT (setting_key) DO NOTHING;


-- ============================================================
-- FUNGSI
-- ============================================================

CREATE OR REPLACE FUNCTION inventory.fn_auto_deactivate_inactive_users()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = inventory, public
AS $$
DECLARE
  v_enabled text;
  v_days    integer;
  v_count   integer := 0;
BEGIN
  SELECT setting_value INTO v_enabled
    FROM inventory.app_settings WHERE setting_key = 'auto_deactivate_enabled';
  IF COALESCE(v_enabled, 'false') <> 'true' THEN
    RETURN 0;
  END IF;

  SELECT NULLIF(setting_value, '')::integer INTO v_days
    FROM inventory.app_settings WHERE setting_key = 'auto_deactivate_days';
  v_days := COALESCE(v_days, 30);
  -- Nilai nol atau negatif akan menonaktifkan semua orang sekaligus. Tolak.
  IF v_days < 1 THEN
    RETURN 0;
  END IF;

  WITH stale AS (
    UPDATE inventory.users u
       SET is_active = false, updated_at = now()
      FROM inventory.roles r
     WHERE r.id = u.role_id
       AND u.is_active
       AND u.last_activity_at IS NOT NULL
       AND u.last_activity_at < now() - make_interval(days => v_days)
       AND NOT r.exempt_from_auto_deactivate
       -- Batas keras: hanya ada SATU akun superadmin. Kehilangannya berarti
       -- tidak ada seorang pun yang bisa mengelola sistem, dan tidak ada
       -- jalan pulih lewat aplikasi. Dikecualikan apa pun isi checkbox-nya.
       AND r.code <> 'superadmin'
    RETURNING u.id, u.username, u.last_activity_at
  )
  INSERT INTO inventory.user_deactivation_log
    (user_id, username, last_activity_at, days_threshold)
  SELECT id, username, last_activity_at, v_days FROM stale;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


-- ============================================================
-- PENJADWALAN
-- 20:00 UTC = 03:00 WIB, satu jam setelah job auto-confirm yang sudah ada
-- (19:00 UTC) supaya keduanya tidak berebut disk IO instance Nano.
-- ============================================================

SELECT cron.unschedule('auto-deactivate-inactive-users')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-deactivate-inactive-users');
SELECT cron.schedule(
  'auto-deactivate-inactive-users',
  '0 20 * * *',
  $cron$SELECT inventory.fn_auto_deactivate_inactive_users()$cron$
);


-- ============================================================
-- VERIFIKASI YANG SUDAH DIJALANKAN (29 Jul 2026)
--
--   cron.job                      -> jobid 3, '0 20 * * *', active
--   fn_auto_deactivate_...()      -> 0   (benar: jam baru direset hari ini)
--   users aktif                   -> 52, tidak ada last_activity_at NULL
--   GET /rest/v1/roles?select=code,exempt_from_auto_deactivate  -> HTTP 200
--   GET /rest/v1/users?select=username,last_activity_at         -> HTTP 200
--
-- Pemeriksaan PostgREST wajib: kolom baru tidak berguna bila cache skema
-- belum memuatnya.
-- ============================================================


-- ============================================================
-- ROLLBACK
--
--   SELECT cron.unschedule('auto-deactivate-inactive-users');
--   DROP FUNCTION IF EXISTS inventory.fn_auto_deactivate_inactive_users();
--   DROP TABLE IF EXISTS inventory.user_deactivation_log;
--   ALTER TABLE inventory.roles DROP COLUMN IF EXISTS exempt_from_auto_deactivate;
--   ALTER TABLE inventory.users DROP COLUMN IF EXISTS last_activity_at;
--   DELETE FROM inventory.app_settings
--     WHERE setting_key IN ('auto_deactivate_enabled','auto_deactivate_days');
--
-- Membatalkan penjadwalan saja sudah cukup untuk menghentikan deaktivasi;
-- sisanya hanya diperlukan bila fitur benar-benar dibuang.
-- Akun yang terlanjur dinonaktifkan tidak ikut pulih -- aktifkan kembali
-- lewat User Management, rujuk inventory.user_deactivation_log.
-- ============================================================
