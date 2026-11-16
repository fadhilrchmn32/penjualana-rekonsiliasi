# Panduan Impor CSV/XLSX & Rencana Cutover — App 2 (Penjualan & Rekonsiliasi)

## 1. Prinsip Impor Aman
1. Impor adalah jalur migrasi histori & rekap awal, **bukan penghubung utama antar-app** (penerimaan tetap mengalir real-time dari App 1).
2. **14 Kolom Asli Tidak Wajib Diubah**:
   `DELIVERY DATE | WEEK | MONTH | CUST ID | CUST NAME | PRODUCT | QTY | NET PRICE | TOTAL SALES | SALES NAME | METODE PEMBAYARAN | STATUS PEMBAYARAN | KETERANGAN | REKONSILIASI (ALMIRA)`
3. **Template Diperluas (Opsional)**:
   Menambahkan `NOMOR NOTA`, `ID BARIS SUMBER`, `TANGGAL JATUH TEMPO`, `KODE PRODUK`, `SATUAN` agar satu nota dengan banyak baris produk dapat dikelompokkan secara akurat tanpa menebak.
4. **Konfirmasi Eksplisit Sebelum Commit**:
   - **Format Tanggal**: String `D/M/YY` atau `DD/MM/YYYY` baru di-parse setelah pengguna mengonfirmasi format (`DD/MM/YYYY`, `MM/DD/YYYY`, atau `YYYY-MM-DD`). Tanggal ambigu ditahan.
   - **Basis Pajak Batch**: Pengguna wajib memilih `Non-Pajak`, `Tax-Exclusive` (harga belum termasuk pajak), atau `Tax-Inclusive` (harga sudah termasuk pajak). Sistem tidak pernah menebak dari nama produk.
   - **Pemisahan Nilai Sumber vs Formula**: Jika `QTY × NET PRICE ≠ TOTAL SALES` pada file sumber, nilai mentah (`raw_source_total`) tetap disimpan, ditandai `has_price_discrepancy = true`, dan tidak ditimpa diam-diam.
   - **Grouping Tanpa Nomor Nota**: Jika tidak ada `NOMOR NOTA`, pengguna wajib memilih *"Setiap baris menjadi dokumen terpisah"* atau grouping manual yang dikonfirmasi (dilarang menggabung otomatis hanya berdasarkan nama pelanggan + tanggal).

## 2. Rencana Cutover Data Lama → Operasional Aktif
| Periode Data | Jalur Cutover di Impor App 2 | Perlakuan Sistem & Akuntansi |
| :--- | :--- | :--- |
| **Sebelum Tanggal Cutover (Sudah Lunas/Histori Lama)** | Pilih mode `legacy_archive` | Disimpan dengan `is_legacy_archive = true`, **non-posting** (tidak memancarkan event akuntansi), dan label `METODE/STATUS/REKONSILIASI` lama disimpan di `legacy_source_data` tanpa membuat receipt palsu. Tidak tercampur ke KPI aktif. |
| **Sebelum Tanggal Cutover (Piutang Masih Terbuka)** | Pilih mode `opening_subledger` (dicatat di `opening_subledger_items` App 3 + referensi nota terbuka) | Saldo awal piutang diakui satu kali sebagai saldo awal subledger App 3 sehingga tidak terjadi double-counting pendapatan historis saat pelunasan diterima setelah cutover. |
| **Mulai & Setelah Tanggal Cutover** | Pilih mode `active` | Masuk sebagai `draft` / `pending_delivery` untuk melalui verifikasi delivery, HPP, dan approval checker sebelum merilis event revenue + HPP ke App 3. |

## 3. Idempoten & Penanganan Duplikat
- Setiap batch menyimpan `file_hash` (SHA-256), `sheet_name`, `row_number`, `raw_data`, `mapping_version`, dan `fingerprint` per baris.
- Mengimpor ulang file dengan `file_hash` yang sama bersifat **idempoten** (tidak menggandakan transaksi).
- Dua transaksi sah yang kebetulan memiliki pelanggan, produk, tanggal, dan nominal identik pada file berbeda ditandai masuk review, dan dapat dipertahankan secara eksplisit oleh reviewer (`duplicate_kept`) tanpa ditolak diam-diam.
