# UAT & Rencana Pengujian Integrasi — App 2 (Penjualan & Rekonsiliasi)

Pengujian mencakup 11 kriteria penerimaan wajib `FINOPS_SHARED_V1` beserta pembuktian expected vs actual.

## Matriks Pengujian Kriteria Penerimaan

| ID | Skenario Uji | Expected Result | Status |
| :--- | :--- | :--- | :--- |
| `UAT-01` | Input 3 produk dalam 1 nota penjualan | Rekap menampilkan 3 baris produk, namun 1 dokumen dengan 1 nilai tagihan & 1 outstanding; footer membedakan total baris vs total dokumen. | Terverifikasi pada engine domain & test runner (`tests/uat.test.ts`); SQL tersedia untuk database uji. |
| `UAT-02` | Receipt transfer & tunai dari App 1 | Tampil langsung di Pencocokan Pembayaran dari `v_app2_allocatable_receipts` tanpa impor ulang. | Terverifikasi pada view kontrak `0004` & adapter App 2. |
| `UAT-03` | Alokasi M:N (Rp1.200.000 -> Nota A Rp1.000.000 + Nota B Rp200.000; cicilan tunai Rp300.000 melunasi Nota B) + uji over-allocation | Sisa receipt & sisa tagihan akurat; concurrent/over-allocation ditolak dengan error saldo tidak mencukupi. | Terverifikasi di `approve_payment_allocation` (`FOR UPDATE`) dan UAT suite. |
| `UAT-04` | Kolom `STATUS PEMBAYARAN` (Lunas) tidak bisa diedit manual atau dipercaya dari CSV sumber | Nilai status pembayaran hanya dihitung server dari alokasi terverifikasi disetujui; label CSV disimpan di `legacy_source_data`. | Terverifikasi di `draft_sale`, `preview_sales_import`, `v_app2_document_balances`. |
| `UAT-05` | Total penjualan setelah join banyak pembayaran & filter | Join ke `v_app2_document_balances` (agregasi 1:1 per dokumen) tidak melipatgandakan `QTY` atau `TOTAL SALES`. | Terverifikasi di `v_app2_sales_recap` & UAT suite. |
| `UAT-06` | Status tunai `Lunas` + `Uang Masih di Penagih` tampil bersamaan | Nota berstatus `paid` sementara indikator custody terpisah menampilkan `Tunai Masih di Penagih` berdasarkan `receipts.deposit_status`. | Terverifikasi di UI & read model. |
| `UAT-07` | Review "Cocok" (Almira) untuk penjualan kredit sah | `reconciliation_status = 'matched'` tersimpan dengan reviewer & timestamp tanpa memaksa piutang menjadi 0. | Terverifikasi di `save_reconciliation_review` & UAT suite. |
| `UAT-08` | Re-impor file CSV/XLSX yang sama (idempoten) vs transaksi identik sah pada file berbeda | Re-import `file_hash` sama tidak menggandakan penjualan; transaksi identik sah di file berbeda masuk review dan dapat dipertahankan (`duplicate_kept`). | Terverifikasi di `preview_sales_import`, `commit_sales_import`, & UAT suite. |
| `UAT-09` | Penjualan terkirim November dibayar Desember (cut-off tanggal laporan) | Penjualan tetap di periode November (`delivery_date`); laporan per `30/11` menampilkan nota masih terbuka (pembayaran Desember tidak membocorkan status Lunas ke November). | Terverifikasi di `get_sales_recap(p_cutoff_date)` & `get_customer_receivable(p_as_of_date)`. |
| `UAT-10` | Keamanan RLS, cabang, role, maker-checker, dan ID tebakan | User tanpa role, cabang berbeda, maker menyetujui dokumen sendiri, serta pembacaan HPP oleh `sales_admin` ditolak backend. | Terverifikasi di `0005` & `0006` + unit test domain. |
| `UAT-11` | HPP kosong, customer tak jelas, selisih total, dan tanggal ambigu | Tidak dianggap selesai: `approve_and_release_sale` memblokir rilis bila stok/HPP kosong; impor menahan tanggal ambigu, customer tak dikenal, dan selisih harga untuk review. | Terverifikasi di `0006` & UAT suite. |
