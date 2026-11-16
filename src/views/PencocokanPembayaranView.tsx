import React, { useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, RotateCcw, ShieldAlert } from 'lucide-react';
import Decimal from 'decimal.js';
import { formatDateID, formatDateTimeJakarta } from '../lib/dates';
import { formatIDR, toDec } from '../lib/decimal';
import type {
  AllocatableReceipt,
  AppUserSession,
  MasterCustomer,
  PaymentAllocationItem,
  SalesRecapRow,
} from '../types/app';
import { InfoTooltip, PaymentStatusBadge } from '../components/StatusBadges';

interface PencocokanPembayaranViewProps {
  session: AppUserSession;
  customers: MasterCustomer[];
  receipts: AllocatableReceipt[];
  recapRows: SalesRecapRow[];
  allocations: PaymentAllocationItem[];
  onProposeAllocation: (
    branchId: string,
    items: Array<{ receiptId: string; salesDocumentId: string; allocatedAmount: string; notes?: string }>
  ) => Promise<void>;
  onApproveAllocation: (allocationIds: string[], notes?: string) => Promise<void>;
  onReverseAllocation: (allocationId: string, expectedVersion: number, reason: string) => Promise<void>;
  onSelectDocument: (salesDocumentId: string) => void;
}

export function PencocokanPembayaranView({
  session,
  customers,
  receipts,
  recapRows,
  allocations,
  onProposeAllocation,
  onApproveAllocation,
  onReverseAllocation,
  onSelectDocument,
}: PencocokanPembayaranViewProps) {
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [selectedReceiptIds, setSelectedReceiptIds] = useState<string[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [matrix, setMatrix] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [reverseTarget, setReverseTarget] = useState<PaymentAllocationItem | null>(null);
  const [reverseReason, setReverseReason] = useState('');

  // Unique open/released sales documents from recapRows
  const openDocs = useMemo(() => {
    const map = new Map<string, SalesRecapRow>();
    for (const r of recapRows) {
      if (
        ['approved', 'released'].includes(r.documentStatus) &&
        !r.isLegacyArchive &&
        toDec(r.outstandingAmount).gt(0)
      ) {
        if (!map.has(r.salesDocumentId)) map.set(r.salesDocumentId, r);
      }
    }
    return Array.from(map.values()).filter((d) => !selectedCustomerId || d.customerUuid === selectedCustomerId);
  }, [recapRows, selectedCustomerId]);

  const filteredReceipts = useMemo(() => {
    return receipts.filter((r) => !selectedCustomerId || r.customerId === selectedCustomerId);
  }, [receipts, selectedCustomerId]);

  const selectedReceipts = filteredReceipts.filter((r) => selectedReceiptIds.includes(r.receiptId));
  const selectedDocs = openDocs.filter((d) => selectedDocIds.includes(d.salesDocumentId));

  const matrixValidation = useMemo(() => {
    const rowSums: Record<string, Decimal> = {};
    const colSums: Record<string, Decimal> = {};
    const items: Array<{ receiptId: string; salesDocumentId: string; allocatedAmount: string }> = [];
    let valid = true;
    const errors: string[] = [];

    for (const r of selectedReceipts) {
      let rSum = new Decimal(0);
      for (const d of selectedDocs) {
        const key = `${r.receiptId}::${d.salesDocumentId}`;
        const raw = matrix[key] || '';
        const val = toDec(raw);
        if (val.lt(0)) {
          valid = false;
          errors.push('Nominal alokasi tidak boleh negatif.');
        }
        if (val.gt(0)) {
          if (r.customerId !== d.customerUuid) {
            valid = false;
            errors.push(`Pelanggan ${r.receiptNumber} berbeda dengan nota ${d.docNumber}.`);
          }
          rSum = rSum.plus(val);
          colSums[d.salesDocumentId] = (colSums[d.salesDocumentId] || new Decimal(0)).plus(val);
          items.push({ receiptId: r.receiptId, salesDocumentId: d.salesDocumentId, allocatedAmount: val.toFixed(2) });
        }
      }
      rowSums[r.receiptId] = rSum;
      const netAvail = toDec(r.availableToAllocate).minus(toDec(r.pendingProposedAmount));
      if (rSum.gt(netAvail)) {
        valid = false;
        errors.push(`${r.receiptNumber} melebihi sisa saldo tersedia (${formatIDR(netAvail)}).`);
      }
    }

    for (const d of selectedDocs) {
      const cSum = colSums[d.salesDocumentId] || new Decimal(0);
      const netOut = toDec(d.outstandingAmount).minus(toDec(d.pendingAllocationAmount));
      if (cSum.gt(netOut)) {
        valid = false;
        errors.push(`Alokasi ke ${d.docNumber} melebihi sisa piutang (${formatIDR(netOut)}).`);
      }
    }

    if (items.length === 0) valid = false;
    return { rowSums, colSums, items, valid, errors };
  }, [selectedReceipts, selectedDocs, matrix]);

  const toggleReceipt = (r: AllocatableReceipt) => {
    if (r.status !== 'verified' || r.isUnknownIdentity || !r.customerId) return;
    if (!selectedCustomerId && r.customerId) setSelectedCustomerId(r.customerId);
    setSelectedReceiptIds((prev) =>
      prev.includes(r.receiptId) ? prev.filter((id) => id !== r.receiptId) : [...prev, r.receiptId]
    );
  };

  const toggleDoc = (d: SalesRecapRow) => {
    if (!selectedCustomerId) setSelectedCustomerId(d.customerUuid);
    setSelectedDocIds((prev) =>
      prev.includes(d.salesDocumentId) ? prev.filter((id) => id !== d.salesDocumentId) : [...prev, d.salesDocumentId]
    );
  };

  const handlePropose = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    if (!matrixValidation.valid) {
      setErrorMsg(matrixValidation.errors[0] || 'Lengkapi matriks alokasi dengan nilai valid.');
      return;
    }
    const branchId = selectedDocs[0]?.branchId || session.branchId;
    setBusy(true);
    try {
      await onProposeAllocation(
        branchId,
        matrixValidation.items.map((it) => ({ ...it, notes: notes.trim() || undefined }))
      );
      setMatrix({});
      setSelectedReceiptIds([]);
      setSelectedDocIds([]);
      setNotes('');
      setSuccessMsg('Usulan alokasi pembayaran berhasil dikirim. Menunggu persetujuan reviewer berbeda sebelum mengurangi piutang.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengusulkan alokasi.');
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async (ids: string[]) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setBusy(true);
    try {
      await onApproveAllocation(ids);
      setSuccessMsg('Alokasi pembayaran disetujui. Saldo piutang nota dan event akuntansi telah diperbarui.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyetujui alokasi.');
    } finally {
      setBusy(false);
    }
  };

  const handleReverse = async () => {
    if (!reverseTarget) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      await onReverseAllocation(reverseTarget.id, reverseTarget.version, reverseReason);
      setReverseTarget(null);
      setReverseReason('');
      setSuccessMsg('Alokasi pembayaran berhasil dilepas dengan jejak reversal.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal melepas alokasi.');
    } finally {
      setBusy(false);
    }
  };

  const proposedList = allocations.filter((a) => a.status === 'proposed');
  const approvedList = allocations.filter((a) => a.status === 'approved');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Pencocokan Pembayaran (Many-to-Many)</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Penerimaan terverifikasi dari App 1 di kiri · Nota terbuka pelanggan yang sama di kanan · Usulan tidak mengurangi piutang sebelum disetujui reviewer berbeda
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedCustomerId}
            onChange={(e) => {
              setSelectedCustomerId(e.target.value);
              setSelectedReceiptIds([]);
              setSelectedDocIds([]);
              setMatrix({});
            }}
            className="px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
          >
            <option value="">-- Filter Pelanggan (Semua) --</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                [{c.custId}] {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
      {successMsg && (
        <div className="p-3 rounded-md bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Split Pane App 1 Receipts (Left) & Customer Invoices (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Penerimaan App 1 */}
        <div className="bg-white border border-slate-200 rounded-md overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              Penerimaan dari App 1
              <InfoTooltip text="Data langsung dari v_app2_allocatable_receipts. Penerimaan tanpa identitas atau menunggu verifikasi keuangan tidak dapat dialokasikan." />
            </h2>
            <span className="text-[11px] text-slate-500">{filteredReceipts.length} dokumen</span>
          </div>
          <div className="overflow-x-auto max-h-80 thin-scrollbar">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 sticky top-0">
                <tr>
                  <th className="py-2 px-3 w-8">Pilih</th>
                  <th className="py-2 px-3">No. Receipt / Tgl</th>
                  <th className="py-2 px-3">Pelanggan</th>
                  <th className="py-2 px-3">Kanal / Custody</th>
                  <th className="py-2 px-3 text-right">Saldo Tersedia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredReceipts.map((r) => {
                  const canPick =
                    r.status === 'verified' &&
                    !r.isUnknownIdentity &&
                    Boolean(r.customerId) &&
                    toDec(r.availableToAllocate).minus(toDec(r.pendingProposedAmount)).gt(0);
                  const checked = selectedReceiptIds.includes(r.receiptId);
                  return (
                    <tr
                      key={r.receiptId}
                      onClick={() => canPick && toggleReceipt(r)}
                      className={`${canPick ? 'cursor-pointer hover:bg-teal-50/40' : 'opacity-65 bg-slate-50/50'} ${
                        checked ? 'bg-teal-50' : ''
                      }`}
                    >
                      <td className="py-2 px-3">
                        <input
                          type="checkbox"
                          disabled={!canPick}
                          checked={checked}
                          onChange={() => toggleReceipt(r)}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded border-slate-300 text-teal-700"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <div className="font-mono font-medium text-slate-900">{r.receiptNumber}</div>
                        <div className="text-[11px] font-mono text-slate-500">{formatDateID(r.customerPaidAt)}</div>
                      </td>
                      <td className="py-2 px-3">
                        {r.isUnknownIdentity ? (
                          <span className="text-rose-700 font-medium">
                            Belum Teridentifikasi ({r.senderNameRaw || '-'})
                          </span>
                        ) : (
                          <div>
                            <div className="font-medium text-slate-900">{r.customerName}</div>
                            <div className="text-[11px] font-mono text-slate-500">{r.custId}</div>
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <div className="text-slate-800">{r.receiptChannel === 'cash' ? 'Tunai' : 'Transfer'}</div>
                        <div className="text-[10px] text-slate-500">
                          {r.status === 'waiting_verification'
                            ? 'Menunggu Verifikasi App 1'
                            : r.receiptChannel === 'cash' && r.depositStatus !== 'deposited'
                              ? `Di Penagih (${r.collectorName || 'Tunai'})`
                              : 'Terverifikasi'}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">
                        <div className="font-semibold text-slate-900">{formatIDR(r.availableToAllocate)}</div>
                        {toDec(r.pendingProposedAmount).gt(0) && (
                          <div className="text-[10px] text-amber-700">Usulan: -{formatIDR(r.pendingProposedAmount)}</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Nota Pelanggan */}
        <div className="bg-white border border-slate-200 rounded-md overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Nota Pelanggan Terbuka (Dirilis)</h2>
            <span className="text-[11px] text-slate-500">{openDocs.length} nota</span>
          </div>
          <div className="overflow-x-auto max-h-80 thin-scrollbar">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 sticky top-0">
                <tr>
                  <th className="py-2 px-3 w-8">Pilih</th>
                  <th className="py-2 px-3">No. Nota / Tgl Kirim</th>
                  <th className="py-2 px-3">Pelanggan</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3 text-right">Sisa Piutang</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {openDocs.map((d) => {
                  const checked = selectedDocIds.includes(d.salesDocumentId);
                  return (
                    <tr
                      key={d.salesDocumentId}
                      onClick={() => toggleDoc(d)}
                      className={`cursor-pointer hover:bg-teal-50/40 ${checked ? 'bg-teal-50' : ''}`}
                    >
                      <td className="py-2 px-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleDoc(d)}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded border-slate-300 text-teal-700"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectDocument(d.salesDocumentId);
                          }}
                          className="font-mono font-medium text-teal-700 hover:underline"
                        >
                          {d.docNumber}
                        </button>
                        <div className="text-[11px] font-mono text-slate-500">
                          Kirim: {formatDateID(d.deliveryDate)} · JT: {formatDateID(d.dueDate)}
                        </div>
                      </td>
                      <td className="py-2 px-3">
                        <div className="font-medium text-slate-900">{d.custName}</div>
                        <div className="text-[11px] font-mono text-slate-500">{d.custId}</div>
                      </td>
                      <td className="py-2 px-3">
                        <PaymentStatusBadge status={d.statusPembayaran} hasPendingVerification={d.hasPendingVerification} />
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">
                        <div className="font-semibold text-slate-900">{formatIDR(d.outstandingAmount)}</div>
                        <div className="text-[10px] text-slate-500">Tagihan: {formatIDR(d.netBillAmount)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Matriks Alokasi Many-to-Many */}
      <div className="bg-white border border-slate-200 rounded-md p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Matriks Alokasi Many-to-Many</h2>
            <p className="text-xs text-slate-500">
              Centang 1 atau lebih receipt (kiri) dan 1 atau lebih nota pelanggan yang sama (kanan), lalu isi nominal alokasi.
            </p>
          </div>
          {selectedReceipts.length > 0 && selectedDocs.length > 0 && (
            <button
              type="button"
              onClick={() => {
                // Isi otomatis saran FIFO per pasangan pelanggan sama tanpa submit otomatis
                const next: Record<string, string> = {};
                const docRem: Record<string, Decimal> = {};
                selectedDocs.forEach((d) => {
                  docRem[d.salesDocumentId] = toDec(d.outstandingAmount).minus(toDec(d.pendingAllocationAmount));
                });
                for (const r of selectedReceipts) {
                  let rRem = toDec(r.availableToAllocate).minus(toDec(r.pendingProposedAmount));
                  for (const d of selectedDocs) {
                    if (r.customerId !== d.customerUuid || rRem.lte(0)) continue;
                    const take = Decimal.min(rRem, docRem[d.salesDocumentId] || new Decimal(0));
                    if (take.gt(0)) {
                      next[`${r.receiptId}::${d.salesDocumentId}`] = take.toFixed(0);
                      rRem = rRem.minus(take);
                      docRem[d.salesDocumentId] = docRem[d.salesDocumentId].minus(take);
                    }
                  }
                }
                setMatrix(next);
              }}
              className="px-3 py-1.5 text-xs font-medium text-teal-700 border border-teal-200 rounded hover:bg-teal-50 whitespace-nowrap"
            >
              Isi Saran FIFO (Periksa Sebelum Ajukan)
            </button>
          )}
        </div>

        {selectedReceipts.length === 0 || selectedDocs.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded">
            Pilih minimal 1 receipt terverifikasi dan 1 nota pelanggan untuk membuka matriks alokasi.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto border border-slate-200 rounded-md">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-700">
                  <tr>
                    <th className="py-2.5 px-3">Receipt App 1 (Saldo Tersedia)</th>
                    {selectedDocs.map((d) => (
                      <th key={d.salesDocumentId} className="py-2.5 px-3 text-right min-w-[160px]">
                        <div className="font-mono">{d.docNumber}</div>
                        <div className="text-[11px] font-normal text-slate-500">
                          Sisa: {formatIDR(toDec(d.outstandingAmount).minus(toDec(d.pendingAllocationAmount)))}
                        </div>
                      </th>
                    ))}
                    <th className="py-2.5 px-3 text-right bg-slate-100">Sisa Receipt Setelah Alokasi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {selectedReceipts.map((r) => {
                    const used = matrixValidation.rowSums[r.receiptId] || new Decimal(0);
                    const avail = toDec(r.availableToAllocate).minus(toDec(r.pendingProposedAmount));
                    const remAfter = avail.minus(used);
                    return (
                      <tr key={r.receiptId}>
                        <td className="py-2.5 px-3">
                          <div className="font-mono font-medium text-slate-900">{r.receiptNumber}</div>
                          <div className="text-[11px] text-slate-500">Tersedia: {formatIDR(avail)}</div>
                        </td>
                        {selectedDocs.map((d) => {
                          const key = `${r.receiptId}::${d.salesDocumentId}`;
                          return (
                            <td key={key} className="py-2.5 px-3">
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={matrix[key] || ''}
                                onChange={(e) => setMatrix((prev) => ({ ...prev, [key]: e.target.value }))}
                                placeholder="0"
                                className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-right font-mono tabular-nums focus:border-teal-600 focus:outline-none"
                              />
                            </td>
                          );
                        })}
                        <td
                          className={`py-2.5 px-3 text-right font-mono tabular-nums font-medium bg-slate-50 ${
                            remAfter.lt(0) ? 'text-rose-700' : 'text-teal-700'
                          }`}
                        >
                          {formatIDR(remAfter)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-50 border-t border-slate-200 font-medium">
                  <tr>
                    <td className="py-2.5 px-3 text-slate-700">Sisa Piutang Nota Setelah Alokasi</td>
                    {selectedDocs.map((d) => {
                      const colSum = matrixValidation.colSums[d.salesDocumentId] || new Decimal(0);
                      const remDoc = toDec(d.outstandingAmount)
                        .minus(toDec(d.pendingAllocationAmount))
                        .minus(colSum);
                      return (
                        <td
                          key={d.salesDocumentId}
                          className={`py-2.5 px-3 text-right font-mono tabular-nums ${
                            remDoc.lt(0) ? 'text-rose-700' : 'text-slate-900'
                          }`}
                        >
                          {formatIDR(remDoc)}
                        </td>
                      );
                    })}
                    <td className="py-2.5 px-3"></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {matrixValidation.errors.length > 0 && (
              <div className="text-xs text-rose-700 space-y-0.5">
                {matrixValidation.errors.map((e, idx) => (
                  <div key={idx}>• {e}</div>
                ))}
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Catatan alokasi (opsional)..."
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-xs"
              />
              <button
                type="button"
                disabled={busy || !matrixValidation.valid}
                onClick={handlePropose}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium bg-teal-700 text-white rounded-md hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap"
              >
                Ajukan Usulan Alokasi ({matrixValidation.items.length} tautan)
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Antrian Persetujuan Alokasi (Maker-Checker) & Riwayat Alokasi Aktif */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              Usulan Alokasi Menunggu Persetujuan ({proposedList.length})
            </h2>
            {proposedList.length > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => handleApprove(proposedList.filter((p) => p.createdBy !== session.userId).map((p) => p.id))}
                className="text-xs font-medium text-teal-700 hover:underline disabled:opacity-40"
              >
                Setujui Semua yang Valid
              </button>
            )}
          </div>
          {proposedList.length === 0 ? (
            <div className="p-6 text-xs text-slate-500 text-center">Tidak ada usulan alokasi menunggu review.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2 px-3">Receipt</th>
                    <th className="py-2 px-3">Nota</th>
                    <th className="py-2 px-3 text-right">Nominal</th>
                    <th className="py-2 px-3">Pengusul</th>
                    <th className="py-2 px-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {proposedList.map((a) => {
                    const sameUser = a.createdBy === session.userId;
                    return (
                      <tr key={a.id}>
                        <td className="py-2 px-3 font-mono">{a.receiptNumber}</td>
                        <td className="py-2 px-3 font-mono">{a.docNumber}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums font-medium">{formatIDR(a.allocatedAmount)}</td>
                        <td className="py-2 px-3 text-slate-600">{a.createdByName}</td>
                        <td className="py-2 px-3 text-right">
                          {sameUser ? (
                            <span className="text-[11px] text-amber-700">Butuh Reviewer Lain</span>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleApprove([a.id])}
                              className="px-2.5 py-1 text-[11px] font-medium bg-emerald-700 text-white rounded hover:bg-emerald-800"
                            >
                              Setujui
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">Alokasi Disetujui ({approvedList.length})</h2>
          </div>
          {approvedList.length === 0 ? (
            <div className="p-6 text-xs text-slate-500 text-center">Belum ada alokasi disetujui.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2 px-3">Receipt</th>
                    <th className="py-2 px-3">Nota</th>
                    <th className="py-2 px-3 text-right">Nominal</th>
                    <th className="py-2 px-3">Disetujui</th>
                    <th className="py-2 px-3 text-right">Pelepasan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {approvedList.map((a) => (
                    <tr key={a.id}>
                      <td className="py-2 px-3 font-mono">{a.receiptNumber}</td>
                      <td className="py-2 px-3 font-mono">{a.docNumber}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums font-medium">{formatIDR(a.allocatedAmount)}</td>
                      <td className="py-2 px-3 text-[11px] text-slate-500">
                        {a.approvedByName || '-'} · {formatDateTimeJakarta(a.approvedAt)}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setReverseTarget(a);
                            setReverseReason('');
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-rose-700 border border-rose-200 rounded hover:bg-rose-50"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Lepas
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal Pelepasan Alokasi */}
      {reverseTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white border border-slate-200 rounded-lg shadow-xl w-full max-w-md p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">Lepas Alokasi Pembayaran</h3>
            <p className="text-xs text-slate-600">
              Pelepasan alokasi <span className="font-mono font-semibold">{reverseTarget.receiptNumber}</span> →{' '}
              <span className="font-mono font-semibold">{reverseTarget.docNumber}</span> senilai{' '}
              <span className="font-mono font-semibold">{formatIDR(reverseTarget.allocatedAmount)}</span> akan memancarkan event pembalik ke App 3. Jika periode sudah ditutup, proses ditolak.
            </p>
            <textarea
              rows={3}
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
              placeholder="Alasan pelepasan alokasi (wajib, min. 5 karakter)..."
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReverseTarget(null)}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-md"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={busy || reverseReason.trim().length < 5}
                onClick={handleReverse}
                className="px-3 py-1.5 text-xs font-medium bg-rose-700 text-white rounded-md hover:bg-rose-800 disabled:opacity-50"
              >
                Konfirmasi Lepas Alokasi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
