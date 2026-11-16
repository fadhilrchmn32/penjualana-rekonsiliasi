# RLS_ACCESS_MATRIX — FINOPS_SHARED_V1 (App 1 + App 2)

Semua tabel di schema `public` mengaktifkan `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`.  
Akses `anon` dan `PUBLIC` dicabut sepenuhnya. Seluruh mutasi wajib melalui RPC `SECURITY DEFINER`.

| Peran (`role_code`) | Scope Data | Baca Rekap & Nota (`sales_documents`/`sales_lines`) | Draft / Ajukan / Impor Penjualan | Setujui & Rilis Penjualan / Alokasi / Review Almira / Nota Kredit | Lihat HPP & Valuasi Stok (`inventory_valuations`) | Master Pelanggan & Produk |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `sales_admin` | Company + Branch sesuai membership | Ya (cabang terkait) | **Ya** | Usul alokasi saja (**tidak boleh approve sendiri**) | **Ditolak RLS** | Kelola pelanggan, alias, produk |
| `reconciliation_reviewer` | Company + Branch sesuai membership | Ya (cabang terkait) | Ya | **Ya** (hanya dokumen/usulan buatan pihak lain — maker-checker) | Ya | Kelola pelanggan, alias, produk |
| `finance_maker` | Company + Branch sesuai membership | Ya | Tidak | Usul alokasi | **Ditolak RLS** | Lihat |
| `finance_checker` | Company + Branch sesuai membership | Ya | Tidak | Setujui alokasi / review (≠ pengusul) | **Ditolak RLS** | Lihat |
| `accountant` | Company + Branch sesuai membership | Ya | Tidak | Lihat | **Ya** | Kelola |
| `accounting_approver` | Company + Branch sesuai membership | Ya | Tidak | Setujui rilis, lepas alokasi, nota kredit | **Ya** | Lihat |
| `owner_viewer` | Company + Branch sesuai membership | Ya (read-only) | **Tidak** | **Tidak** | **Ya** (read-only) | Lihat |
| `system_admin` | Company | Ya (dukungan teknis) | Ya (konfigurasi/impor) | **Tidak otomatis berhak transaksi keuangan** | Ya | Kelola |
| `collector_optional` | Hanya cabang/custody miliknya | Terbatas cabang | **Tidak** | **Tidak** | **Ditolak RLS** | **Tidak** |
| `anonymous` | Tidak ada | **Ditolak** | **Ditolak** | **Ditolak** | **Ditolak** | **Ditolak** |

## Keamanan Storage (`finops-evidence`)
- Bucket bersifat **private** (`public = false`) dengan path `{company_id}/{doc_type}/{doc_id}/{filename}`.
- `sales_admin` dan `reconciliation_reviewer` dapat mengunggah bukti penyerahan barang; pembacaan selalu via signed URL berumur singkat.
