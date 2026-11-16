import React, { useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import Decimal from 'decimal.js';
import { todayISOJakarta } from '../lib/dates';
import { formatIDR, mulDec, roundHalfUp, toDec } from '../lib/decimal';
import type {
  AppUserSession,
  BranchOption,
  MasterCustomer,
  MasterProduct,
  MasterStaff,
  SalesLineInput,
  TaxCodeOption,
} from '../types/app';
import type { PlannedPaymentMethod, TaxBasis } from '../types/database.types';
import { InfoTooltip } from './StatusBadges';

interface NotaFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: AppUserSession;
  branches: BranchOption[];
  customers: MasterCustomer[];
  products: MasterProduct[];
  staffList: MasterStaff[];
  taxCodes: TaxCodeOption[];
  onSubmitDraft: (payload: {
    branchId: string;
    customerId: string;
    salesStaffId: string | null;
    invoiceDate: string;
    deliveryDate: string | null;
    dueDate: string | null;
    plannedPaymentMethod: PlannedPaymentMethod;
    taxBasis: TaxBasis;
    taxCodeId: string | null;
    sourceInvoiceNo: string | null;
    notes: string | null;
    lines: SalesLineInput[];
    submitImmediately: boolean;
  }) => Promise<void>;
}

export function NotaFormModal({
  isOpen,
  onClose,
  session,
  branches,
  customers,
  products,
  staffList,
  taxCodes,
  onSubmitDraft,
}: NotaFormModalProps) {
  const [branchId, setBranchId] = useState(session.branchId || branches[0]?.id || '');
  const [customerId, setCustomerId] = useState('');
  const [salesStaffId, setSalesStaffId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayISOJakarta());
  const [deliveryDate, setDeliveryDate] = useState(todayISOJakarta());
  const [deliveryPending, setDeliveryPending] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const [plannedMethod, setPlannedMethod] = useState<PlannedPaymentMethod>('credit');
  const [taxBasis, setTaxBasis] = useState<TaxBasis>('non_tax');
  const [taxCodeId, setTaxCodeId] = useState('');
  const [sourceInvoiceNo, setSourceInvoiceNo] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<SalesLineInput[]>([
    { productId: '', unitCode: 'PCS', quantity: '1', netUnitPrice: '0', notes: '' },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const salesOptions = useMemo(
    () => staffList.filter((s) => s.staffRole === 'sales' || s.staffRole === 'admin'),
    [staffList]
  );

  const branchCustomers = useMemo(
    () => customers.filter((c) => !branchId || c.branchId === branchId),
    [customers, branchId]
  );

  const lineSummary = useMemo(() => {
    let subtotal = new Decimal(0);
    const details = lines.map((ln) => {
      const qty = toDec(ln.quantity);
      const price = toDec(ln.netUnitPrice);
      const raw = mulDec(qty, price);
      const rounded = roundHalfUp(raw, 0);
      subtotal = subtotal.plus(rounded);
      return { raw, rounded };
    });
    const rate =
      taxBasis !== 'non_tax' && taxCodeId
        ? toDec(taxCodes.find((t) => t.id === taxCodeId)?.rate || '0')
        : new Decimal(0);
    let taxAmt = new Decimal(0);
    let grandTotal = subtotal;
    if (taxBasis === 'tax_exclusive' && rate.gt(0)) {
      taxAmt = roundHalfUp(subtotal.times(rate), 0);
      grandTotal = subtotal.plus(taxAmt);
    } else if (taxBasis === 'tax_inclusive' && rate.gt(0)) {
      grandTotal = subtotal;
      taxAmt = roundHalfUp(grandTotal.minus(grandTotal.div(new Decimal(1).plus(rate))), 0);
    }
    return { details, subtotal, taxAmt, grandTotal };
  }, [lines, taxBasis, taxCodeId, taxCodes]);

  if (!isOpen) return null;

  const handleCustomerChange = (cid: string) => {
    setCustomerId(cid);
    const c = customers.find((x) => x.id === cid);
    if (c?.defaultSalesId && !salesStaffId) {
      setSalesStaffId(c.defaultSalesId);
    }
  };

  const handleProductChange = (idx: number, pid: string) => {
    const prod = products.find((p) => p.id === pid);
    setLines((prev) =>
      prev.map((l, i) =>
        i === idx ? { ...l, productId: pid, unitCode: prod?.baseUnit || l.unitCode } : l
      )
    );
  };

  const handleSave = async (submitImmediately: boolean) => {
    setErrorMsg(null);
    if (!branchId) return setErrorMsg('Cabang wajib dipilih.');
    if (!customerId) return setErrorMsg('Pelanggan wajib dipilih.');
    if (submitImmediately && (deliveryPending || !deliveryDate)) {
      return setErrorMsg('Penjualan dengan pengiriman belum pasti hanya dapat disimpan sebagai draft/menunggu kirim.');
    }
    if (lines.some((l) => !l.productId || toDec(l.quantity).lte(0) || toDec(l.netUnitPrice).lt(0))) {
      return setErrorMsg('Semua baris produk wajib dipilih dengan QTY > 0 dan harga >= 0.');
    }

    setSubmitting(true);
    try {
      await onSubmitDraft({
        branchId,
        customerId,
        salesStaffId: salesStaffId || null,
        invoiceDate,
        deliveryDate: deliveryPending ? null : deliveryDate || null,
        dueDate: dueDate || null,
        plannedPaymentMethod: plannedMethod,
        taxBasis,
        taxCodeId: taxBasis === 'non_tax' ? null : taxCodeId || null,
        sourceInvoiceNo: sourceInvoiceNo.trim() || null,
        notes: notes.trim() || null,
        lines,
        submitImmediately,
      });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyimpan nota penjualan.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-lg shadow-xl w-full max-w-4xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Buat Nota Penjualan Baru</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Nomor nota otomatis dibuat server · Tanggal pengiriman menentukan periode pengakuan penjualan
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 rounded-md"
            aria-label="Tutup form"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          {errorMsg && (
            <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-xs text-rose-800">
              {errorMsg}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Cabang</label>
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                disabled={!session.allBranches && branches.length <= 1}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:border-teal-600 focus:outline-none"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} — {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Pelanggan (CUST ID)</label>
              <select
                value={customerId}
                onChange={(e) => handleCustomerChange(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:border-teal-600 focus:outline-none"
              >
                <option value="">-- Pilih Pelanggan --</option>
                {branchCustomers.map((c) => (
                  <option key={c.id} value={c.id}>
                    [{c.custId}] {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Sales Penanggung Jawab</label>
              <select
                value={salesStaffId}
                onChange={(e) => setSalesStaffId(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:border-teal-600 focus:outline-none"
              >
                <option value="">-- Pilih Sales --</option>
                {salesOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName} ({s.staffCode})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal Invoice</label>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono focus:border-teal-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Tanggal Kirim
                <InfoTooltip text="Tanggal barang benar-benar diserahkan ke pelanggan. Menentukan periode pengakuan penjualan (WEEK & MONTH)." />
              </label>
              <input
                type="date"
                value={deliveryDate}
                disabled={deliveryPending}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono disabled:bg-slate-100 focus:border-teal-600 focus:outline-none"
              />
              <label className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deliveryPending}
                  onChange={(e) => setDeliveryPending(e.target.checked)}
                  className="rounded border-slate-300 text-teal-700"
                />
                Pengiriman belum pasti (tahan sebagai Draft)
              </label>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Jatuh Tempo</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono focus:border-teal-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">No. Referensi Eksternal</label>
              <input
                type="text"
                value={sourceInvoiceNo}
                onChange={(e) => setSourceInvoiceNo(e.target.value)}
                placeholder="Misal: SJ-2026-088"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Rencana Pembayaran
                <InfoTooltip text="Rencana metode pembayaran. Kolom METODE PEMBAYARAN di rekap tetap diturunkan dari penerimaan terverifikasi App 1." />
              </label>
              <select
                value={plannedMethod}
                onChange={(e) => setPlannedMethod(e.target.value as PlannedPaymentMethod)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:border-teal-600 focus:outline-none"
              >
                <option value="credit">Kredit / Tempo</option>
                <option value="transfer">Rencana Transfer</option>
                <option value="cash">Rencana Tunai</option>
                <option value="mixed">Rencana Campuran</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Basis Pajak</label>
              <select
                value={taxBasis}
                onChange={(e) => setTaxBasis(e.target.value as TaxBasis)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:border-teal-600 focus:outline-none"
              >
                <option value="non_tax">Non-Pajak</option>
                <option value="tax_exclusive">Tax-Exclusive (Harga sebelum pajak)</option>
                <option value="tax_inclusive">Tax-Inclusive (Harga sudah termasuk pajak)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Kode Pajak</label>
              <select
                value={taxCodeId}
                disabled={taxBasis === 'non_tax'}
                onChange={(e) => setTaxCodeId(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white disabled:bg-slate-100 focus:border-teal-600 focus:outline-none"
              >
                <option value="">-- Pilih Pajak --</option>
                {taxCodes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code} — {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-slate-800">Daftar Produk pada Nota</h3>
              <button
                type="button"
                onClick={() =>
                  setLines((prev) => [
                    ...prev,
                    { productId: '', unitCode: 'PCS', quantity: '1', netUnitPrice: '0', notes: '' },
                  ])
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                <Plus className="w-3.5 h-3.5" />
                Tambah Baris Produk
              </button>
            </div>

            <div className="border border-slate-200 rounded-md overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2 px-3 font-medium">Produk / SKU</th>
                    <th className="py-2 px-2 font-medium w-24">Satuan</th>
                    <th className="py-2 px-2 font-medium w-24 text-right">QTY</th>
                    <th className="py-2 px-2 font-medium w-36 text-right">Net Price</th>
                    <th className="py-2 px-3 font-medium w-36 text-right">Total Baris</th>
                    <th className="py-2 px-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {lines.map((ln, idx) => (
                    <tr key={idx}>
                      <td className="py-2 px-3">
                        <select
                          value={ln.productId}
                          onChange={(e) => handleProductChange(idx, e.target.value)}
                          className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs bg-white"
                        >
                          <option value="">-- Pilih Produk --</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              [{p.sku}] {p.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="text"
                          value={ln.unitCode}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, unitCode: e.target.value } : x))
                            )
                          }
                          className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs font-mono uppercase"
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          min="0.000001"
                          step="any"
                          value={ln.quantity}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x))
                            )
                          }
                          className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs font-mono text-right tabular-nums"
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={ln.netUnitPrice}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, netUnitPrice: e.target.value } : x))
                            )
                          }
                          className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs font-mono text-right tabular-nums"
                        />
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums font-medium text-slate-900">
                        {formatIDR(lineSummary.details[idx]?.rounded || 0)}
                      </td>
                      <td className="py-2 px-2 text-center">
                        {lines.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                            className="p-1 text-slate-400 hover:text-rose-600"
                            aria-label="Hapus baris"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Keterangan Bisnis</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Catatan pengiriman, rute, atau syarat pesanan..."
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
              />
            </div>
            <div className="border border-slate-200 rounded-md bg-slate-50 p-3.5 space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal Baris (Pembulatan Half-Up)</span>
                <span className="font-mono tabular-nums">{formatIDR(lineSummary.subtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Pajak ({taxBasis})</span>
                <span className="font-mono tabular-nums">{formatIDR(lineSummary.taxAmt)}</span>
              </div>
              <div className="flex justify-between pt-1.5 border-t border-slate-200 font-semibold text-sm text-slate-900">
                <span>Total Tagihan Nota</span>
                <span className="font-mono tabular-nums">{formatIDR(lineSummary.grandTotal)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => handleSave(false)}
            className="px-4 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-100"
          >
            {submitting ? 'Menyimpan...' : 'Simpan Draft'}
          </button>
          <button
            type="button"
            disabled={submitting || deliveryPending}
            onClick={() => handleSave(true)}
            className="px-4 py-2 text-xs font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 disabled:opacity-50"
          >
            {submitting ? 'Memproses...' : 'Simpan & Ajukan Persetujuan'}
          </button>
        </div>
      </div>
    </div>
  );
}
