# SETUP — Koneksi App 2 ke Proyek Supabase Bersama (`FINOPS_SHARED_V1`)

1. **Gunakan Proyek Supabase yang Sama dengan App 1**:
   - Jangan membuat proyek Supabase baru atau database terpisah.
   - Salin `VITE_SUPABASE_URL` dan `VITE_SUPABASE_PUBLISHABLE_KEY` dari proyek Supabase bersama ke file `.env` (atau panel environment AI Studio / hosting Anda).
   - Jangan pernah menaruh `SUPABASE_SERVICE_ROLE_KEY` di environment frontend (`VITE_*`).

2. **Jalankan Migrasi Tambahan Secara Berurutan (Additive-Only)**:
   Pastikan migrasi App 1 (`0001`–`0004`) sudah terpasang pada database bersama, lalu jalankan sekali pada SQL Editor / Supabase CLI:
   - `supabase/migrations/0005_finops_app2_schema_and_rls.sql`
   - `supabase/migrations/0006_finops_app2_rpcs_and_views.sql`

3. **Konfigurasi URL Lintas Aplikasi (`public.app_settings`)**:
   Perbarui kolom `app1_url`, `app2_url`, `app3_url` pada tabel `public.app_settings` untuk `company_id` terkait agar tautan menu antar-aplikasi bekerja tanpa tautan hardcoded.

4. **Verifikasi Pengguna & Peran (`public.memberships`)**:
   - Login menggunakan akun Supabase Auth yang sama dengan App 1.
   - Tetapkan peran (`sales_admin`, `reconciliation_reviewer`, `accountant`, `accounting_approver`, `owner_viewer`, `system_admin`) pada `public.memberships` sesuai `company_id` dan `branch_id`.

5. **Mode Tanpa Environment (Sandbox / Setup)**:
   - Jika `VITE_SUPABASE_URL` atau `VITE_SUPABASE_PUBLISHABLE_KEY` belum diisi, aplikasi akan menampilkan halaman **Status Layanan & Setup Koneksi** secara jujur serta opsi terpisah **Mode Demo Terisolasi** (data sintetis dengan banner `DEMO` tanpa akses database produksi).
