import React, { useMemo, useState } from 'react';
import { ArrowDownUp, Download, Eye, Plus, Search, Upload } from 'lucide-react';
import Decimal from 'decimal.js';
import { formatDateID, formatDateTimeJakarta, formatMonthLabelID } from '../lib/dates';
import { formatIDR, formatQty, toDec } from '../lib/decimal';
import { exportSalesRecapWorkbook } from '../lib/excelImportExport';
import type { BranchOption, MasterStaff, SalesRecapRow } from '../types/app';
import {
  AccountingStatusBadge,
  InfoTooltip,
  PaymentStatusBadge,
  ReconciliationBadge,
  SalesDocStatusBadge,
} from '../components/StatusBadges';

interface RekapPenjualanViewProps {
  rows: SalesRecapRow[];
  loading: boolean;
  branches: BranchOption[];
  staffList: MasterStaff[];
  cutoffDate: string;
  onCutoffDateChange: (val: string) => void;
  includeArchive: boolean;
  onIncludeArchiveChange: (val: boolean) => void;
  onSelectDocument: (salesDocumentId: string) => void;
  onOpenNewNota: () => void;
  onGoToImport: () => void;
}

export function RekapPenjualanView({
  rows,
  loading,
  branches,
  staffList,
  cutoffDate,
  onCutoffDateChange,
  includeArchive,
  onIncludeArchiveChange,
  onSelectDocument,
  onOpenNewNota,
  onGoToImport,
}: RekapPenjualanViewProps) {
  const [tableMode, setTableMode] = useState<'recap14' | 'operational'>('recap14');
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [salesFilter, setSalesFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const pageSize = 20;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (branchFilter && r.branchId !== branchFilter) return false;
      if (salesFilter && r.salesStaffId !== salesFilter) return false;
      if (paymentFilter && r.statusPembayaran !== paymentFilter) return false;
      if (dateFrom && (!r.deliveryDate || r.deliveryDate < dateFrom)) return false;
      if (dateTo && (!r.deliveryDate || r.deliveryDate > dateTo)) return false;
      if (q) {
        const hay = `${r.docNumber} ${r.sourceInvoiceNo || ''} ${r.custId} ${r.custName} ${r.productSku} ${r.productName} ${r.salesName} ${r.lineTotal} ${r.keterangan}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return list.sort((a, b) => {
      const cmp = (a.deliveryDate || '').localeCompare(b.deliveryDate || '') || a.docNumber.localeCompare(b.docNumber);
      return sortAsc ? cmp : -cmp;
    });
  }, [rows, search, branchFilter, salesFilter, paymentFilter, dateFrom, dateTo, sortAsc]);

  // Footer: bedakan total sales per baris vs total tagihan & sisa piutang per dokumen unik!
  const totals = useMemo(() => {
    let lineSalesTotal = new Decimal(0);
    let totalQty = new Decimal(0);
    const seenDocs = new Map<string, SalesRecapRow>();

    for (const r of filtered) {
      lineSalesTotal = lineSalesTotal.plus(toDec(r.lineTotal));
      totalQty = totalQty.plus(toDec(r.quantity));
      if (!seenDocs.has(r.salesDocumentId)) {
        seenDocs.set(r.salesDocumentId, r);
      }
    }

    let docNetBill = new Decimal(0);
    let docPaid = new Decimal(0);
    let docOutstanding = new Decimal(0);
    for (const d of seenDocs.values()) {
      docNetBill = docNetBill.plus(toDec(d.netBillAmount));
      docPaid = docPaid.plus(toDec(d.paidAmount));
      docOutstanding = docOutstanding.plus(toDec(d.outstandingAmount));
    }

    return {
      lineCount: filtered.length,
      docCount: seenDocs.size,
      totalQty,
      lineSalesTotal,
      docNetBill,
      docPaid,
      docOutstanding,
    };
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  const payMethodBadge = (method: SalesRecapRow['metodePembayaran']) => {
    const cls =
      method === 'Transfer'
        ? 'bg-sky-50 text-sky-800 border-sky-200'
        : method === 'Tunai'
          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
          : method === 'Campuran'
            ? 'bg-teal-50 text-teal-800 border-teal-200'
            : 'bg-slate-100 text-slate-600 border-slate-200';
    return (
      <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded border whitespace-nowrap ${cls}`}>
        {method}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Rekap Penjualan (14 Kolom Wajib)</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Urutan 14 kolom dipertahankan konsisten · Total pembayaran/piutang dihitung per dokumen (anti double-join)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Segmented control mode tabel */}
          <div className="inline-flex items-center p-1 bg-slate-100 border border-slate-200 rounded-md">
            <button
              type="button"
              onClick={() => setTableMode('recap14')}
              className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap transition-colors ${
                tableMode === 'recap14' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Rekap 14 Kolom
            </button>
            <button
              type="button"
              onClick={() => setTableMode('operational')}
              className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap transition-colors ${
                tableMode === 'operational' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Detail Operasional
            </button>
          </div>

          <button
            type="button"
            onClick={onGoToImport}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" />
            Bulk Impor
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setExportMenuOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Ekspor
            </button>
            {exportMenuOpen && (
              <div className="absolute right-0 mt-1 w-64 bg-white border border-slate-200 rounded-md shadow-lg z-30 py-1 text-xs">
                <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-500 border-b border-slate-100">
                  Rekap Operasional (Status Sah Terkini)
                </div>
                <button
                  type="button"
                  onClick={() => {
                    exportSalesRecapWorkbook(filtered, 'operational', 'xlsx');
                    setExportMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 text-slate-800"
                >
                  Unduh Excel (.xlsx) — Operasional
                </button>
                <button
                  type="button"
                  onClick={() => {
                    exportSalesRecapWorkbook(filtered, 'operational', 'csv');
                    setExportMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 text-slate-800"
                >
                  Unduh CSV — Operasional
                </button>
                <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-500 border-y border-slate-100 mt-1">
                  Arsip Sumber (Nilai & Label Asal)
                </div>
                <button
                  type="button"
                  onClick={() => {
                    exportSalesRecapWorkbook(filtered, 'legacy_source', 'xlsx');
                    setExportMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 text-slate-800"
                >
                  Unduh Excel (.xlsx) — Arsip Sumber
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onOpenNewNota}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            Input Manual
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-md p-3.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
        <div className="lg:col-span-2">
          <label className="block text-[11px] font-medium text-slate-600 mb-1">Cari Nota / Pelanggan / Produk / Nominal</label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Contoh: 00104, Sumber Makmur, SLS-..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md focus:border-teal-600 focus:outline-none"
            />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-1">Dari Tgl Kirim</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-1">Sampai Tgl Kirim</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-1">
            Cut-off Laporan
            <InfoTooltip text="Menghitung status bayar & sisa piutang per tanggal cut-off ini. Pembayaran bulan berikutnya tidak membuat nota terlihat lunas pada periode sebelumnya." />
          </label>
          <input
            type="date"
            value={cutoffDate}
            onChange={(e) => onCutoffDateChange(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs font-mono border border-teal-600/50 bg-teal-50/30 rounded-md"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-1">Status Pembayaran</label>
          <select
            value={paymentFilter}
            onChange={(e) => {
              setPaymentFilter(e.target.value);
              setPage(1);
            }}
            className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
          >
            <option value="">Semua Status</option>
            <option value="unpaid">Belum Dibayar</option>
            <option value="partially_paid">Dibayar Sebagian</option>
            <option value="paid">Lunas</option>
          </select>
        </div>

        <div className="lg:col-span-6 flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="px-2.5 py-1 text-xs border border-slate-300 rounded bg-white"
            >
              <option value="">Semua Cabang Diizinkan</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
            </select>
            <select
              value={salesFilter}
              onChange={(e) => setSalesFilter(e.target.value)}
              className="px-2.5 py-1 text-xs border border-slate-300 rounded bg-white"
            >
              <option value="">Semua Sales</option>
              {staffList
                .filter((s) => s.staffRole === 'sales')
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName}
                  </option>
                ))}
            </select>
            <label className="inline-flex items-center gap-1.5 text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={includeArchive}
                onChange={(e) => onIncludeArchiveChange(e.target.checked)}
                className="rounded border-slate-300 text-teal-700"
              />
              Sertakan Arsip Cutover Lama (Non-Posting)
            </label>
          </div>
          <button
            type="button"
            onClick={() => setSortAsc((v) => !v)}
            className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900"
          >
            <ArrowDownUp className="w-3.5 h-3.5" />
            Urut Tgl Kirim ({sortAsc ? 'Terlama' : 'Terbaru'})
          </button>
        </div>
      </div>

      {/* Tabel 14 Kolom Wajib */}
      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <div className="overflow-x-auto thin-scrollbar">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="bg-slate-900 text-slate-100 text-[11px] tracking-wide">
              <tr>
                <th className="py-2.5 px-3 font-semibold whitespace-nowrap">DELIVERY DATE</th>
                <th className="py-2.5 px-3 font-semibold whitespace-nowrap">
                  WEEK
                  <InfoTooltip text="Tahun dan minggu ISO-8601 diturunkan otomatis dari DELIVERY DATE." />
                </th>
                <th className="py-2.5 px-3 font-semibold whitespace-nowrap">MONTH</th>
                <th className="py-2.5 px-3 font-semibold whitespace-nowrap">CUST ID</th>
                <th className="py-2.5 px-3 font-semibold whitespace-nowrap">CUST NAME</th>
                <th className="py-2.5 px-3 font-semibold whitespace-nowrap">PRODUCT</th>
                <th className="py-2.5 px-3 font-semibold whitespace-nowrap text-right">QTY</th>
                <th className="py-2.5 px-3 font-semibold whitespace-nowrap text-right">NET PRICE</th>
                <th className="py-2.5 px-3 font-semibold whitespace-nowrap text-right">TOTAL SALES</th>
                <th className="py-2.5 px-3 font-semibold whitespace-nowrap">SALES NAME</th>
                <th className="py-2.5 px-3 font-semibold whitespace-nowrap">METODE PEMBAYARAN</th>
                <th className="py-2.5 px-3 font-semibold whitespace-nowrap">STATUS PEMBAYARAN</th>
                <th className="py-2.5 px-3 font-semibold whitespace-nowrap">KETERANGAN</th>
                <th className="py-2.5 px-3 font-semibold whitespace-nowrap">REKONSILIASI (ALMIRA)</th>
                {tableMode === 'operational' && (
                  <>
                    <th className="py-2.5 px-3 font-semibold whitespace-nowrap bg-slate-800">NOMOR NOTA</th>
                    <th className="py-2.5 px-3 font-semibold whitespace-nowrap bg-slate-800">STATUS NOTA</th>
                    <th className="py-2.5 px-3 font-semibold whitespace-nowrap bg-slate-800">JATUH TEMPO</th>
                    <th className="py-2.5 px-3 font-semibold whitespace-nowrap text-right bg-slate-800">TAGIHAN NOTA</th>
                    <th className="py-2.5 px-3 font-semibold whitespace-nowrap text-right bg-slate-800">TERBAYAR</th>
                    <th className="py-2.5 px-3 font-semibold whitespace-nowrap text-right bg-slate-800">SISA PIUTANG</th>
                    <th className="py-2.5 px-3 font-semibold whitespace-nowrap text-right bg-slate-800">SALDO TITIPAN</th>
                    <th className="py-2.5 px-3 font-semibold whitespace-nowrap bg-slate-800">STATUS JURNAL</th>
                  </>
                )}
                <th className="py-2.5 px-3 font-semibold whitespace-nowrap text-center">AKSI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading && (
                <tr>
                  <td colSpan={tableMode === 'operational' ? 23 : 15} className="py-8 text-center text-slate-500">
                    Memuat rekap penjualan dari server...
                  </td>
                </tr>
              )}
              {!loading && pagedRows.length === 0 && (
                <tr>
                  <td colSpan={tableMode === 'operational' ? 23 : 15} className="py-10 text-center text-slate-500">
                    Tidak ada baris penjualan yang cocok dengan filter saat ini.
                  </td>
                </tr>
              )}
              {!loading &&
                pagedRows.map((r) => (
                  <tr key={r.salesLineId} className="hover:bg-slate-50/90 transition-colors">
                    <td className="py-2.5 px-3 font-mono whitespace-nowrap text-slate-900">
                      {r.deliveryDate ? formatDateID(r.deliveryDate) : <span className="text-amber-700">Belum Kirim</span>}
                    </td>
                    <td className="py-2.5 px-3 font-mono whitespace-nowrap text-slate-600">{r.isoWeek}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap text-slate-700">
                      <span className="font-mono text-[11px]">{r.isoMonth}</span>
                      {r.isoMonth !== '-' && (
                        <span className="text-[11px] text-slate-500 ml-1.5">({formatMonthLabelID(r.isoMonth)})</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-mono whitespace-nowrap text-slate-800">{r.custId}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap font-medium text-slate-900">{r.custName}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="text-slate-900">{r.productName}</div>
                      <div className="text-[11px] font-mono text-slate-500">{r.productSku}</div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatQty(r.quantity)} <span className="text-[11px] text-slate-500">{r.unitCode}</span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap text-slate-700">
                      {formatIDR(r.netUnitPrice)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap font-medium text-slate-900">
                      {formatIDR(r.lineTotal)}
                      {r.hasPriceDiscrepancy && (
                        <div className="text-[10px] text-rose-700 font-sans">Selisih sumber: {formatIDR(r.rawSourceTotal)}</div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap text-slate-700">{r.salesName}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {payMethodBadge(r.metodePembayaran)}
                      {r.plannedPaymentMethod !== 'unknown' && r.metodePembayaran === 'Belum Ada' && (
                        <div className="text-[10px] text-slate-400 mt-0.5">Rencana: {r.plannedPaymentMethod}</div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <PaymentStatusBadge
                        status={r.statusPembayaran}
                        hasPendingVerification={r.hasPendingVerification}
                        hasCashAtCollector={r.hasCashAtCollector}
                      />
                    </td>
                    <td className="py-2.5 px-3 max-w-[200px] truncate text-slate-600" title={r.keterangan}>
                      {r.keterangan || '-'}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <ReconciliationBadge
                        status={r.reconciliationStatus}
                        reviewerName={
                          r.reconciledByName
                            ? `${r.reconciledByName} · ${formatDateTimeJakarta(r.reconciledAt)}`
                            : null
                        }
                      />
                    </td>

                    {tableMode === 'operational' && (
                      <>
                        <td className="py-2.5 px-3 font-mono whitespace-nowrap text-slate-800 bg-slate-50/50">
                          {r.docNumber}
                          {r.isLegacyArchive && (
                            <span className="ml-1 text-[10px] text-amber-700 font-sans">[Arsip]</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap bg-slate-50/50">
                          <SalesDocStatusBadge status={r.documentStatus} />
                        </td>
                        <td className="py-2.5 px-3 font-mono whitespace-nowrap text-slate-600 bg-slate-50/50">
                          {formatDateID(r.dueDate)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap bg-slate-50/50">
                          {formatIDR(r.netBillAmount)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap text-emerald-700 bg-slate-50/50">
                          {formatIDR(r.paidAmount)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap font-medium text-slate-900 bg-slate-50/50">
                          {formatIDR(r.outstandingAmount)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap text-teal-700 bg-slate-50/50">
                          {formatIDR(r.customerDepositBalance)}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap bg-slate-50/50">
                          <AccountingStatusBadge status={r.accountingStatus} />
                        </td>
                      </>
                    )}

                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onSelectDocument(r.salesDocumentId)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-teal-700 border border-teal-200 rounded hover:bg-teal-50"
                      >
                        <Eye className="w-3 h-3" />
                        Detail
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* Footer Membedakan Total Baris vs Total Dokumen + Pagination */}
        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5">
            <div>
              <span className="text-slate-500">Total Baris ({totals.lineCount} baris): </span>
              <span className="font-mono tabular-nums font-semibold text-slate-900">
                {formatIDR(totals.lineSalesTotal)}
              </span>
            </div>
            <div className="border-l border-slate-300 pl-4">
              <span className="text-slate-500">Total Tagihan Dokumen ({totals.docCount} nota unik): </span>
              <span className="font-mono tabular-nums font-semibold text-slate-900">
                {formatIDR(totals.docNetBill)}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Terbayar (s.d. {formatDateID(cutoffDate)}): </span>
              <span className="font-mono tabular-nums font-semibold text-emerald-700">
                {formatIDR(totals.docPaid)}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Sisa Piutang Dokumen: </span>
              <span className="font-mono tabular-nums font-semibold text-rose-700">
                {formatIDR(totals.docOutstanding)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-slate-500 font-mono">
              Hal {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-2.5 py-1 border border-slate-300 rounded bg-white disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-2.5 py-1 border border-slate-300 rounded bg-white disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
