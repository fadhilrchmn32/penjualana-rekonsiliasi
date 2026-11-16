# Compatibility Report — App 1 (`0001`–`0004`) vs App 2 (`FINOPS_SHARED_V1`)

Tanggal Pemeriksaan: `16 November 2026`  
Basis Pemeriksaan: `0001_finops_shared_v1_foundation`, `0002_finops_shared_v1_rls_security`, `0003_finops_app1_rpcs`, `0004_finops_app2_views_and_realtime`, `SHARED_BACKEND_CONTRACT.md`, `RPC_CONTRACT.md`, `RLS_ACCESS_MATRIX.md`.

---

## Ringkasan Hasil Pemeriksaan

Skema fondasi App 1 (`0001`–`0004`) telah menyiapkan struktur tabel kanonis yang kuat untuk seluruh domain `FINOPS_SHARED_V1`. Tidak ditemukan konflik nama tabel atau tipe identitas utama (`customers.cust_id` sudah `TEXT`, `sales_documents` dan `payment_allocations` sudah ada, `receipts` tidak perlu diubah).

Namun, terdapat **6 celah kompatibilitas spesifik** antara hasil migrasi App 1 dan kebutuhan operasional App 2 yang diselesaikan secara **additive-only** pada migrasi `0005` & `0006` tanpa membuat tabel pengganti (`payments`/`customers`/`sales` terpisah) dan tanpa mengganggu App 1:

| No | Temuan pada Skema Aktual App 1 (`0001`–`0004`) | Dampak bagi App 2 | Solusi Aman (Additive-Only di `0005` / `0006`) |
| :--- | :--- | :--- | :--- |
| 1 | **`0002` mengaktifkan `FORCE ROW LEVEL SECURITY` pada semua tabel, tetapi belum membuat `CREATE POLICY ... FOR SELECT` untuk tabel domain App 2** (`products`, `product_units`, `sales_lines`, `sales_adjustments`, `document_links`, `reconciliation_reviews`, `import_batches`, `import_rows`, `tax_codes`, `allocation_approvals`, `customer_refunds`, `refund_lines`, `attachments`, `inventory_valuations`, `inventory_movements`, `fiscal_periods`). | Klien terautentikasi mendapat `0 rows` saat membaca produk, baris nota, atau batch impor melalui Supabase client/views `security_invoker`. | `0005` menambahkan `CREATE POLICY ... FOR SELECT TO authenticated` sesuai matriks role (`inventory_valuations` & `inventory_movements` dibatasi agar `sales_admin` tidak dapat melihat HPP/harga beli). |
| 2 | **`sales_documents` belum memiliki status `pending_delivery`, kolom `tax_basis`, `planned_payment_method`, `delivery_confirmed_at`, `reconciliation_status`, `is_legacy_archive`, dan `legacy_source_data`.** | Pengakuan penjualan per tanggal kirim terkonfirmasi, pemisahan metode rencana vs alokasi aktif, dan isolasi arsip non-posting cutover membutuhkan kolom tersebut. | `0005` menambahkan kolom secara `ADD COLUMN IF NOT EXISTS` dan memperbarui check constraint `sales_documents_status_check` untuk menambah `'pending_delivery'`. |
| 3 | **`sales_lines` belum menyimpan snapshot nama/SKU (`product_name_snapshot`), `raw_source_total`, `has_price_discrepancy`, dan `source_line_id`.** | Perubahan master produk di masa depan akan mengubah histori rekap jika tidak ada snapshot; selisih nilai impor lama tidak dapat ditandai tanpa menimpa raw value. | `0005` menambahkan kolom snapshot dan penanda selisih harga pada `sales_lines`. |
| 4 | **`import_batches` & `import_rows` masih minimal (`file_name`, `file_hash`, `raw_data`).** | Preview multi-sheet, format tanggal/angka, `tax_basis`, `grouping_mode`, `cutover_mode`, fingerprint, dan resolusi master belum tertampung. | `0005` memperluas `import_batches` dan `import_rows` secara additive. |
| 5 | **Lampiran `database.types.ts` belum disertakan dalam paket file App 1.** | TypeScript client membutuhkan definisi tipe tabel, view, dan enum yang sinkron. | Dibuat `src/types/database.types.ts` lengkap mencakup `0001`–`0006`. |
| 6 | **Kebijakan `storage.objects` (`finops-evidence`) pada `0002` hanya mengizinkan `INSERT` untuk role App 1 (`finance_*`, `collector_optional`, `accountant`).** | `sales_admin` dan `reconciliation_reviewer` membutuhkan unggah bukti penyerahan barang (`delivery_proof_path`). | `0005` memperbarui policy `finops_evidence_insert` agar turut mengizinkan `sales_admin` dan `reconciliation_reviewer`. |

## Jaminan Kompatibilitas App 1
- Tabel milik App 1 (`receipts`, `receipt_evidence`, `bank_statement_*`, `bank_matches`, `cash_custody_accounts`, `cash_deposits*`, `custody_movements*`, `cash_transfers`) **tidak diubah strukturnya**.
- `v_app2_allocatable_receipts` (`0004`) tetap utuh dan digunakan langsung oleh App 2 untuk daftar penerimaan terverifikasi/menunggu verifikasi.
- `approve_receipt_reversal` (`0003`) sudah memeriksa `public.payment_allocations WHERE status IN ('proposed', 'approved')`, sehingga alokasi yang dibuat App 2 otomatis melindungi receipt App 1 dari reversal sepihak.
