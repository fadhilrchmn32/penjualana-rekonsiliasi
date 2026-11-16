import React from 'react';
import { ArrowRight, AlertTriangle, Clock, FileCheck2, Wallet } from 'lucide-react';
import { formatDateID, formatDateTimeJakarta } from '../lib/dates';
import { formatIDR } from '../lib/decimal';
import type {
  AccountingEventItem,
  AppRouteKey,
  DashboardSummary,
  DiscrepancyCaseItem,
} from '../types/app';
import { InfoTooltip } from '../components/StatusBadges';

interface RingkasanPenjualanViewProps {
  summary: DashboardSummary;
  discrepancies: DiscrepancyCaseItem[];
  accountingEvents: AccountingEventItem[];
  onNavigate: (route: AppRouteKey) => void;
  onOpenNewNota: () => void;
}

export function RingkasanPenjualanView({
  summary,
  discrepancies,
  accountingEvents,
  onNavigate,
  onOpenNewNota,
}: RingkasanPenjualanViewProps) {
  const kpis = [
    {
      label: 'Penjualan per Tanggal Kirim',
      tooltip: 'Total penjualan aktif yang telah disetujui/dirilis berdasarkan tanggal penyerahan barang (bukan tanggal terima uang). Arsip lama tidak dicampur ke KPI aktif.',
      value: formatIDR(summary.salesByDeliveryAmount),
      meta: `${summary.salesDocCount} nota dirilis`,
      actionLabel: 'Buka Rekap',
      route: 'rekap' as AppRouteKey,
      tone: 'text-slate-900',
    },
    {
      label: 'Tagihan / Piutang Terbuka',
      tooltip: 'Sisa piutang pelanggan setelah dikurangi nota kredit dan alokasi pembayaran terverifikasi yang telah disetujui.',
      value: formatIDR(summary.openReceivableAmount),
      meta: `${summary.openReceivableCount} nota terbuka`,
      actionLabel: 'Lihat Piutang',
      route: 'piutang' as AppRouteKey,
      tone: 'text-slate-900',
    },
    {
      label: 'Penerimaan Menunggu Verifikasi (App 1)',
      tooltip: 'Laporan transfer atau tunai dari App 1 yang belum diverifikasi keuangan. Belum boleh melunasi piutang nota.',
      value: formatIDR(summary.waitingVerificationReceiptAmount),
      meta: `${summary.waitingVerificationReceiptCount} dokumen di App 1`,
      actionLabel: 'Pantau di Pencocokan',
      route: 'pencocokan' as AppRouteKey,
      tone: 'text-amber-700',
    },
    {
      label: 'Penerimaan Terverifikasi Siap Dialokasi',
      tooltip: 'Dana terverifikasi dari App 1 (termasuk saldo titipan pelanggan) yang masih memiliki sisa tersedia untuk dicocokkan ke nota.',
      value: formatIDR(summary.availableVerifiedReceiptAmount),
      meta: `${summary.availableVerifiedReceiptCount} receipt tersedia`,
      actionLabel: 'Cocokkan Pembayaran',
      route: 'pencocokan' as AppRouteKey,
      tone: 'text-teal-700',
    },
  ];

  const queueCards = [
    {
      title: 'Dokumen Perlu Direview (Almira)',
      count: summary.needsReviewCount,
      desc: 'Nota yang belum diperiksa, menunggu tindak lanjut, atau memiliki selisih.',
      route: 'almira' as AppRouteKey,
      icon: FileCheck2,
      tone: summary.needsReviewCount > 0 ? 'text-amber-700' : 'text-emerald-700',
    },
    {
      title: 'Usulan Alokasi Menunggu Persetujuan',
      count: summary.pendingAllocationProposalCount,
      desc: 'Alokasi pembayaran yang baru diusulkan belum mengurangi AR sebelum disetujui reviewer berbeda.',
      route: 'pencocokan' as AppRouteKey,
      icon: Wallet,
      tone: summary.pendingAllocationProposalCount > 0 ? 'text-amber-700' : 'text-slate-700',
    },
    {
      title: 'Kasus Selisih & Hambatan Terbuka',
      count: summary.openDiscrepancyCount,
      desc: 'Selisih nilai impor, HPP belum tersedia, atau perselisihan pembayaran.',
      route: 'almira' as AppRouteKey,
      icon: AlertTriangle,
      tone: summary.openDiscrepancyCount > 0 ? 'text-rose-700' : 'text-emerald-700',
    },
    {
      title: 'Event Akuntansi Tertunda (Outbox App 3)',
      count: summary.pendingAccountingEventsCount,
      desc: 'Event revenue, HPP, dan alokasi yang menunggu/antre pada modul akuntansi App 3.',
      route: 'setup_uat' as AppRouteKey,
      icon: Clock,
      tone: 'text-slate-700',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Ringkasan Penjualan & Rekonsiliasi</h1>
          <p className="text-xs text-slate-500 mt-1">
            Pengakuan penjualan mengikuti tanggal penyerahan terkonfirmasi · Penerimaan dana berasal dari App 1 secara real-time
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('pencocokan')}
            className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
          >
            Cocokkan Pembayaran
          </button>
          <button
            type="button"
            onClick={onOpenNewNota}
            className="px-4 py-2 text-xs font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 whitespace-nowrap"
          >
            + Buat Nota Penjualan
          </button>
        </div>
      </div>

      {/* KPI Strip — Single-elevation flat cards with 1px hairline border */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white border border-slate-200 rounded-md p-4 flex flex-col justify-between">
            <div>
              <div className="text-xs font-medium text-slate-600 flex items-center">
                <span>{k.label}</span>
                <InfoTooltip text={k.tooltip} />
              </div>
              <div className={`mt-2 text-2xl font-semibold font-mono tabular-nums ${k.tone}`}>{k.value}</div>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-slate-500">{k.meta}</span>
              <button
                type="button"
                onClick={() => onNavigate(k.route)}
                className="inline-flex items-center gap-1 font-medium text-teal-700 hover:underline whitespace-nowrap"
              >
                {k.actionLabel}
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Antrian Operasional */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {queueCards.map((q) => {
          const Icon = q.icon;
          return (
            <button
              key={q.title}
              type="button"
              onClick={() => onNavigate(q.route)}
              className="text-left bg-white border border-slate-200 hover:border-teal-600/60 rounded-md p-4 transition-colors flex flex-col justify-between"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-semibold text-slate-800">{q.title}</span>
                <Icon className={`w-4 h-4 shrink-0 ${q.tone}`} />
              </div>
              <div className={`mt-2 text-2xl font-semibold font-mono tabular-nums ${q.tone}`}>{q.count}</div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{q.desc}</p>
            </button>
          );
        })}
      </div>

      {/* Dua Tabel Ringkas: Kasus Selisih & Outbox Event Akuntansi */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Kasus Selisih & Hambatan Terbaru</h2>
            <button
              type="button"
              onClick={() => onNavigate('almira')}
              className="text-xs font-medium text-teal-700 hover:underline"
            >
              Lihat Antrian Almira
            </button>
          </div>
          {discrepancies.length === 0 ? (
            <div className="p-6 text-xs text-slate-500 text-center">
              Tidak ada kasus selisih atau hambatan HPP terbuka saat ini.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2 px-3">No. Kasus</th>
                    <th className="py-2 px-3">Jenis</th>
                    <th className="py-2 px-3">Catatan</th>
                    <th className="py-2 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {discrepancies.slice(0, 6).map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="py-2 px-3 font-mono font-medium">{c.caseNumber}</td>
                      <td className="py-2 px-3 font-mono text-[11px]">{c.caseType}</td>
                      <td className="py-2 px-3 text-slate-700 max-w-xs truncate">{c.resolutionNote || '-'}</td>
                      <td className="py-2 px-3 text-rose-700 font-medium">{c.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Outbox Event ke App 3 (Akuntansi)</h2>
            <span className="text-[11px] text-slate-500">Idempoten · Terhubung Revenue & HPP</span>
          </div>
          {accountingEvents.length === 0 ? (
            <div className="p-6 text-xs text-slate-500 text-center">Belum ada event akuntansi tercatat.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2 px-3">Event Type</th>
                    <th className="py-2 px-3">Tgl Efektif</th>
                    <th className="py-2 px-3">Status</th>
                    <th className="py-2 px-3">Dibuat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {accountingEvents.slice(0, 6).map((ev) => (
                    <tr key={ev.id} className="hover:bg-slate-50">
                      <td className="py-2 px-3 font-mono text-[11px] text-slate-800">{ev.eventType}</td>
                      <td className="py-2 px-3 font-mono">{formatDateID(ev.effectiveDate)}</td>
                      <td className="py-2 px-3 text-amber-700 font-medium">
                        {ev.processingStatus === 'waiting_accounting_module'
                          ? 'Menunggu App 3'
                          : ev.processingStatus}
                      </td>
                      <td className="py-2 px-3 text-[11px] text-slate-500">{formatDateTimeJakarta(ev.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
