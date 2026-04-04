# Deep Audit Report: Hotel Inventory Management System v1.0.23

**Tanggal:** 4 April 2026
**Sistem:** Hotel Inventory Management System — Delonix Group
**Stack:** React 18 + Tailwind CSS + Supabase PostgreSQL
**File Utama:** `public/index.html` (~22.000 baris, single-file SPA)

---

## Ringkasan Eksekutif

Sistem telah go-live dan berfungsi untuk operasional harian. Namun audit menyeluruh menemukan **35 temuan** yang perlu ditindaklanjuti, terdiri dari: 6 CRITICAL, 8 HIGH, 13 MEDIUM, dan 8 LOW. Temuan terbesar ada di area **keamanan** (authorization hanya di client-side), **data integrity** (bug GR confirmation), dan **arsitektur** (22.000 baris dalam satu file).

---

## A. SECURITY (Keamanan)

### A1. [CRITICAL] Authorization Hanya di Client-Side

Semua pengecekan role/permission hanya dilakukan di JavaScript browser. Tidak ada Row Level Security (RLS) di Supabase. User yang paham teknis bisa mengubah role mereka di localStorage atau langsung memanggil Supabase API untuk memodifikasi data apapun.

**Lokasi:** Line 92-129 (`ROLE_PAGE_ACCESS`), line 2262 (role disimpan di `localStorage`)

**Dampak:** Siapapun yang punya ANON_KEY (terekspos di source code) bisa membaca/menulis data seluruh organisasi.

**Rekomendasi:** Aktifkan RLS di semua tabel Supabase. Setiap query harus divalidasi di level database, bukan di browser.

---

### A2. [CRITICAL] Password Hashing Lemah

Password di-hash menggunakan SHA-256 dengan salt yang sama untuk semua user (`_inventory_salt_2024`), dan salt ini terlihat di source code. SHA-256 terlalu cepat untuk password hashing — mudah di-brute-force.

**Lokasi:** Line 83-89 (`hashPassword`)

**Rekomendasi:** Migrasi ke bcrypt/Argon2 di server-side. Gunakan salt unik per user. Jangan hash password di client.

---

### A3. [CRITICAL] Login Mendukung Password Plaintext

Login memeriksa password dalam dua format: hashed dan `'default_' + password` (plaintext). Ini berarti sebagian password disimpan tanpa hashing.

**Lokasi:** Line 2223-2231

**Rekomendasi:** Hapus fallback plaintext. Migrasi semua user ke password yang di-hash properly. Paksa ganti password saat login pertama.

---

### A4. [HIGH] Tidak Ada Content Security Policy (CSP)

Header CSP belum dikonfigurasi di `vercel.json`. Ini membuka risiko XSS attack.

**Rekomendasi:** Tambahkan CSP header di `vercel.json`.

---

### A5. [HIGH] Tidak Ada Rate Limiting

Tidak ada pembatasan jumlah percobaan login. Attacker bisa brute-force password tanpa hambatan.

**Rekomendasi:** Implementasi rate limiting di backend — lockout setelah 5x gagal login.

---

### A6. [MEDIUM] Tidak Ada Audit Log Komprehensif

Operasi sensitif (create/update/delete user, ubah role, approval, dll) tidak dicatat dalam audit log. Sulit melacak siapa mengubah apa.

**Rekomendasi:** Buat tabel `audit_logs` dan catat semua operasi CUD dengan siapa, kapan, data lama, data baru.

---

### A7. [MEDIUM] Session di localStorage Bisa Ditamper

Data user termasuk role disimpan di `localStorage` tanpa enkripsi. User bisa mengubah role mereka menjadi `superadmin`.

**Lokasi:** Line 2146, 2262

**Rekomendasi:** Gunakan JWT token dari Supabase Auth. Validasi session di server, bukan di client.

---

### A8. [MEDIUM] File Upload Tanpa Validasi Tipe

Upload logo hanya memeriksa ukuran file (500KB), tidak memeriksa tipe file. User bisa upload file berbahaya.

**Lokasi:** Line 3791-3798

**Rekomendasi:** Validasi MIME type (hanya izinkan image/jpeg, image/png).

---

### A9. [LOW] Tidak Ada HSTS Header

**Rekomendasi:** Tambahkan `Strict-Transport-Security` header.

---

## B. DATA INTEGRITY (Integritas Data)

### B1. [CRITICAL] Bug GR Confirmation — Missing warehouse_id Filter

Saat confirm Goods Received, query ke `stock_balance` tidak menyertakan filter `warehouse_id`. Jika item ada di beberapa warehouse, `.maybeSingle()` akan gagal atau mengembalikan record yang salah.

**Lokasi:** Line 10707-10711 (confirm), Line 10815-10819 (revoke)

**Dampak:** Stock balance bisa corrupt — update masuk ke warehouse yang salah.

**Rekomendasi:** Tambahkan `.eq('warehouse_id', item.warehouse_id)` pada kedua query.

---

### B2. [CRITICAL] Manual stock_balance Update Masih Ada di Beberapa Fungsi

Trigger `trg_sync_stock_balance` sudah aktif, tapi beberapa fungsi masih melakukan update manual ke `stock_balance`. Ini menyebabkan double-counting.

**Lokasi yang masih ada manual update:**
- Line ~18670, 18685-18687 (Laundry Send)
- Line ~19985, 20002 (In-Use Transfer)
- Line ~20070, 20072, 20084 (Transfer Revoke)
- Line ~21379-21380 (Single Item Usage)

**Rekomendasi:** Hapus SEMUA manual stock_balance update dari kode. Trigger database sudah menangani secara atomic.

---

### B3. [HIGH] getBalanceAfter() Tidak Konsisten

Fungsi ini kadang dipanggil tanpa `warehouseId`, sehingga menjumlahkan qty dari SEMUA warehouse. Akibatnya field `balance_after` di `stock_movements` tidak akurat.

**Lokasi:** Line 3659-3672 (definisi), dipanggil tanpa warehouse_id di line 10688, 18619, 18642, dll.

**Rekomendasi:** Selalu passing `warehouseId` ke `getBalanceAfter()`.

---

### B4. [HIGH] GR Confirmation Tanpa Atomicity

Proses confirm GR terdiri dari beberapa INSERT/UPDATE berurutan tanpa transaction. Jika gagal di tengah, data jadi inkonsisten (movement tercatat tapi balance tidak ter-update).

**Rekomendasi:** Pindahkan logika GR confirmation ke database function (stored procedure) yang berjalan dalam satu transaction.

---

### B5. [HIGH] Hapus GR Tidak Menghapus stock_movements

Saat GR dihapus, `purchase_received_items` dihapus tapi `stock_movements` yang terkait tidak ikut dihapus — meninggalkan orphaned records.

**Lokasi:** Line 10773-10774

**Rekomendasi:** Tambahkan penghapusan `stock_movements` terkait, atau gunakan cascade delete di database.

---

### B6. [MEDIUM] Query stock_balance Tanpa organization_id

Beberapa query tidak menyertakan filter `organization_id`, berpotensi menampilkan data organisasi lain.

**Lokasi:** Line 4463

**Rekomendasi:** Audit semua query dan pastikan `organization_id` selalu di-filter. Atau aktifkan RLS.

---

### B7. [MEDIUM] Division by Zero pada Perhitungan avg_cost

Beberapa tempat menggunakan guard `newQty > 0` tapi jika qty sangat kecil (misal 0.0001 dari rounding error), hasilnya bisa sangat besar.

**Rekomendasi:** Gunakan toleransi `newQty > 0.001` untuk semua pembagian.

---

### B8. [MEDIUM] Database Functions yang Hilang

RPC call `get_cron_jobs` dan `fn_auto_confirm_room_makeups_rpc` belum dibuat di database. Kode sudah ada fallback, tapi fiturnya tidak berfungsi.

**Lokasi:** Line 13459, 13486

**Rekomendasi:** Buat fungsi-fungsi tersebut di database, atau hapus kode yang memanggilnya.

---

## C. ARSITEKTUR & PERFORMA

### C1. [HIGH] Monolithic Single File (22.000 Baris)

Seluruh aplikasi berada dalam satu file `index.html`: 42 halaman, 306+ fungsi, 2.778+ Tailwind class. Ini menyulitkan maintenance, debugging, dan kolaborasi.

**Dampak:** IDE lambat, sulit track bug, tidak bisa code-split, semua user download 1.2MB walaupun hanya buka 1 halaman.

**Rekomendasi:** Migrasi ke project dengan build system (Vite + React). Pecah menjadi:
- `components/` — komponen reusable (DataTable, TreeSelect, StatCard, dll)
- `pages/` — per halaman (DashboardPage, StockBalancePage, dll)
- `hooks/` — custom hooks (useAuth, useStock, dll)
- `utils/` — helper functions (formatCurrency, hashPassword, dll)
- `services/` — Supabase queries per domain

---

### C2. [HIGH] Babel Compile di Browser

React JSX dikompilasi oleh Babel di browser user. Ini memperlambat load time karena parsing + compilation terjadi setiap kali halaman dibuka.

**Rekomendasi:** Gunakan build tool (Vite) untuk pre-compile JSX menjadi JavaScript. Ini juga memungkinkan tree-shaking dan minification.

---

### C3. [MEDIUM] Tidak Ada Code Splitting / Lazy Loading

Semua 42 halaman dimuat bersamaan. User housekeeping yang hanya butuh Room Makeup tetap download kode untuk Purchase Order, Reports, Settings, dll.

**Rekomendasi:** Implementasi `React.lazy()` dan `Suspense` untuk load halaman on-demand.

---

### C4. [MEDIUM] Kurang Memoization

Hanya 11 penggunaan `useMemo`/`useCallback` di seluruh app, padahal ada 60+ operasi `.filter().map()` di dalam render yang recalculate setiap re-render.

**Rekomendasi:** Tambahkan `useMemo` untuk semua computed data, terutama di halaman dengan banyak data (Stock Balance, Movements, Reports).

---

### C5. [MEDIUM] Tidak Ada Routing Library

Navigasi dilakukan dengan state variable `currentPage` dan if/switch statement. Tidak ada deep linking, browser back/forward tidak bekerja.

**Rekomendasi:** Implementasi React Router. Ini juga memungkinkan bookmark halaman dan share URL langsung ke halaman tertentu.

---

### C6. [LOW] External CDN Tanpa Subresource Integrity (SRI)

7 script external dimuat tanpa SRI hash. Jika CDN di-compromise, script berbahaya bisa diinjeksi.

**Lokasi:** Line 8-27

**Rekomendasi:** Tambahkan `integrity` attribute pada semua tag `<script>`.

---

### C7. [LOW] Hardcoded Limits

Beberapa query menggunakan `.limit(10000)` atau `.limit(200)` yang hardcoded. Bisa silent-fail jika data melebihi limit.

**Rekomendasi:** Implementasi pagination yang konsisten di semua halaman.

---

## D. UX & FUNGSIONALITAS

### D1. [MEDIUM] Auto-Reload Tanpa Peringatan

Version check otomatis reload halaman tanpa memberi tahu user. Jika user sedang mengisi form, data hilang.

**Lokasi:** Line 56-78

**Rekomendasi:** Tampilkan notifikasi "Versi baru tersedia, klik untuk update" daripada langsung reload.

---

### D2. [MEDIUM] Tidak Ada Error Boundary

Jika terjadi JavaScript error yang tidak tertangkap, seluruh app crash tanpa pesan yang jelas.

**Rekomendasi:** Tambahkan React Error Boundary yang menampilkan halaman fallback dengan tombol reload.

---

### D3. [LOW] Loading State Tidak Konsisten

Beberapa halaman menampilkan spinner, yang lain menampilkan teks "Loading...", dan beberapa tidak menampilkan apa-apa saat data di-fetch.

**Rekomendasi:** Standarisasi loading state — gunakan skeleton loader atau spinner yang konsisten.

---

### D4. [LOW] Tidak Ada Offline Support

App tidak berfungsi sama sekali tanpa koneksi internet. Tidak ada service worker atau cache.

**Rekomendasi:** Pertimbangkan Progressive Web App (PWA) dengan offline read-only mode untuk data yang sudah di-cache.

---

### D5. [LOW] Console.log di Production

Ditemukan 43 instance `console.log`/`console.error` yang seharusnya tidak ada di production.

**Rekomendasi:** Hapus atau ganti dengan proper logging service.

---

## Prioritas Perbaikan

### Fase 1: Perbaikan Darurat (Minggu Ini)

| # | Temuan | Severity | Effort |
|---|--------|----------|--------|
| B1 | Fix GR confirmation — tambah warehouse_id filter | CRITICAL | 1 jam |
| B2 | Hapus semua manual stock_balance update (gunakan trigger) | CRITICAL | 2 jam |
| B3 | Fix getBalanceAfter — selalu passing warehouseId | HIGH | 1 jam |
| B5 | Fix GR delete — hapus orphaned stock_movements | MEDIUM | 1 jam |

### Fase 2: Keamanan (2 Minggu)

| # | Temuan | Severity | Effort |
|---|--------|----------|--------|
| A1 | Aktifkan RLS di semua tabel Supabase | CRITICAL | 3-5 hari |
| A2 | Migrasi password hashing ke bcrypt | CRITICAL | 2 hari |
| A3 | Hapus plaintext password fallback | CRITICAL | 1 hari |
| A5 | Rate limiting login | HIGH | 1 hari |
| A6 | Buat audit log table + triggers | MEDIUM | 2 hari |

### Fase 3: Stabilitas (1 Bulan)

| # | Temuan | Severity | Effort |
|---|--------|----------|--------|
| B4 | GR confirmation dalam database transaction | HIGH | 2 hari |
| B8 | Buat missing database functions | MEDIUM | 1 hari |
| D1 | Auto-reload dengan peringatan | MEDIUM | 2 jam |
| D2 | Tambah Error Boundary | MEDIUM | 2 jam |
| A4 | Tambah CSP header | HIGH | 2 jam |
| A7 | Migrasi ke Supabase Auth (JWT) | MEDIUM | 3 hari |

### Fase 4: Arsitektur (2-3 Bulan)

| # | Temuan | Severity | Effort |
|---|--------|----------|--------|
| C1 | Migrasi ke Vite + React modular | HIGH | 2-3 minggu |
| C2 | Hapus Babel di browser | HIGH | Bagian dari C1 |
| C3 | Code splitting + lazy loading | MEDIUM | Bagian dari C1 |
| C5 | Implementasi React Router | MEDIUM | Bagian dari C1 |
| C4 | Tambah memoization | MEDIUM | 3 hari |

---

## Catatan Positif

Meskipun ada banyak temuan, sistem ini juga memiliki hal-hal yang sudah baik:

1. **Notification system** sudah komprehensif — 376 penggunaan `showNotification`
2. **Confirmation dialog** untuk semua aksi destruktif — 40+ penggunaan `showConfirm`
3. **Loading states** tersedia di hampir semua halaman
4. **Validasi stock sebelum OUT** sudah diimplementasi
5. **Database trigger** untuk atomic stock_balance update sudah aktif
6. **Reconcile function** yang bisa memperbaiki selisih kapan saja
7. **Version auto-check** memastikan user selalu pakai versi terbaru
8. **Multi-language** (English + Chinese) sudah diimplementasi
9. **Role-based access** sudah terdefinisi untuk 12 role berbeda
10. **Session timeout** 15 menit untuk keamanan

---

*Dokumen ini dihasilkan dari deep audit pada 4 April 2026.*
