import React, { useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, ShieldAlert } from 'lucide-react';
import { formatDateID, formatDateTimeJakarta } from '../lib/dates';
import { formatIDR } from '../lib/decimal';
import type {
  AppSettingsContext,
  AppUserSession,
  ReconciliationQueueItem,
} from '../types/app';
import type { ReconciliationReviewStage, ReconciliationStatus } from '../types/database.types';
import { PaymentStatusBadge, ReconciliationBadge } from '../components/StatusBadges';

interface RekonsiliasiAlmiraViewProps {
  session: AppUserSession;
  settings: AppSettingsContext;
  queue: ReconciliationQueueItem[];
  onSaveReview: (params: {
    branchId: string;
    salesDocumentId: string;
    reconciliationStatus: ReconciliationStatus;
    reviewStage: ReconciliationReviewStage;
    reasonCode: string | null;
    notes: string;
  }) => Promise<void>;
  onSelectDocument: (salesDocumentId: string) => void;
}

const TABS: Array<{ key: ReconciliationReviewStage; label: string }> = [
  { key: 'waiting_finance_verification', label: 'Menunggu Verifikasi Keuangan' },
  { key: 'ready_to_match', label: 'Siap Dicocokkan' },
  { key: 'allocation_pending_review', label: 'Alokasi Menunggu Review' },
  { key: 'matched', label: 'Cocok' },
  { key: 'discrepancy', label: 'Selisih' },
  { key: 'completed', label: 'Selesai' },
];

export function RekonsiliasiAlmiraView({
  session,
  settings,
  queue,
  onSaveReview,
  onSelectDocument,
}: RekonsiliasiAlmiraViewProps) {
  const [activeTab, setActiveTab] = useState<ReconciliationReviewStage>('ready_to_match');
  const [editingItem, setEditingItem] = useState<ReconciliationQueueItem | null>(null);
  const [nextStatus, setNextStatus] = useState<ReconciliationStatus>('matched');
  const [nextStage, setNextStage] = useState<ReconciliationReviewStage>('matched');
  const [reasonCode, setReasonCode] = useState('VERIFIED_EVIDENCE');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const canReview = session.roles.some((r) =>
    ['reconciliation_reviewer', 'finance_checker', 'accounting_approver'].includes(r)
  );

  const counts = useMemo(() => {
    const map: Record<ReconciliationReviewStage, number> = {
      waiting_finance_verification: 0,
      ready_to_match: 0,
      allocation_pending_review: 0,
      matched: 0,
      discrepancy: 0,
      completed: 0,
    };
    for (const q of queue) map[q.reviewStage] = (map[q.reviewStage] || 0) + 1;
    return map;
  }, [queue]);

  const tabItems = useMemo(() => queue.filter((q) => q.reviewStage === activeTab), [queue, activeTab]);

  const openReviewModal = (item: ReconciliationQueueItem) => {
    setEditingItem(item);
    setNextStatus(item.reconciliationStatus === 'unreviewed' ? 'matched' : item.reconciliationStatus);
    setNextStage(item.reviewStage === 'ready_to_match' ? 'matched' : item.reviewStage);
    setReasonCode(item.reasonCode || 'VERIFIED_EVIDENCE');
    setNotes(item.notes || '');
    setErrorMsg(null);
  };

  const handleSave = async () => {
    if (!editingItem) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      await onSaveReview({
        branchId: session.branchId,
        salesDocumentId: editingItem.salesDocumentId,
        reconciliationStatus: nextStatus,
        reviewStage: nextStage,
        reasonCode,
        notes,
      });
      setEditingItem(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyimpan review.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{settings.reconciliationLabel} & Tindak Lanjut</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            "Cocok" berarti bukti, identitas, nominal & alokasi telah diperiksa; penjualan kredit sah dapat selesai direkonsiliasi dengan piutang tetap terbuka.
          </p>
        </div>
        {settings.app1Url && (
          <a
            href={settings.app1Url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
          >
            Buka Kasus Setoran di App 1
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>

      {/* Tab Antrian */}
      <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 border border-slate-200 rounded-md">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap transition-colors ${
              activeTab === t.key ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label} ({counts[t.key]})
          </button>
        ))}
      </div>

      {/* Daftar Kartu Kasus */}
      {tabItems.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-md p-8 text-center text-xs text-slate-500">
          Tidak ada dokumen pada tahap ini.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tabItems.map((item) => (
            <div key={item.salesDocumentId} className="bg-white border border-slate-200 rounded-md p-4 flex flex-col justify-between space-y-3">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <button
                      type="button"
                      onClick={() => onSelectDocument(item.salesDocumentId)}
                      className="font-mono text-sm font-semibold text-teal-700 hover:underline"
                    >
                      {item.docNumber}
                    </button>
                    <div className="text-xs text-slate-700 mt-0.5">
                      [{item.custId}] {item.custName} · Kirim: {formatDateID(item.deliveryDate)}
                    </div>
                  </div>
                  <ReconciliationBadge status={item.reconciliationStatus} reviewerName={item.reconciledByName} />
                </div>

                <div className="grid grid-cols-3 gap-2 py-2 border-y border-slate-100 text-xs">
                  <div>
                    <div className="text-[11px] text-slate-500">Tagihan</div>
                    <div className="font-mono tabular-nums font-medium">{formatIDR(item.netBillAmount)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Terbayar</div>
                    <div className="font-mono tabular-nums text-emerald-700">{formatIDR(item.paidAmount)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Sisa Piutang</div>
                    <div className="font-mono tabular-nums font-semibold">{formatIDR(item.outstandingAmount)}</div>
                  </div>
                </div>

                <div className="text-xs space-y-1">
                  <div className="text-slate-700">
                    <span className="font-medium">Ringkasan: </span>
                    {item.problemSummary}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Penindak lanjut: <span className="font-medium text-slate-700">{item.actionOwnerHint}</span>
                    {item.reconciledAt && ` · Terakhir ditinjau ${formatDateTimeJakarta(item.reconciledAt)}`}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <PaymentStatusBadge
                  status={item.derivedPaymentStatus}
                  hasPendingVerification={item.hasPendingVerification}
                  hasCashAtCollector={item.hasCashAtCollector}
                />
                {canReview ? (
                  <button
                    type="button"
                    onClick={() => openReviewModal(item)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded hover:bg-slate-800"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Catat Keputusan Review
                  </button>
                ) : (
                  <span className="text-[11px] text-slate-400">Hanya Reviewer Berizin</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Keputusan Review */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white border border-slate-200 rounded-lg shadow-xl w-full max-w-lg p-5 space-y-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Keputusan Review — <span className="font-mono">{editingItem.docNumber}</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {editingItem.custName} · Sisa piutang saat ini: {formatIDR(editingItem.outstandingAmount)}
              </p>
            </div>

            {errorMsg && (
              <div className="p-2.5 rounded bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Status Rekonsiliasi</label>
                <select
                  value={nextStatus}
                  onChange={(e) => setNextStatus(e.target.value as ReconciliationStatus)}
                  className="w-full rounded border border-slate-300 px-2.5 py-2 bg-white"
                >
                  <option value="matched">Cocok (Bukti & Alokasi/Kredit Valid)</option>
                  <option value="needs_review">Perlu Ditinjau</option>
                  <option value="discrepancy">Selisih</option>
                  <option value="reviewed">Selesai</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Tahap Antrian</label>
                <select
                  value={nextStage}
                  onChange={(e) => setNextStage(e.target.value as ReconciliationReviewStage)}
                  className="w-full rounded border border-slate-300 px-2.5 py-2 bg-white"
                >
                  {TABS.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="text-xs">
              <label className="block font-medium text-slate-700 mb-1">Kode Alasan Terstruktur</label>
              <select
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                className="w-full rounded border border-slate-300 px-2.5 py-2 bg-white"
              >
                <option value="VERIFIED_EVIDENCE">Bukti Pengiriman & Pembayaran Sesuai</option>
                <option value="VALID_CREDIT_TERM">Penjualan Kredit Sah (Piutang Tetap Terbuka)</option>
                <option value="PAYMENT_DISPUTE">Perselisihan Nominal Pembayaran</option>
                <option value="POST_SALE_DISCOUNT">Usulan Diskon / Potongan Setelah Penjualan</option>
                <option value="WRONG_ACCOUNT">Transfer Salah Rekening Perusahaan</option>
                <option value="PRICE_MISMATCH">Selisih Harga Impor vs Master</option>
              </select>
            </div>

            <div className="text-xs">
              <label className="block font-medium text-slate-700 mb-1">Catatan Reviewer</label>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Jelaskan hasil pemeriksaan atau instruksi tindak lanjut..."
                className="w-full rounded border border-slate-300 px-3 py-2"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="px-3.5 py-2 text-xs border border-slate-300 rounded-md"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleSave}
                className="px-4 py-2 text-xs font-medium bg-teal-700 text-white rounded-md hover:bg-teal-800 disabled:opacity-50"
              >
                {busy ? 'Menyimpan...' : 'Simpan Keputusan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
