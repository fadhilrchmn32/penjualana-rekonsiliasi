# RPC_CONTRACT — App 1 & App 2 (`FINOPS_SHARED_V1`)

Semua RPC mutasi berjalan sebagai `SECURITY DEFINER` (`search_path = ''`), mewajibkan `auth.uid()` aktif, memeriksa `memberships` (company + branch + role), mengunci baris secara deterministik (`FOR UPDATE`), mengecek `idempotency_key`, memeriksa `version`, dan mencatat `audit_events` + `accounting_events` secara atomik. **Aktor selalu diambil dari `auth.uid()`.**

---

## A. Daftar RPC App 1 (Penerimaan & Setoran — `0003`)
Tetap utuh dan kompatibel penuh:
- `create_receipt_draft`, `submit_receipt`, `verify_receipt`, `reject_receipt`, `propose_receipt_identity`, `approve_receipt_identity`
- `create_cash_deposit`, `submit_cash_deposit`, `accept_cash_deposit`
- `create_internal_fund_transfer`, `approve_internal_fund_transfer`
- `import_bank_statement_preview`, `commit_bank_statement_import`, `propose_bank_match`, `approve_bank_match`
- `request_receipt_reversal`, `approve_receipt_reversal`
- `list_collection_dashboard`, `get_collector_custody_detail`

---

## B. Daftar RPC App 2 (Penjualan & Rekonsiliasi — `0006`)

| Nama RPC | Peran Diizinkan | Parameter Utama | Efek & Validasi Kritis |
| :--- | :--- | :--- | :--- |
| `draft_sale` | `sales_admin`, `reconciliation_reviewer`, `system_admin` | `p_idempotency_key`, `p_company_id`, `p_branch_id`, `p_customer_id`, `p_sales_staff_id`, `p_invoice_date`, `p_delivery_date`, `p_due_date`, `p_planned_payment_method`, `p_tax_basis`, `p_tax_code_id`, `p_source_invoice_no`, `p_notes`, `p_delivery_proof_path`, `p_lines`, `p_sales_document_id`, `p_expected_version` | Membuat atau memperbarui draft nota (`SLS-YYYYMM-XXXX`). Menghitung pembulatan half-up per baris di PostgreSQL dan menyimpan snapshot nama/SKU produk. Jika `delivery_date IS NULL`, status menjadi `pending_delivery` (tidak diakui). |
| `submit_sale` | `sales_admin`, `reconciliation_reviewer` | `p_idempotency_key`, `p_sales_document_id`, `p_expected_version` | Mengubah `draft`/`pending_delivery` → `submitted`. Wajib memiliki `delivery_date` terisi. |
| `approve_and_release_sale` | `reconciliation_reviewer`, `accounting_approver` (≠ pembuat & pengaju) | `p_idempotency_key`, `p_sales_document_id`, `p_expected_version`, `p_confirmed_delivery_date`, `p_approval_note` | Memeriksa stok & HPP pada `inventory_valuations` (mengunci baris; menolak rilis jika stok/HPP kosong dan membuat `discrepancy_cases`). Mengubah status → `released`, memotong stok, memancarkan event `sales_revenue_recognized` dan `sales_cogs_recognized` yang terhubung (`event_dependencies`). |
| `preview_sales_import` | `sales_admin`, `reconciliation_reviewer`, `system_admin` | `p_idempotency_key`, `p_company_id`, `p_branch_id`, `p_file_name`, `p_file_hash`, `p_sheet_name`, `p_mapping_version`, `p_date_format`, `p_decimal_format`, `p_tax_basis`, `p_grouping_mode`, `p_cutover_mode`, `p_rows` | Menyimpan staging `import_batches` & `import_rows`. Mencocokkan `cust_id` secara exact (nol awal dipertahankan), mendeteksi SKU/pelanggan tak dikenal, mendeteksi reimport `file_hash` yang sama, menyimpan raw cells & `legacy_source_data`. |
| `commit_sales_import` | `sales_admin`, `reconciliation_reviewer`, `system_admin` | `p_idempotency_key`, `p_batch_id`, `p_expected_version`, `p_allow_duplicate_rows` | Commit atomik per dokumen penjualan. Menolak penggabungan jika satu `source_doc_id` memiliki `delivery_date` berbeda. Idempoten untuk `file_hash` yang sudah di-commit. Mode `legacy_archive` ditandai `is_legacy_archive = true` (non-posting). |
| `propose_payment_allocation` | `sales_admin`, `reconciliation_reviewer`, `finance_maker`, `finance_checker` | `p_idempotency_key`, `p_company_id`, `p_branch_id`, `p_items`, `p_notes` | Mengusulkan alokasi many-to-many (`receipt_id`, `sales_document_id`, `allocated_amount`). Memvalidasi pelanggan sama, mata uang sama, receipt `verified` & `is_unknown_identity = false`, nota `approved`/`released`, dan sisa saldo keduanya. Belum mengurangi AR sampai disetujui. |
| `approve_payment_allocation` | `reconciliation_reviewer`, `finance_checker` (≠ pengusul) | `p_idempotency_key`, `p_allocation_ids`, `p_notes` | Mengunci deterministik (`payment_allocations` → `receipts` → `sales_documents` `FOR UPDATE`) untuk mencegah race condition / over-allocation. Memperbarui `sales_documents.payment_status` di server dan memancarkan `payment_allocated_to_sale`. |
| `reverse_payment_allocation` | `reconciliation_reviewer`, `accounting_approver` (≠ approver alokasi) | `p_idempotency_key`, `p_allocation_id`, `p_expected_version`, `p_reason` | Melepas alokasi `approved` → `reversed` dengan alasan wajib. Menolak jika `fiscal_periods` pada tanggal efektif berstatus `closed`. Memperbarui status piutang nota dan memancarkan `payment_allocation_reversed`. |
| `save_reconciliation_review` | `reconciliation_reviewer`, `finance_checker`, `accounting_approver` | `p_idempotency_key`, `p_company_id`, `p_branch_id`, `p_sales_document_id`, `p_reconciliation_status`, `p_review_stage`, `p_reason_code`, `p_notes`, `p_structured_notes` | Menyimpan keputusan review Almira + alasan terstruktur + timestamp. Status `matched`/`completed` tidak memaksa piutang menjadi nol (penjualan kredit sah tetap terbuka). |
| `issue_sales_credit_note` | `reconciliation_reviewer`, `accounting_approver` | `p_idempotency_key`, `p_original_sales_document_id`, `p_issue_date`, `p_reason`, `p_lines` | Menerbitkan dokumen `credit_note` (`CN-SLS-YYYYMM-XXXX`) tertaut ke nota asal via `document_links` & `amended_from_id` tanpa mengedit nota asal in-place. Menghitung ulang `payment_status` nota asal dan memancarkan `sales_credit_note_issued`. |
| `get_sales_recap` | Semua anggota perusahaan terotorisasi (sesuai branch) | `p_company_id`, `p_branch_id`, `p_date_from`, `p_date_to`, `p_cutoff_date`, `p_include_archive` | Read model server-side anti-double-join. Menghitung total baris vs total tagihan/piutang per dokumen secara terpisah, serta mendukung `p_cutoff_date` agar pembayaran bulan berikutnya tidak membuat nota terlihat lunas pada tanggal laporan sebelumnya. |
| `get_customer_receivable` | Semua anggota perusahaan terotorisasi (sesuai branch) | `p_company_id`, `p_branch_id`, `p_customer_id`, `p_as_of_date` | Mengembalikan saldo piutang per pelanggan, aging (`0-30`, `31-60`, `61-90`, `>90` hari), serta saldo titipan pelanggan (`titipan_balance`) secara terpisah per `p_as_of_date`. |
| `append_sales_note` | `sales_admin`, `reconciliation_reviewer`, `finance_checker`, `accountant` | `p_idempotency_key`, `p_sales_document_id`, `p_note_text` | Menambahkan catatan non-finansial append-only pada nota yang sudah dirilis tanpa mengubah angka atau status dokumen. |
| `upsert_customer_master`, `upsert_customer_alias`, `upsert_product_master` | `sales_admin`, `reconciliation_reviewer`, `accountant`, `system_admin` | Parameter master terkait + `p_idempotency_key` | Mengelola master pelanggan, alias pelanggan, dan produk secara aman melalui RPC karena direct-write ditolak RLS. |
