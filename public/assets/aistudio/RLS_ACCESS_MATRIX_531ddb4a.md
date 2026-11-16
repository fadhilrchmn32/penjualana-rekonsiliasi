# RLS_ACCESS_MATRIX — FINOPS_SHARED_V1

Semua tabel di schema `public` mengaktifkan `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`.  
Akses `anon` dan `PUBLIC` dicabut sepenuhnya. Tidak ada penulisan langsung (`INSERT`/`UPDATE`/`DELETE`) dari klien browser ke tabel transaksi keuangan, audit, approval, atau membership; seluruh mutasi wajib melalui RPC terotorisasi.

## Matriks Hak Akses per Peran

| Peran (`role_code`) | Scope Data | Lihat Ringkasan & Receipt | Input Draft / Ajukan | Verifikasi / Terima Setoran / Reversal | Mutasi Bank & Impor | Pengaturan & Master |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `finance_maker` | Company + Branch sesuai membership | Ya (cabang terkait) | Ya (Transfer, Tunai, Setoran) | **Tidak** (atau dilarang untuk dokumen sendiri) | Impor & usul match | Lihat |
| `finance_checker` | Company + Branch sesuai membership | Ya (cabang terkait) | Ya (bila perlu) | **Ya** (hanya dokumen buatan maker lain) | Setujui match & verifikasi | Lihat |
| `collector_optional` | Hanya `actual_collector_id` / `created_by` miliknya | Hanya milik sendiri | Hanya laporan tunai milik sendiri | **Tidak** | **Tidak** (ditolak RLS) | **Tidak** |
| `sales_admin` | Company + Branch sesuai membership | Lihat antrian siap alokasi (`v_app2_allocatable_receipts`) | Usul identitas pengirim | **Tidak** | **Tidak** | Lihat pelanggan |
| `reconciliation_reviewer` | Company + Branch sesuai membership | Ya | Tidak | Setujui identitas & match mutasi | Lihat & setujui match | Lihat |
| `accountant` | Company + Branch sesuai membership | Ya | Tidak | Tidak (fokus akuntansi App 3) | Impor & lihat | Kelola rekening & petugas |
| `accounting_approver` | Company + Branch sesuai membership | Ya | Tidak | Setujui reversal berdampak akuntansi | Lihat | Lihat |
| `owner_viewer` | Company + Branch sesuai membership | Ya (read-only) | **Tidak** | **Tidak** | Lihat (read-only) | Lihat (read-only) |
| `system_admin` | Company | Ya (terbatas/audit) | **Tidak otomatis berhak transaksi** | **Tidak** | Lihat teknis | **Ya** (cabang, user, URL app) |
| `anonymous` (tidak login) | Tidak ada | **Ditolak** | **Ditolak** | **Ditolak** | **Ditolak** | **Ditolak** |

## Keamanan Storage (`finops-evidence`)
- Bucket bersifat **private** (`public = false`).
- Struktur path wajib: `{company_id}/{doc_type}/{doc_id}/{filename}`.
- Pembacaan bukti oleh browser hanya menggunakan signed URL berumur singkat (mis. 120 detik) setelah lolos kebijakan RLS `storage.objects` berdasarkan keanggotaan `company_id`. URL tebakan langsung ditolak oleh Supabase Storage.
