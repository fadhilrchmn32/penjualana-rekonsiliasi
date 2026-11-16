import React, { useEffect, useState } from 'react';
import { CheckCircle2, FileText, MessageSquarePlus, ShieldAlert, X } from 'lucide-react';
import { formatDateID, formatDateTimeJakarta, todayISOJakarta } from '../lib/dates';
import { formatIDR, formatQty } from '../lib/decimal';
import type { AppUserSession, SalesDocumentDetail, SalesLineInput } from '../types/app';
import {
  AccountingStatusBadge,
  PaymentStatusBadge,
  ReconciliationBadge,
  SalesDocStatusBadge,
} from './StatusBadges';

interface NotaDetailDrawerProps {
  salesDocumentId: string | null;
  onClose: () => void;
  session: AppUserSession;
  loadDetail: (id: string) => Promise<SalesDocumentDetail>;
  onSubmitSale: (id: string, version: number) => Promise<void>;
  onApproveAndRelease: (id: string, version: number, deliveryDate: string, note: string) => Promise<void>;
  onIssueCreditNote: (origId: string, issueDate: string, reason: string, lines: SalesLineInput[]) => Promise<void>;
  onAppendNote: (id: string, note: string) => Promise<void>;
}

export function NotaDetailDrawer({
  salesDocumentId,
  onClose,
  session,
  loadDetail,
  onSubmitSale,
  onApproveAndRelease,
  onIssueCreditNote,
  onAppendNote,
}: NotaDetailDrawerProps) {
  const [detail, setDetail] = useState<SalesDocumentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [confirmDeliveryDate, setConfirmDeliveryDate] = useState('');
  const [approvalNote, setApprovalNote] = useState('');
  const [newNoteText, setNewNoteText] = useState('');
  const [showCreditForm, setShowCreditForm] = useState(false);
  const [cnReason, setCnReason] = useState('');
  const [cnQty, setCnQty] = useState<Record<string, string>>({});

  const refresh = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const d = await loadDetail(id);
      setDetail(d);
      setConfirmDeliveryDate(d.deliveryDate || todayISOJakarta());
      const initQ: Record<string, string> = {};
      d.lines.forEach((l) => {
        initQ[l.id] = '0';
      });
      setCnQty(initQ);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat detail dokumen.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (salesDocumentId) {
      setActionError(null);
      setShowCreditForm(false);
      refresh(salesDocumentId);
    } else {
      setDetail(null);
    }
  }, [salesDocumentId]);

  if (!salesDocumentId) return null;

  const canSubmit =
    detail &&
    ['draft', 'pending_delivery'].includes(detail.status) &&
    session.roles.some((r) => ['sales_admin', 'reconciliation_reviewer'].includes(r));

  const canApprove =
    detail &&
    detail.status === 'submitted' &&
    session.roles.some((r) => ['reconciliation_reviewer', 'accounting_approver'].includes(r));

  const isMakerViolation =
    detail && (detail.createdBy === session.userId || detail.submittedBy === session.userId);

  const canCreditNote =
    detail &&
    detail.docType === 'sales_invoice' &&
    ['approved', 'released'].includes(detail.status) &&
    !detail.isLegacyArchive &&
    session.roles.some((r) => ['reconciliation_reviewer', 'accounting_approver'].includes(r));

  const runAction = async (fn: () => Promise<void>) => {
    if (!detail) return;
    setActionError(null);
    setBusy(true);
    try {
      await fn();
      await refresh(detail.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Operasi gagal dijalankan.');
    } finally {
      setBusy(false);
    }
  };

  const handleIssueCredit = () => {
    if (!detail) return;
    const selectedLines: SalesLineInput[] = detail.lines
      .filter((l) => Number(cnQty[l.id] || 0) > 0)
      .map((l) => ({
        productId: l.productId,
        unitCode: l.unitCode,
        quantity: cnQty[l.id],
        netUnitPrice: l.netUnitPrice,
      }));
    if (!selectedLines.length) {
      setActionError('Masukkan kuantitas retur/koreksi > 0 pada minimal 1 baris produk.');
      return;
    }
    runAction(async () => {
      await onIssueCreditNote(detail.id, todayISOJakarta(), cnReason, selectedLines);
      setShowCreditForm(false);
      setCnReason('');
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40">
      <div className="bg-white w-full max-w-3xl h-full shadow-2xl border-l border-slate-200 flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-teal-700" />
            <div>
              <h2 className="text-base font-semibold text-slate-900 font-mono">
                {detail ? detail.docNumber : 'Memuat Nota...'}
              </h2>
              {detail && (
                <p className="text-xs text-slate-500">
                  {detail.custId} · {detail.custName} · Sales: {detail.salesName}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-500 hover:text-slate-800 rounded-md"
            aria-label="Tutup detail nota"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading && <div className="text-sm text-slate-500 py-8 text-center">Memuat rincian nota dari server...</div>}
          {error && (
            <div className="p-4 rounded-md bg-rose-50 border border-rose-200 text-sm text-rose-800 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {detail && !loading && (
            <>
              {actionError && (
                <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-xs text-rose-800">
                  {actionError}
                </div>
              )}

              {/* Ringkasan Dimensi Status Terpisah */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border border-slate-200 rounded-md p-4 bg-slate-50/70">
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">Status Dokumen</div>
                  <SalesDocStatusBadge status={detail.status} />
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">Status Pembayaran</div>
                  <PaymentStatusBadge
                    status={detail.derivedPaymentStatus}
                    hasPendingVerification={detail.hasPendingVerification}
                    hasCashAtCollector={detail.hasCashAtCollector}
                  />
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">Rekonsiliasi (Almira)</div>
                  <ReconciliationBadge
                    status={detail.reconciliationStatus}
                    reviewerName={detail.reconciledByName}
                  />
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">Status Pembukuan</div>
                  <AccountingStatusBadge status={detail.accountingStatus} />
                </div>
              </div>

              {/* Informasi Tanggal & Ringkasan Nominal Dokumen */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="border border-slate-200 rounded-md p-4 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Tanggal Kirim (Periode Sales)</span>
                    <span className="font-mono font-medium text-slate-900">{formatDateID(detail.deliveryDate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Tanggal Invoice</span>
                    <span className="font-mono text-slate-800">{formatDateID(detail.invoiceDate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Jatuh Tempo</span>
                    <span className="font-mono text-slate-800">{formatDateID(detail.dueDate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Ref. Eksternal / Basis Pajak</span>
                    <span className="font-mono text-slate-800">
                      {detail.sourceInvoiceNo || '-'} · {detail.taxBasis}
                    </span>
                  </div>
                </div>

                <div className="border border-slate-200 rounded-md p-4 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Total Nota Awal</span>
                    <span className="font-mono tabular-nums text-slate-900">{formatIDR(detail.totalAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Potongan Nota Kredit</span>
                    <span className="font-mono tabular-nums text-rose-700">-{formatIDR(detail.creditNoteAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Alokasi Terverifikasi Disetujui</span>
                    <span className="font-mono tabular-nums text-emerald-700">{formatIDR(detail.paidAmount)}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-slate-200 font-semibold text-sm">
                    <span className="text-slate-900">Sisa Piutang Dokumen</span>
                    <span className="font-mono tabular-nums text-slate-900">{formatIDR(detail.outstandingAmount)}</span>
                  </div>
                </div>
              </div>

              {/* Aksi Alur Kerja Penjualan */}
              {(canSubmit || canApprove || canCreditNote) && (
                <div className="border border-slate-200 rounded-md p-4 bg-white space-y-3">
                  <h3 className="text-xs font-semibold text-slate-800">Tindakan Dokumen</h3>

                  {canSubmit && (
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-slate-600">
                        Ajukan nota untuk pemeriksaan dan konfirmasi penyerahan barang oleh reviewer.
                      </p>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => runAction(() => onSubmitSale(detail.id, detail.version))}
                        className="px-4 py-2 text-xs font-medium bg-teal-700 text-white rounded-md hover:bg-teal-800 shrink-0"
                      >
                        Ajukan Persetujuan
                      </button>
                    </div>
                  )}

                  {canApprove && (
                    <div className="space-y-3">
                      {isMakerViolation ? (
                        <div className="p-2.5 rounded bg-amber-50 border border-amber-200 text-xs text-amber-800">
                          Pemisahan tugas (maker-checker): Anda adalah pembuat/pengaju nota ini sehingga tidak dapat menyetujuinya sendiri. Gunakan akun reviewer lain.
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Konfirmasi Tanggal Kirim
                            </label>
                            <input
                              type="date"
                              value={confirmDeliveryDate}
                              onChange={(e) => setConfirmDeliveryDate(e.target.value)}
                              className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">Catatan Persetujuan</label>
                            <input
                              type="text"
                              value={approvalNote}
                              onChange={(e) => setApprovalNote(e.target.value)}
                              placeholder="Surat jalan sesuai"
                              className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                            />
                          </div>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              runAction(() =>
                                onApproveAndRelease(detail.id, detail.version, confirmDeliveryDate, approvalNote)
                              )
                            }
                            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium bg-emerald-700 text-white rounded-md hover:bg-emerald-800"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Setujui & Rilis (Cek HPP)
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {canCreditNote && (
                    <div className="pt-2 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => setShowCreditForm((v) => !v)}
                        className="text-xs font-medium text-teal-700 hover:underline"
                      >
                        {showCreditForm ? 'Tutup Form Nota Kredit' : '+ Terbitkan Nota Kredit / Retur (Tanpa Ubah Nota Asal)'}
                      </button>

                      {showCreditForm && (
                        <div className="mt-3 p-3 rounded border border-slate-200 bg-slate-50 space-y-3">
                          <p className="text-[11px] text-slate-600">
                            Dokumen yang sudah disetujui tidak diedit in-place. Pilih kuantitas retur/potongan per produk untuk menerbitkan dokumen Nota Kredit baru yang tertaut.
                          </p>
                          <div className="space-y-1.5">
                            {detail.lines.map((l) => (
                              <div key={l.id} className="flex items-center justify-between gap-3 text-xs">
                                <span className="text-slate-700 truncate">
                                  [{l.sku}] {l.productName} (maks: {formatQty(l.quantity)} {l.unitCode} @ {formatIDR(l.netUnitPrice)})
                                </span>
                                <input
                                  type="number"
                                  min="0"
                                  max={l.quantity}
                                  step="any"
                                  value={cnQty[l.id] || '0'}
                                  onChange={(e) => setCnQty((prev) => ({ ...prev, [l.id]: e.target.value }))}
                                  className="w-24 rounded border border-slate-300 px-2 py-1 text-right font-mono tabular-nums bg-white"
                                />
                              </div>
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={cnReason}
                              onChange={(e) => setCnReason(e.target.value)}
                              placeholder="Alasan nota kredit / retur (min. 5 karakter)..."
                              className="flex-1 rounded border border-slate-300 px-2.5 py-1.5 text-xs bg-white"
                            />
                            <button
                              type="button"
                              disabled={busy}
                              onClick={handleIssueCredit}
                              className="px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded hover:bg-slate-800 shrink-0"
                            >
                              Terbitkan Nota Kredit
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Daftar Baris Produk */}
              <div>
                <h3 className="text-sm font-semibold text-slate-900 mb-2">Rincian Baris Produk ({detail.lines.length})</h3>
                <div className="border border-slate-200 rounded-md overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="py-2 px-3">#</th>
                        <th className="py-2 px-3">Produk / SKU</th>
                        <th className="py-2 px-3 text-right">QTY</th>
                        <th className="py-2 px-3">Satuan</th>
                        <th className="py-2 px-3 text-right">Net Price</th>
                        <th className="py-2 px-3 text-right">Total Sales</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {detail.lines.map((l) => (
                        <tr key={l.id}>
                          <td className="py-2 px-3 font-mono text-slate-500">{l.lineNo}</td>
                          <td className="py-2 px-3">
                            <div className="font-medium text-slate-900">{l.productName}</div>
                            <div className="text-[11px] font-mono text-slate-500">{l.sku}</div>
                            {l.hasPriceDiscrepancy && (
                              <div className="text-[11px] text-rose-700 mt-0.5">
                                Selisih nilai sumber ({formatIDR(l.rawSourceTotal)}) vs formula
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums">{formatQty(l.quantity)}</td>
                          <td className="py-2 px-3 font-mono">{l.unitCode}</td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums">{formatIDR(l.netUnitPrice)}</td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums font-medium text-slate-900">
                            {formatIDR(l.lineTotal)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Alokasi Pembayaran Terhubung */}
              <div>
                <h3 className="text-sm font-semibold text-slate-900 mb-2">
                  Histori Alokasi Pembayaran ({detail.allocations.length})
                </h3>
                {detail.allocations.length === 0 ? (
                  <p className="text-xs text-slate-500 border border-dashed border-slate-200 rounded-md p-3">
                    Belum ada penerimaan App 1 yang dialokasikan ke nota ini.
                  </p>
                ) : (
                  <div className="border border-slate-200 rounded-md overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                          <th className="py-2 px-3">No. Receipt App 1</th>
                          <th className="py-2 px-3">Kanal</th>
                          <th className="py-2 px-3">Tgl Bayar</th>
                          <th className="py-2 px-3 text-right">Nominal Alokasi</th>
                          <th className="py-2 px-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {detail.allocations.map((a) => (
                          <tr key={a.id}>
                            <td className="py-2 px-3 font-mono font-medium">{a.receiptNumber}</td>
                            <td className="py-2 px-3">{a.receiptChannel === 'cash' ? 'Tunai' : 'Transfer'}</td>
                            <td className="py-2 px-3 font-mono">{formatDateID(a.customerPaidAt)}</td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums">{formatIDR(a.allocatedAmount)}</td>
                            <td className="py-2 px-3">{a.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Catatan Append-Only */}
              <div>
                <h3 className="text-sm font-semibold text-slate-900 mb-2">Catatan Operasional (Append-Only)</h3>
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={newNoteText}
                    onChange={(e) => setNewNoteText(e.target.value)}
                    placeholder="Tambah catatan koreksi non-finansial..."
                    className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs"
                  />
                  <button
                    type="button"
                    disabled={busy || !newNoteText.trim()}
                    onClick={() =>
                      runAction(async () => {
                        await onAppendNote(detail.id, newNoteText);
                        setNewNoteText('');
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 text-white rounded-md hover:bg-slate-900 disabled:opacity-50"
                  >
                    <MessageSquarePlus className="w-3.5 h-3.5" />
                    Tambah Catatan
                  </button>
                </div>
                {detail.appendNotes.length > 0 && (
                  <ul className="space-y-1.5">
                    {detail.appendNotes.map((n) => (
                      <li key={n.id} className="text-xs border border-slate-200 rounded p-2.5 bg-slate-50">
                        <div className="text-slate-800">{n.noteText}</div>
                        <div className="text-[11px] text-slate-500 mt-1">
                          {n.createdByName} · {formatDateTimeJakarta(n.createdAt)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Jejak Audit */}
              {detail.auditTrail.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 mb-2">Jejak Audit Dokumen</h3>
                  <div className="space-y-1.5">
                    {detail.auditTrail.map((aud) => (
                      <div key={aud.id} className="text-xs flex items-center justify-between py-1.5 border-b border-slate-100">
                        <div>
                          <span className="font-mono text-slate-700">{aud.eventAction}</span>
                          <span className="text-slate-400 mx-1.5">·</span>
                          <span className="text-slate-600">{aud.reason || '-'}</span>
                        </div>
                        <span className="text-[11px] text-slate-500 shrink-0">
                          {aud.actorName} · {formatDateTimeJakarta(aud.createdAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
