import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import Decimal from 'decimal.js';
import { formatDateID } from '../lib/dates';
import { formatIDR, toDec } from '../lib/decimal';
import type { CustomerReceivableRow, SalesRecapRow } from '../types/app';
import { InfoTooltip, PaymentStatusBadge } from '../components/StatusBadges';

interface PiutangPelangganViewProps {
  asOfDate: string;
  onAsOfDateChange: (val: string) => void;
  receivables: CustomerReceivableRow[];
  recapRows: SalesRecapRow[];
  onSelectDocument: (salesDocumentId: string) => void;
}

export function PiutangPelangganView({
  asOfDate,
  onAsOfDateChange,
  receivables,
  recapRows,
  onSelectDocument,
}: PiutangPelangganViewProps) {
  const [expandedCustId, setExpandedCustId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return receivables.filter(
      (c) => !q || c.custId.toLowerCase().includes(q) || c.custName.toLowerCase().includes(q)
    );
  }, [receivables, search]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, r) => ({
        billed: acc.billed.plus(toDec(r.totalBilled)),
        paid: acc.paid.plus(toDec(r.totalPaid)),
        outstanding: acc.outstanding.plus(toDec(r.totalOutstanding)),
        titipan: acc.titipan.plus(toDec(r.titipanBalance)),
      }),
      {
        billed: new Decimal(0),
        paid: new Decimal(0),
        outstanding: new Decimal(0),
        titipan: new Decimal(0),
      }
    );
  }, [filtered]);

  const docsByCustomer = useMemo(() => {
    const map = new Map<string, SalesRecapRow[]>();
    const seen = new Set<string>();
    for (const r of recapRows) {
      if (r.isLegacyArchive || !['approved', 'released'].includes(r.documentStatus)) continue;
      if (seen.has(r.salesDocumentId)) continue;
      seen.add(r.salesDocumentId);
      const list = map.get(r.customerUuid) || [];
      list.push(r);
      map.set(r.customerUuid, list);
    }
    return map;
  }, [recapRows]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Piutang Pelanggan & Aging</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Saldo piutang per nota, umur jatuh tempo, dan saldo titipan pelanggan yang ditampilkan terpisah
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari CUST ID / nama pelanggan..."
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white w-56"
          />
          <div className="flex items-center gap-2 text-xs">
            <label className="text-slate-600 font-medium">Per Tanggal:</label>
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => onAsOfDateChange(e.target.value)}
              className="px-2.5 py-1.5 text-xs font-mono border border-teal-600/50 bg-teal-50/30 rounded-md"
            />
          </div>
        </div>
      </div>

      {/* Ringkasan AR vs Titipan Terpisah */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-md p-4">
          <div className="text-xs text-slate-500">Total Tagihan s.d. {formatDateID(asOfDate)}</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900">{formatIDR(totals.billed)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-md p-4">
          <div className="text-xs text-slate-500">Total Pembayaran Dialokasikan</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-emerald-700">{formatIDR(totals.paid)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-md p-4">
          <div className="text-xs text-slate-500">Total Sisa Piutang Usaha</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-rose-700">{formatIDR(totals.outstanding)}</div>
        </div>
        <div className="bg-white border border-teal-200 rounded-md p-4">
          <div className="text-xs text-teal-800 flex items-center">
            <span>Total Saldo Titipan Pelanggan</span>
            <InfoTooltip text="Dana terverifikasi milik pelanggan di App 1 yang belum dialokasikan ke nota atau kelebihan bayar. Disajikan terpisah dari Piutang Usaha (akun 2102)." />
          </div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-teal-700">{formatIDR(totals.titipan)}</div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-900 text-slate-100 text-[11px]">
              <tr>
                <th className="py-2.5 px-3 w-8"></th>
                <th className="py-2.5 px-3">CUST ID</th>
                <th className="py-2.5 px-3">NAMA PELANGGAN</th>
                <th className="py-2.5 px-3 text-right">TAGIHAN</th>
                <th className="py-2.5 px-3 text-right">TERBAYAR</th>
                <th className="py-2.5 px-3 text-right">SISA PIUTANG</th>
                <th className="py-2.5 px-3 text-right">0–30 HARI</th>
                <th className="py-2.5 px-3 text-right">31–60 HARI</th>
                <th className="py-2.5 px-3 text-right">61–90 HARI</th>
                <th className="py-2.5 px-3 text-right">&gt;90 HARI</th>
                <th className="py-2.5 px-3 text-right bg-teal-950">SALDO TITIPAN</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.map((c) => {
                const isOpen = expandedCustId === c.customerUuid;
                const custDocs = docsByCustomer.get(c.customerUuid) || [];
                return (
                  <React.Fragment key={c.customerUuid}>
                    <tr
                      onClick={() => setExpandedCustId(isOpen ? null : c.customerUuid)}
                      className="cursor-pointer hover:bg-slate-50"
                    >
                      <td className="py-2.5 px-3 text-slate-400">
                        {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-medium text-slate-800">{c.custId}</td>
                      <td className="py-2.5 px-3 font-medium text-slate-900">{c.custName}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatIDR(c.totalBilled)}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700">{formatIDR(c.totalPaid)}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {formatIDR(c.totalOutstanding)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatIDR(c.aging0To30)}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-amber-700">{formatIDR(c.aging31To60)}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-amber-800">{formatIDR(c.aging61To90)}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-rose-700">{formatIDR(c.agingOver90)}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-teal-700 bg-teal-50/40">
                        {formatIDR(c.titipanBalance)}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50/80">
                        <td colSpan={11} className="p-4">
                          <div className="text-xs font-semibold text-slate-800 mb-2">
                            Rincian Nota Pelanggan ({custDocs.length} dokumen)
                          </div>
                          {custDocs.length === 0 ? (
                            <div className="text-xs text-slate-500">Tidak ada nota aktif untuk pelanggan ini.</div>
                          ) : (
                            <div className="border border-slate-200 rounded bg-white overflow-x-auto">
                              <table className="w-full text-xs text-left">
                                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                                  <tr>
                                    <th className="py-1.5 px-3">No. Nota</th>
                                    <th className="py-1.5 px-3">Tgl Kirim</th>
                                    <th className="py-1.5 px-3">Jatuh Tempo</th>
                                    <th className="py-1.5 px-3">Status</th>
                                    <th className="py-1.5 px-3 text-right">Tagihan Neto</th>
                                    <th className="py-1.5 px-3 text-right">Terbayar</th>
                                    <th className="py-1.5 px-3 text-right">Sisa Piutang</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200">
                                  {custDocs.map((d) => (
                                    <tr key={d.salesDocumentId}>
                                      <td className="py-1.5 px-3">
                                        <button
                                          type="button"
                                          onClick={() => onSelectDocument(d.salesDocumentId)}
                                          className="font-mono font-medium text-teal-700 hover:underline"
                                        >
                                          {d.docNumber}
                                        </button>
                                      </td>
                                      <td className="py-1.5 px-3 font-mono">{formatDateID(d.deliveryDate)}</td>
                                      <td className="py-1.5 px-3 font-mono">{formatDateID(d.dueDate)}</td>
                                      <td className="py-1.5 px-3">
                                        <PaymentStatusBadge status={d.statusPembayaran} hasCashAtCollector={d.hasCashAtCollector} />
                                      </td>
                                      <td className="py-1.5 px-3 text-right font-mono tabular-nums">{formatIDR(d.netBillAmount)}</td>
                                      <td className="py-1.5 px-3 text-right font-mono tabular-nums text-emerald-700">{formatIDR(d.paidAmount)}</td>
                                      <td className="py-1.5 px-3 text-right font-mono tabular-nums font-semibold">{formatIDR(d.outstandingAmount)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
