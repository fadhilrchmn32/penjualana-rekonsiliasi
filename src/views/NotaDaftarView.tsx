import React, { useMemo, useState } from 'react';
import { Eye, FilePlus2, Search } from 'lucide-react';
import { formatDateID } from '../lib/dates';
import { formatIDR } from '../lib/decimal';
import type { SalesRecapRow } from '../types/app';
import {
  AccountingStatusBadge,
  PaymentStatusBadge,
  ReconciliationBadge,
  SalesDocStatusBadge,
} from '../components/StatusBadges';

interface NotaDaftarViewProps {
  rows: SalesRecapRow[];
  onSelectDocument: (salesDocumentId: string) => void;
  onOpenNewNota: () => void;
}

export function NotaDaftarView({ rows, onSelectDocument, onOpenNewNota }: NotaDaftarViewProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [docTypeFilter, setDocTypeFilter] = useState('');

  const uniqueDocs = useMemo(() => {
    const map = new Map<string, { doc: SalesRecapRow; lineCount: number }>();
    for (const r of rows) {
      const existing = map.get(r.salesDocumentId);
      if (existing) {
        existing.lineCount += 1;
      } else {
        map.set(r.salesDocumentId, { doc: r, lineCount: 1 });
      }
    }
    const q = search.trim().toLowerCase();
    return Array.from(map.values())
      .filter(({ doc }) => {
        if (statusFilter && doc.documentStatus !== statusFilter) return false;
        if (docTypeFilter && doc.docType !== docTypeFilter) return false;
        if (q) {
          const hay = `${doc.docNumber} ${doc.sourceInvoiceNo || ''} ${doc.custId} ${doc.custName} ${doc.salesName}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => (b.doc.deliveryDate || b.doc.invoiceDate).localeCompare(a.doc.deliveryDate || a.doc.invoiceDate));
  }, [rows, search, statusFilter, docTypeFilter]);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-md p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nomor nota, CUST ID, pelanggan..."
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-slate-300 rounded-md px-2.5 py-1.5 text-xs bg-white"
          >
            <option value="">Semua Status Dokumen</option>
            <option value="draft">Draft</option>
            <option value="pending_delivery">Menunggu Kirim</option>
            <option value="submitted">Menunggu Persetujuan</option>
            <option value="approved">Disetujui</option>
            <option value="released">Dirilis</option>
          </select>
          <select
            value={docTypeFilter}
            onChange={(e) => setDocTypeFilter(e.target.value)}
            className="border border-slate-300 rounded-md px-2.5 py-1.5 text-xs bg-white"
          >
            <option value="">Semua Tipe Dokumen</option>
            <option value="sales_invoice">Faktur / Nota Penjualan</option>
            <option value="credit_note">Nota Kredit (Retur)</option>
          </select>
        </div>

        <button
          type="button"
          onClick={onOpenNewNota}
          className="inline-flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold px-3 py-2 rounded-md"
        >
          <FilePlus2 className="w-4 h-4" />
          Buat Nota Baru
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 uppercase text-slate-500">
              <tr>
                <th className="text-left px-3 py-2.5">Nomor Nota</th>
                <th className="text-left px-3 py-2.5">Tgl Kirim / Faktur</th>
                <th className="text-left px-3 py-2.5">Pelanggan</th>
                <th className="text-left px-3 py-2.5">Sales</th>
                <th className="text-right px-3 py-2.5">Baris</th>
                <th className="text-right px-3 py-2.5">Tagihan Neto</th>
                <th className="text-right px-3 py-2.5">Terbayar</th>
                <th className="text-right px-3 py-2.5">Sisa Piutang</th>
                <th className="text-left px-3 py-2.5">Status Nota</th>
                <th className="text-left px-3 py-2.5">Pembayaran</th>
                <th className="text-left px-3 py-2.5">Almira</th>
                <th className="text-left px-3 py-2.5">Jurnal</th>
                <th className="text-center px-3 py-2.5">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {uniqueDocs.map(({ doc, lineCount }) => (
                <tr key={doc.salesDocumentId} className="hover:bg-slate-50">
                  <td className="px-3 py-2.5">
                    <div className="font-mono font-semibold text-slate-900">{doc.docNumber}</div>
                    {doc.sourceInvoiceNo && (
                      <div className="font-mono text-[11px] text-slate-500">{doc.sourceInvoiceNo}</div>
                    )}
                    {doc.docType === 'credit_note' && (
                      <span className="inline-block mt-0.5 text-[10px] font-semibold uppercase px-1 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800">
                        Nota Kredit
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <div className="font-mono text-slate-900">
                      {doc.deliveryDate ? formatDateID(doc.deliveryDate) : 'Belum dikirim'}
                    </div>
                    <div className="font-mono text-[11px] text-slate-500">
                      Faktur: {formatDateID(doc.invoiceDate)}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-slate-900">{doc.custName}</div>
                    <div className="font-mono text-[11px] text-slate-500">{doc.custId}</div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-700">{doc.salesName}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                    {lineCount}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums font-semibold text-slate-900">
                    {formatIDR(doc.netBillAmount)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-emerald-700">
                    {formatIDR(doc.paidAmount)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums font-semibold text-slate-900">
                    {formatIDR(doc.outstandingAmount)}
                  </td>
                  <td className="px-3 py-2.5">
                    <SalesDocStatusBadge status={doc.documentStatus} />
                  </td>
                  <td className="px-3 py-2.5">
                    <PaymentStatusBadge
                      status={doc.statusPembayaran}
                      hasPendingVerification={doc.hasPendingVerification}
                      hasCashAtCollector={doc.hasCashAtCollector}
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <ReconciliationBadge status={doc.reconciliationStatus} />
                  </td>
                  <td className="px-3 py-2.5">
                    <AccountingStatusBadge status={doc.accountingStatus} />
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <button
                      type="button"
                      onClick={() => onSelectDocument(doc.salesDocumentId)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 font-medium"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Detail
                    </button>
                  </td>
                </tr>
              ))}
              {uniqueDocs.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-4 py-8 text-center text-slate-500">
                    Tidak ada dokumen penjualan ditemukan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
