import React, { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import type { ExplicitDateFormat } from '../lib/dates';
import { formatDateID, formatDateTimeJakarta } from '../lib/dates';
import { formatIDR, formatQty } from '../lib/decimal';
import {
  autoSuggestColumnMapping,
  downloadTemplateWorkbook,
  extractSheetHeadersAndRows,
  readWorkbookFile,
  validateAndBuildImportPreview,
  type ParsedWorkbookInfo,
} from '../lib/excelImportExport';
import type {
  AppUserSession,
  BranchOption,
  CustomerAlias,
  ImportBatchSummary,
  ImportRowPreview,
  MasterCustomer,
  MasterProduct,
  MasterStaff,
  SalesRecapRow,
} from '../types/app';
import type { TaxBasis } from '../types/database.types';

interface ImporArsipViewProps {
  session: AppUserSession;
  branches: BranchOption[];
  customers: MasterCustomer[];
  aliases: CustomerAlias[];
  products: MasterProduct[];
  staffList: MasterStaff[];
  batches: ImportBatchSummary[];
  archiveRows: SalesRecapRow[];
  onCommitImport: (params: {
    branchId: string;
    fileName: string;
    fileHash: string;
    sheetName: string;
    dateFormat: string;
    decimalFormat: string;
    taxBasis: TaxBasis;
    groupingMode: 'row_per_doc' | 'by_source_invoice';
    cutoverMode: 'active' | 'legacy_archive' | 'opening_subledger';
    rows: ImportRowPreview[];
    allowDuplicateRows?: boolean;
  }) => Promise<{ batchId: string; idempotentReimport: boolean; docsCreated: number; rowsCommitted: number }>;
  onQuickAddCustomer: (branchId: string, custId: string, name: string) => Promise<void>;
  onQuickAddProduct: (sku: string, name: string, unitCode: string) => Promise<void>;
  onSelectDocument: (salesDocumentId: string) => void;
}

export function ImporArsipView({
  session,
  branches,
  customers,
  aliases,
  products,
  staffList,
  batches,
  archiveRows,
  onCommitImport,
  onQuickAddCustomer,
  onQuickAddProduct,
  onSelectDocument,
}: ImporArsipViewProps) {
  const [subTab, setSubTab] = useState<'import' | 'batches' | 'archive'>('import');
  const [branchId, setBranchId] = useState(session.branchId || branches[0]?.id || '');
  const [wbInfo, setWbInfo] = useState<ParsedWorkbookInfo | null>(null);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const [dateFormat, setDateFormat] = useState<ExplicitDateFormat>('UNCONFIRMED');
  const [decimalFormat, setDecimalFormat] = useState<'id_comma' | 'en_dot'>('en_dot');
  const [taxBasis, setTaxBasis] = useState<TaxBasis | ''>('');
  const [groupingMode, setGroupingMode] = useState<'row_per_doc' | 'by_source_invoice'>('row_per_doc');
  const [cutoverMode, setCutoverMode] = useState<'active' | 'legacy_archive' | 'opening_subledger'>('active');

  const [previewRows, setPreviewRows] = useState<ImportRowPreview[]>([]);
  const [previewPage, setPreviewPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const pageSize = 15;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatusMsg(null);
    const info = await readWorkbookFile(file);
    setWbInfo(info);
    const firstSheet = info.sheetNames[0] || '';
    setSelectedSheet(firstSheet);
    if (firstSheet) {
      const { headers: h, rawRows: rr } = extractSheetHeadersAndRows(info.workbook, firstSheet);
      setHeaders(h);
      setRawRows(rr);
      setMapping(autoSuggestColumnMapping(h));
      setPreviewRows([]);
    }
  };

  const handleSheetChange = (sheet: string) => {
    if (!wbInfo) return;
    setSelectedSheet(sheet);
    const { headers: h, rawRows: rr } = extractSheetHeadersAndRows(wbInfo.workbook, sheet);
    setHeaders(h);
    setRawRows(rr);
    setMapping(autoSuggestColumnMapping(h));
    setPreviewRows([]);
  };

  const handleRunPreview = async () => {
    setStatusMsg(null);
    if (!rawRows.length) return setStatusMsg({ type: 'err', text: 'Unggah file CSV/XLSX terlebih dahulu.' });
    if (dateFormat === 'UNCONFIRMED') {
      return setStatusMsg({
        type: 'err',
        text: 'Konfirmasi format tanggal sumber (DD/MM/YYYY, MM/DD/YYYY, atau YYYY-MM-DD) sebelum memvalidasi baris.',
      });
    }
    if (!taxBasis) {
      return setStatusMsg({
        type: 'err',
        text: 'Pilih basis pajak batch (Non-Pajak, Tax-Exclusive, atau Tax-Inclusive). Sistem tidak menebak dari nama produk.',
      });
    }

    setBusy(true);
    try {
      const validated = await validateAndBuildImportPreview({
        rawRows,
        mapping,
        dateFormat,
        decimalFormat,
        customers,
        aliases,
        products,
        staffList,
      });
      setPreviewRows(validated);
      setPreviewPage(1);
    } finally {
      setBusy(false);
    }
  };

  const previewStats = useMemo(() => {
    let valid = 0;
    let warning = 0;
    let error = 0;
    for (const r of previewRows) {
      if (r.validationStatus === 'error') error += 1;
      else if (r.validationStatus === 'warning') warning += 1;
      else valid += 1;
    }
    return { valid, warning, error };
  }, [previewRows]);

  const handleCommit = async () => {
    if (!wbInfo || !taxBasis || !previewRows.length) return;
    setStatusMsg(null);
    setBusy(true);
    try {
      const res = await onCommitImport({
        branchId,
        fileName: wbInfo.fileName,
        fileHash: wbInfo.fileHash,
        sheetName: selectedSheet,
        dateFormat,
        decimalFormat,
        taxBasis,
        groupingMode,
        cutoverMode,
        rows: previewRows,
      });
      if (res.idempotentReimport) {
        setStatusMsg({
          type: 'ok',
          text: `Re-impor idempoten: file dengan hash yang sama sudah pernah di-commit. Tidak ada transaksi ganda yang dibuat.`,
        });
      } else {
        setStatusMsg({
          type: 'ok',
          text: `Commit impor selesai: ${res.docsCreated} dokumen (${res.rowsCommitted} baris) berhasil masuk. Baris bermasalah tetap ditahan untuk resolusi.`,
        });
      }
    } catch (err) {
      setStatusMsg({ type: 'err', text: err instanceof Error ? err.message : 'Gagal commit impor.' });
    } finally {
      setBusy(false);
    }
  };

  const pagedPreview = previewRows.slice((previewPage - 1) * pageSize, previewPage * pageSize);
  const totalPreviewPages = Math.max(1, Math.ceil(previewRows.length / pageSize));

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Impor CSV/XLSX & Arsip Cutover</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Jalur migrasi rekap & histori dengan validasi ketat, konfirmasi tanggal/pajak, dan pemisahan arsip non-posting
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => downloadTemplateWorkbook(false)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
          >
            <Download className="w-3.5 h-3.5" />
            Template 14 Kolom Asli
          </button>
          <button
            type="button"
            onClick={() => downloadTemplateWorkbook(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-teal-800 bg-teal-50 border border-teal-200 rounded-md hover:bg-teal-100"
          >
            <Download className="w-3.5 h-3.5" />
            Template Diperluas (+No. Nota)
          </button>
        </div>
      </div>

      {/* Sub-navigation */}
      <div className="inline-flex p-1 bg-slate-100 border border-slate-200 rounded-md gap-1">
        <button
          type="button"
          onClick={() => setSubTab('import')}
          className={`px-3 py-1.5 text-xs font-medium rounded ${subTab === 'import' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'}`}
        >
          Staging & Impor File
        </button>
        <button
          type="button"
          onClick={() => setSubTab('batches')}
          className={`px-3 py-1.5 text-xs font-medium rounded ${subTab === 'batches' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'}`}
        >
          Riwayat Batch ({batches.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab('archive')}
          className={`px-3 py-1.5 text-xs font-medium rounded ${subTab === 'archive' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'}`}
        >
          Arsip Data Lama Non-Posting ({archiveRows.length})
        </button>
      </div>

      {statusMsg && (
        <div
          className={`p-3 rounded-md border text-xs flex items-center gap-2 ${
            statusMsg.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {statusMsg.type === 'ok' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {subTab === 'import' && (
        <div className="space-y-4">
          {/* Langkah 1 & 2: Unggah & Konfirmasi Aturan Batch */}
          <div className="bg-white border border-slate-200 rounded-md p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">1. Pilih File Excel (.xlsx) atau CSV</label>
                <label className="flex items-center justify-center gap-2 px-4 py-2 border border-dashed border-slate-300 rounded-md cursor-pointer hover:border-teal-600 bg-slate-50 text-xs text-slate-700">
                  <Upload className="w-4 h-4 text-teal-700" />
                  <span>{wbInfo ? wbInfo.fileName : 'Unggah CSV / XLSX'}</span>
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" />
                </label>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Sheet Workbook</label>
                <select
                  value={selectedSheet}
                  disabled={!wbInfo}
                  onChange={(e) => handleSheetChange(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-xs bg-white disabled:bg-slate-100"
                >
                  {!wbInfo && <option value="">Belum ada file</option>}
                  {wbInfo?.sheetNames.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Cabang Tujuan</label>
                <select
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-xs bg-white"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} — {b.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {wbInfo && (
              <div className="pt-3 border-t border-slate-200 space-y-4">
                <div className="text-[11px] font-mono text-slate-500">
                  SHA-256 Hash: {wbInfo.fileHash} · {rawRows.length} baris terdeteksi
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Format Tanggal Sumber *</label>
                    <select
                      value={dateFormat}
                      onChange={(e) => setDateFormat(e.target.value as ExplicitDateFormat)}
                      className={`w-full rounded border px-2.5 py-2 bg-white ${
                        dateFormat === 'UNCONFIRMED' ? 'border-amber-400 bg-amber-50/40' : 'border-slate-300'
                      }`}
                    >
                      <option value="UNCONFIRMED">-- Konfirmasi Format Tanggal --</option>
                      <option value="DD/MM/YYYY">DD/MM/YYYY (16/11/2026)</option>
                      <option value="MM/DD/YYYY">MM/DD/YYYY (11/16/2026)</option>
                      <option value="YYYY-MM-DD">ISO YYYY-MM-DD (2026-11-16)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Pemisah Ribuan / Desimal</label>
                    <select
                      value={decimalFormat}
                      onChange={(e) => setDecimalFormat(e.target.value as 'id_comma' | 'en_dot')}
                      className="w-full rounded border border-slate-300 px-2.5 py-2 bg-white"
                    >
                      <option value="en_dot">1,250,000.00 (Titik Desimal)</option>
                      <option value="id_comma">1.250.000,00 (Koma Desimal)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Basis Pajak Batch *</label>
                    <select
                      value={taxBasis}
                      onChange={(e) => setTaxBasis(e.target.value as TaxBasis)}
                      className={`w-full rounded border px-2.5 py-2 bg-white ${
                        !taxBasis ? 'border-amber-400 bg-amber-50/40' : 'border-slate-300'
                      }`}
                    >
                      <option value="">-- Wajib Konfirmasi Pajak --</option>
                      <option value="non_tax">Non-Pajak</option>
                      <option value="tax_exclusive">Tax-Exclusive (Net belum pajak)</option>
                      <option value="tax_inclusive">Tax-Inclusive (Sudah termasuk pajak)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Aturan Grouping Dokumen</label>
                    <select
                      value={groupingMode}
                      onChange={(e) => setGroupingMode(e.target.value as 'row_per_doc' | 'by_source_invoice')}
                      className="w-full rounded border border-slate-300 px-2.5 py-2 bg-white"
                    >
                      <option value="row_per_doc">Setiap baris menjadi dokumen terpisah</option>
                      <option value="by_source_invoice">Gabung berdasarkan NOMOR NOTA (bila ada)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Mode Cutover</label>
                    <select
                      value={cutoverMode}
                      onChange={(e) => setCutoverMode(e.target.value as 'active' | 'legacy_archive' | 'opening_subledger')}
                      className="w-full rounded border border-slate-300 px-2.5 py-2 bg-white"
                    >
                      <option value="active">Transaksi Aktif (Draft Operasional)</option>
                      <option value="legacy_archive">Arsip Sebelum Cutover (Non-Posting)</option>
                      <option value="opening_subledger">Saldo Awal Subledger Terbuka</option>
                    </select>
                  </div>
                </div>

                {/* Pemetaan Header Ringkas */}
                <details className="text-xs border border-slate-200 rounded p-3 bg-slate-50">
                  <summary className="cursor-pointer font-medium text-slate-800">
                    Pemetaan Kolom Sumber ({headers.length} kolom terdeteksi — 14 kolom standar dipetakan otomatis)
                  </summary>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                    {Object.entries(mapping).map(([key, col]) => (
                      <div key={key}>
                        <label className="block text-[11px] text-slate-500">{key}</label>
                        <select
                          value={col}
                          onChange={(e) => setMapping((prev) => ({ ...prev, [key]: e.target.value }))}
                          className="w-full rounded border border-slate-300 px-2 py-1 text-xs bg-white"
                        >
                          <option value="">(Tidak dipetakan)</option>
                          {headers.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </details>

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleRunPreview}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    Validasi & Tampilkan Preview ({rawRows.length} baris)
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Preview Validasi & Resolusi */}
          {previewRows.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
                <div className="flex items-center gap-4">
                  <span className="font-semibold text-slate-900">Hasil Validasi Staging</span>
                  <span className="text-emerald-700 font-medium">Siap: {previewStats.valid}</span>
                  <span className="text-amber-700 font-medium">Perlu Review / Resolusi: {previewStats.warning}</span>
                  <span className="text-rose-700 font-medium">Ditolak: {previewStats.error}</span>
                </div>
                <button
                  type="button"
                  disabled={busy || previewStats.valid === 0}
                  onClick={handleCommit}
                  className="px-4 py-1.5 text-xs font-medium bg-teal-700 text-white rounded hover:bg-teal-800 disabled:opacity-50"
                >
                  {busy ? 'Memproses Commit...' : `Commit Baris Valid (${previewStats.valid}) secara Atomik`}
                </button>
              </div>

              <div className="overflow-x-auto thin-scrollbar">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2 px-3">Baris</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">Delivery Date</th>
                      <th className="py-2 px-3">Week / Month (Sumber vs Derivasi)</th>
                      <th className="py-2 px-3">CUST ID & Nama</th>
                      <th className="py-2 px-3">Produk / SKU</th>
                      <th className="py-2 px-3 text-right">QTY × Net Price</th>
                      <th className="py-2 px-3 text-right">Total Sumber</th>
                      <th className="py-2 px-3">Catatan Validasi & Resolusi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {pagedPreview.map((r) => (
                      <tr key={r.rowNo} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-mono text-slate-500">#{r.rowNo}</td>
                        <td className="py-2 px-3">
                          <span
                            className={`px-2 py-0.5 text-[11px] font-medium rounded border ${
                              r.validationStatus === 'valid'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : r.validationStatus === 'warning'
                                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                                  : 'bg-rose-50 text-rose-800 border-rose-200'
                            }`}
                          >
                            {r.validationStatus === 'valid' ? 'Valid' : r.validationStatus === 'warning' ? 'Review' : 'Ditolak'}
                          </span>
                        </td>
                        <td className="py-2 px-3 font-mono">
                          {r.deliveryDateIso ? formatDateID(r.deliveryDateIso) : <span className="text-rose-700">{r.deliveryDateRaw}</span>}
                        </td>
                        <td className="py-2 px-3 font-mono text-[11px]">
                          <div>{r.weekDerived} · {r.monthDerived}</div>
                          {(r.weekRaw || r.monthRaw) && (
                            <div className="text-slate-400">Sumber: {r.weekRaw || '-'} · {r.monthRaw || '-'}</div>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <div className="font-mono text-slate-800">{r.custId}</div>
                          <div className="text-slate-700">{r.custName}</div>
                          {!r.resolvedCustomerId && r.custId && (
                            <div className="mt-1 space-y-1">
                              {r.suggestedCustomerMatch && (
                                <div className="text-[10px] text-amber-700">
                                  Usulan ({r.suggestedCustomerMatch.via}): [{r.suggestedCustomerMatch.custId}] {r.suggestedCustomerMatch.name}
                                </div>
                              )}
                              <button
                                type="button"
                                onClick={async () => {
                                  await onQuickAddCustomer(branchId, r.custId, r.custName || `Pelanggan ${r.custId}`);
                                  await handleRunPreview();
                                }}
                                className="text-[10px] font-medium text-teal-700 hover:underline"
                              >
                                + Daftarkan ke Master Pelanggan
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <div className="text-slate-800">{r.productName}</div>
                          <div className="font-mono text-[11px] text-slate-500">{r.productSku || '-'}</div>
                          {!r.resolvedProductId && (r.productSku || r.productName) && (
                            <button
                              type="button"
                              onClick={async () => {
                                await onQuickAddProduct(
                                  r.productSku || `SKU-${r.rowNo}`,
                                  r.productName || r.productSku,
                                  r.unitCode || 'PCS'
                                );
                                await handleRunPreview();
                              }}
                              className="text-[10px] font-medium text-teal-700 hover:underline mt-0.5"
                            >
                              + Daftarkan ke Master Produk
                            </button>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {formatQty(r.quantity)} × {formatIDR(r.netUnitPrice)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          <div className={r.hasPriceDiscrepancy ? 'text-rose-700 font-semibold' : 'text-slate-900'}>
                            {formatIDR(r.rawTotalSales)}
                          </div>
                          {r.hasPriceDiscrepancy && (
                            <div className="text-[10px] text-slate-500">Formula: {formatIDR(r.computedTotalSales)}</div>
                          )}
                        </td>
                        <td className="py-2 px-3 max-w-xs text-[11px] text-slate-600">
                          {r.validationMessages.length ? r.validationMessages.join(' · ') : 'Siap diimpor'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="px-4 py-2.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs">
                <span className="text-slate-500 font-mono">
                  Hal {previewPage} / {totalPreviewPages} ({previewRows.length} baris)
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={previewPage <= 1}
                    onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                    className="px-2.5 py-1 border border-slate-300 rounded bg-white disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={previewPage >= totalPreviewPages}
                    onClick={() => setPreviewPage((p) => Math.min(totalPreviewPages, p + 1))}
                    className="px-2.5 py-1 border border-slate-300 rounded bg-white disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {subTab === 'batches' && (
        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          {batches.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">Belum ada batch impor penjualan.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2.5 px-3">Nama File</th>
                    <th className="py-2.5 px-3">Hash File</th>
                    <th className="py-2.5 px-3">Mode Cutover & Pajak</th>
                    <th className="py-2.5 px-3 text-right">Diterima / Review / Tolak</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Waktu</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {batches.map((b) => (
                    <tr key={b.id}>
                      <td className="py-2.5 px-3 font-medium text-slate-900">{b.fileName} ({b.sheetName || '-'})</td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500">{b.fileHash.slice(0, 14)}…</td>
                      <td className="py-2.5 px-3 font-mono text-[11px]">{b.cutoverMode} · {b.taxBasis}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {b.acceptedRows} / {b.reviewRows} / {b.rejectedRows}
                      </td>
                      <td className="py-2.5 px-3 text-emerald-700 font-medium">{b.status}</td>
                      <td className="py-2.5 px-3 text-[11px] text-slate-500">{formatDateTimeJakarta(b.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {subTab === 'archive' && (
        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
            Data arsip sebelum tanggal cutover disimpan sebagai catatan historis non-posting. Tidak masuk ke KPI penjualan aktif dan tidak menciptakan receipt fiktif.
          </div>
          {archiveRows.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">Belum ada data arsip lama.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2 px-3">Tgl Kirim</th>
                    <th className="py-2 px-3">No. Dokumen</th>
                    <th className="py-2 px-3">Pelanggan</th>
                    <th className="py-2 px-3">Produk</th>
                    <th className="py-2 px-3 text-right">Total Sumber</th>
                    <th className="py-2 px-3">Label Asal File</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {archiveRows.map((r) => {
                    const leg = (r.legacySourceData || {}) as Record<string, string>;
                    return (
                      <tr key={r.salesLineId}>
                        <td className="py-2 px-3 font-mono">{formatDateID(r.deliveryDate)}</td>
                        <td className="py-2 px-3">
                          <button
                            type="button"
                            onClick={() => onSelectDocument(r.salesDocumentId)}
                            className="font-mono text-teal-700 hover:underline"
                          >
                            {r.docNumber}
                          </button>
                        </td>
                        <td className="py-2 px-3">[{r.custId}] {r.custName}</td>
                        <td className="py-2 px-3">{r.productName}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">{formatIDR(r.lineTotal)}</td>
                        <td className="py-2 px-3 text-[11px] text-slate-500">
                          {leg.legacy_method || '-'} · {leg.legacy_status || '-'} · {leg.legacy_recon || '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
