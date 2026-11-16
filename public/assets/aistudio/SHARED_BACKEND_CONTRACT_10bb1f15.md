# SHARED_BACKEND_CONTRACT — FINOPS_SHARED_V1

Versi Kontrak: `1.0.0` · Tanggal: `16 November 2026`  
Pemilik Fondasi: **App 1 — Penerimaan & Setoran**  
Pengguna Kontrak: **App 1 (Penerimaan & Setoran)**, **App 2 (Penjualan & Rekonsiliasi)**, **App 3 (Akuntansi & Laporan)**

---

## 1. Prinsip Arsitektur Bersama
1. **Satu Proyek Supabase Bersama**: App 1, App 2, dan App 3 wajib terhubung ke URL proyek Supabase, `company_id`, `branch_id`, Supabase Auth, dan private bucket `finops-evidence` yang sama.
2. **Migrasi Additive-Only**: Perubahan skema lintas app hanya melalui file migrasi bernomor unik pada `supabase/migrations/` dan dicatat di `public.schema_migrations`. Dilarang menjalankan `DROP` atau `TRUNCATE` atau membuat tabel duplikat per aplikasi.
3. **Presisi Desimal**:
   - Nilai uang: `NUMERIC(20,2)` (IDR default tanpa pecahan, pembulatan `half_up`).
   - Kuantitas & harga satuan: `NUMERIC(20,6)`.
   - Pertukaran API/RPC memakai string desimal atau `NUMERIC` PostgreSQL. Hitungan otoritatif berada di PostgreSQL, bukan floating-point JavaScript.
4. **Identitas & Tanggal Terpisah**:
   - `customers.cust_id` bertipe `TEXT` agar nol awal (`00104`) tidak hilang.
   - Tanggal operasional (`customer_paid_at`, `bank_value_date`, `deposit_date`, `invoice_date`, `delivery_date`, `accounting_date`) disimpan sebagai `DATE` (`YYYY-MM-DD`); waktu audit disimpan sebagai `TIMESTAMPTZ`.

## 2. Kepemilikan Tabel per Aplikasi

| Domain | Tabel Kanonis | Pemilik Utama | Dibaca / Digunakan Oleh |
| :--- | :--- | :--- | :--- |
| Akses & Master | `companies`, `branches`, `profiles`, `memberships`, `role_permissions`, `app_settings`, `customers`, `customer_aliases`, `products`, `product_units`, `staff`, `suppliers`, `fund_accounts`, `document_sequences` | App 1 (Fondasi), dikelola bersama `system_admin`/`accountant` | App 1, App 2, App 3 |
| Penerimaan & Bank | `receipts`, `receipt_evidence`, `bank_statement_batches`, `bank_statement_lines`, `bank_matches` | **App 1** | App 2 (baca `v_app2_allocatable_receipts`), App 3 (rekonsiliasi bank final) |
| Penguasaan Kas & Setoran | `cash_custody_accounts`, `cash_deposits`, `cash_deposit_lines`, `custody_movements`, `custody_movement_sources`, `cash_transfers` | **App 1** | App 3 (posting jurnal mutasi kas & bank) |
| Penjualan & Alokasi | `sales_documents`, `sales_lines`, `sales_adjustments`, `document_links`, `payment_allocations`, `allocation_approvals` | **App 2** | App 1 (cek dependensi alokasi sebelum reversal), App 3 |
| Review & Selisih | `reconciliation_reviews`, `discrepancy_cases`, `approvals`, `attachments`, `audit_events` | Bersama (App 1/2/3) | App 1, App 2, App 3 |
| Integrasi & Idempotensi | `accounting_events`, `event_dependencies`, `idempotency_keys`, `import_batches`, `import_rows` | Fondasi App 1 → dikonsumsi mesin jurnal App 3 | App 1, App 2, App 3 |
| Akuntansi & Pembelian | `chart_of_accounts`, `account_mappings`, `fiscal_periods`, `journal_entries`, `journal_lines`, `journal_source_links`, `purchase_*`, `goods_receipts*`, `supplier_*`, `inventory_*`, `expense_documents`, `fixed_assets`, `depreciation_runs`, `loans`, `equity_transactions`, `tax_codes`, `opening_*`, `report_snapshots`, `period_close_checks`, `bank_reconciliations` | **App 3** (fondasi tabel sudah dibuat di `0001`) | App 3 |

## 3. Handoff Antara App 1, App 2, dan App 3
1. **App 1 → App 2 (`v_app2_allocatable_receipts`)**:
   - Receipt dengan status `waiting_verification` terlihat di App 2 sebagai antrian menunggu (tidak dapat melunasi nota).
   - Receipt dengan status `verified` memiliki `available_to_allocate = verified_amount - allocated_amount - refunded_amount`.
   - Receipt dengan `is_unknown_identity = true` tidak boleh dialokasikan ke nota sebelum `approve_receipt_identity` dijalankan.
   - Receipt `rejected` atau `reversed` tetap terlacak tetapi `available_to_allocate` tidak tersedia untuk pelunasan.
2. **App 1 → App 3 (`accounting_events` Outbox)**:
   - Setiap RPC approval di App 1 menulis baris di `public.accounting_events` dalam transaksi database yang sama dengan status awal `waiting_accounting_module`.
   - Event type yang dipancarkan App 1:
     - `receipt_transfer_verified` (Bank / Bank + Biaya Bank vs Titipan Pelanggan)
     - `receipt_cash_verified` (Kas di Penagih vs Titipan Pelanggan)
     - `receipt_unidentified_verified` (Kas/Bank vs Penerimaan Belum Teridentifikasi)
     - `receipt_identity_resolved` (Penerimaan Belum Teridentifikasi vs Titipan Pelanggan)
     - `cash_deposit_office_accepted` (Kas Kantor vs Kas di Penagih)
     - `cash_deposit_direct_bank_accepted` (Bank vs Kas di Penagih)
     - `internal_fund_transfer_approved` (Bank tujuan vs Kas Kantor/Bank asal)
     - `receipt_reversed` (Jurnal pembalik atas receipt yang belum dialokasikan)
3. **Navigasi Lintas Aplikasi**:
   - Menggunakan URL yang disimpan pada `public.app_settings` (`app1_url`, `app2_url`, `app3_url`) + parameter query `?doc_type=...&id=...` tanpa pernah menyisipkan token/secret ke URL.
