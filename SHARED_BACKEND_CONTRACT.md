# SHARED_BACKEND_CONTRACT — FINOPS_SHARED_V1

Versi Kontrak: `1.0.0` · Tanggal: `16 November 2026`  
Pemilik Fondasi: **App 1 — Penerimaan & Setoran**  
Pengguna Kontrak: **App 1 (Penerimaan & Setoran)**, **App 2 (Penjualan & Rekonsiliasi)**, **App 3 (Akuntansi & Laporan)**

---

## 1. Prinsip Arsitektur Bersama
1. **Satu Proyek Supabase Bersama**: App 1, App 2, dan App 3 terhubung ke URL proyek Supabase, `company_id`, `branch_id`, Supabase Auth, dan private bucket `finops-evidence` yang sama.
2. **Migrasi Additive-Only**: Perubahan skema lintas app hanya melalui file migrasi bernomor unik pada `supabase/migrations/` (`0001`–`0004` oleh App 1, `0005`–`0006` oleh App 2) dan dicatat di `public.schema_migrations`.
3. **Presisi Desimal**: Uang `NUMERIC(20,2)` (`half_up`), kuantitas & harga `NUMERIC(20,6)`. Pertukaran string desimal; hitungan otoritatif di PostgreSQL.
4. **Identitas & Tanggal Terpisah**: `customers.cust_id` bertipe `TEXT` agar nol awal (`00104`) utuh. Tanggal operasional (`delivery_date`, `invoice_date`, `due_date`, `customer_paid_at`, `bank_value_date`) disimpan sebagai `DATE` (`YYYY-MM-DD`); tanggal bayar tidak mengubah tanggal pengakuan penjualan.

## 2. Kepemilikan & Handoff App 2 ↔ App 1 ↔ App 3
1. **App 1 → App 2**:
   - App 2 membaca `v_app2_allocatable_receipts` dan `receipts` secara read-only sesuai RLS; tidak pernah membuat tabel `payments` baru atau mengedit status `Lunas` secara manual.
   - Status custody penagih (`not_deposited`, `partially_deposited`, `deposited`) tetap milik App 1 dan ditampilkan sebagai indikator terpisah di App 2 ("Lunas + Uang Masih di Penagih").
2. **App 2 → App 3 (`accounting_events` Outbox)**:
   - `approve_and_release_sale` memancarkan `sales_revenue_recognized` dan `sales_cogs_recognized` yang terhubung via `event_dependencies` (wajib atomic revenue + HPP).
   - `approve_payment_allocation` memancarkan `payment_allocated_to_sale` (Debit Titipan Pelanggan, Kredit Piutang Usaha).
   - `reverse_payment_allocation` memancarkan `payment_allocation_reversed`.
   - `issue_sales_credit_note` memancarkan `sales_credit_note_issued`.
3. **Read Models App 2**:
   - `v_app2_document_balances` & `v_app2_sales_recap` (`security_invoker = true`) menjamin join ke banyak pembayaran tidak pernah melipatgandakan `QTY` atau `TOTAL SALES`.
   - `get_sales_recap` & `get_customer_receivable` mendukung tanggal cut-off (`p_cutoff_date` / `p_as_of_date`) untuk pelaporan historis yang akurat.
