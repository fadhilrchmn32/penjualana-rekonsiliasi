import React from 'react';
import { HelpCircle } from 'lucide-react';
import type {
  AccountingStatus,
  PaymentStatus,
  ReconciliationStatus,
  SalesDocumentStatus,
} from '../types/database.types';

export function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex items-center align-middle ml-1">
      <button
        type="button"
        aria-label="Penjelasan istilah"
        className="text-slate-400 hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 rounded"
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible group-hover:visible group-focus-within:visible opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 absolute z-40 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-64 rounded border border-slate-700 bg-slate-900 px-2.5 py-2 text-[11px] leading-relaxed font-normal text-slate-100 shadow-lg text-left normal-case"
      >
        {text}
      </span>
    </span>
  );
}

const badgeBase =
  'inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded border whitespace-nowrap shrink-0';

export function SalesDocStatusBadge({ status }: { status: SalesDocumentStatus }) {
  const map: Record<SalesDocumentStatus, { label: string; cls: string }> = {
    draft: { label: 'Draft', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
    pending_delivery: { label: 'Menunggu Kirim', cls: 'bg-amber-50 text-amber-800 border-amber-300' },
    submitted: { label: 'Diajukan', cls: 'bg-sky-50 text-sky-800 border-sky-300' },
    approved: { label: 'Disetujui', cls: 'bg-teal-50 text-teal-800 border-teal-300' },
    released: { label: 'Dirilis', cls: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
    corrected: { label: 'Dikoreksi', cls: 'bg-slate-100 text-slate-600 border-slate-300' },
    voided: { label: 'Dibatalkan', cls: 'bg-rose-50 text-rose-800 border-rose-300' },
  };
  const cfg = map[status] || map.draft;
  return <span className={`${badgeBase} ${cfg.cls}`}>{cfg.label}</span>;
}

export function PaymentStatusBadge({
  status,
  hasPendingVerification,
  hasCashAtCollector,
}: {
  status: PaymentStatus;
  hasPendingVerification?: boolean;
  hasCashAtCollector?: boolean;
}) {
  const map: Record<PaymentStatus, { label: string; cls: string }> = {
    unpaid: { label: 'Belum Dibayar', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
    partially_paid: { label: 'Dibayar Sebagian', cls: 'bg-amber-50 text-amber-800 border-amber-300' },
    paid: { label: 'Lunas', cls: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
    overpaid: { label: 'Lebih Bayar', cls: 'bg-sky-50 text-sky-800 border-sky-300' },
  };
  const cfg = map[status] || map.unpaid;
  return (
    <div className="inline-flex flex-col items-start gap-1">
      <span className={`${badgeBase} ${cfg.cls}`}>{cfg.label}</span>
      {hasPendingVerification && (
        <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded border bg-amber-50 text-amber-800 border-amber-300 whitespace-nowrap">
          Menunggu Verifikasi
        </span>
      )}
      {hasCashAtCollector && (
        <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded border bg-sky-50 text-sky-800 border-sky-300 whitespace-nowrap">
          Uang Masih di Penagih
        </span>
      )}
    </div>
  );
}

export function ReconciliationBadge({
  status,
  reviewerName,
}: {
  status: ReconciliationStatus;
  reviewerName?: string | null;
}) {
  const map: Record<ReconciliationStatus, { label: string; cls: string }> = {
    unreviewed: { label: 'Belum Diperiksa', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
    matched: { label: 'Cocok', cls: 'bg-teal-50 text-teal-800 border-teal-300' },
    needs_review: { label: 'Perlu Ditinjau', cls: 'bg-amber-50 text-amber-800 border-amber-300' },
    discrepancy: { label: 'Selisih', cls: 'bg-rose-50 text-rose-800 border-rose-300' },
    reviewed: { label: 'Selesai', cls: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
  };
  const cfg = map[status] || map.unreviewed;
  return (
    <div className="inline-flex flex-col items-start gap-0.5">
      <span className={`${badgeBase} ${cfg.cls}`}>{cfg.label}</span>
      {reviewerName && <span className="text-[11px] text-slate-500 whitespace-nowrap">{reviewerName}</span>}
    </div>
  );
}

export function AccountingStatusBadge({ status }: { status: AccountingStatus }) {
  const map: Record<AccountingStatus, { label: string; cls: string }> = {
    not_ready: { label: 'Belum Siap', cls: 'bg-slate-100 text-slate-600 border-slate-300' },
    queued: { label: 'Antre Akuntansi', cls: 'bg-amber-50 text-amber-800 border-amber-300' },
    draft_journal: { label: 'Draft Jurnal', cls: 'bg-sky-50 text-sky-800 border-sky-300' },
    posted: { label: 'Terposting', cls: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
    failed: { label: 'Gagal', cls: 'bg-rose-50 text-rose-800 border-rose-300' },
    reversed: { label: 'Dibalik', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
  };
  const cfg = map[status] || map.not_ready;
  return <span className={`${badgeBase} ${cfg.cls}`}>{cfg.label}</span>;
}
