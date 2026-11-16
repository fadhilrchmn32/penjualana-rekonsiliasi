import React, { useMemo, useState } from 'react';
import { Building2, Lock, Package, Plus, Search, Tag, Users } from 'lucide-react';
import { formatIDR, formatQty } from '../lib/decimal';
import type {
  AppUserSession,
  BranchOption,
  CustomerAlias,
  MasterCustomer,
  MasterProduct,
  MasterStaff,
} from '../types/app';

interface MasterDataViewProps {
  session: AppUserSession;
  branches: BranchOption[];
  customers: MasterCustomer[];
  aliases: CustomerAlias[];
  products: MasterProduct[];
  staff: MasterStaff[];
  canViewHpp: boolean;
  onUpsertCustomer: (payload: {
    branchId: string;
    custId: string;
    name: string;
    phone?: string;
    address?: string;
  }) => Promise<void>;
  onUpsertAlias: (customerId: string, aliasName: string, bankHint?: string) => Promise<void>;
  onUpsertProduct: (payload: {
    sku: string;
    name: string;
    baseUnit: string;
    isStocked: boolean;
  }) => Promise<void>;
}

type MasterTab = 'customers' | 'aliases' | 'products' | 'staff';

export function MasterDataView({
  session,
  branches,
  customers,
  aliases,
  products,
  staff,
  canViewHpp,
  onUpsertCustomer,
  onUpsertAlias,
  onUpsertProduct,
}: MasterDataViewProps) {
  const [tab, setTab] = useState<MasterTab>('customers');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Customer form
  const [custBranchId, setCustBranchId] = useState(session.branchId || branches[0]?.id || '');
  const [custIdInput, setCustIdInput] = useState('');
  const [custNameInput, setCustNameInput] = useState('');
  const [custPhoneInput, setCustPhoneInput] = useState('');
  const [custAddressInput, setCustAddressInput] = useState('');

  // Alias form
  const [aliasCustomerId, setAliasCustomerId] = useState('');
  const [aliasNameInput, setAliasNameInput] = useState('');
  const [aliasBankHint, setAliasBankHint] = useState('');

  // Product form
  const [skuInput, setSkuInput] = useState('');
  const [prodNameInput, setProdNameInput] = useState('');
  const [baseUnitInput, setBaseUnitInput] = useState('PCS');
  const [isStockedInput, setIsStockedInput] = useState(true);

  const canMutateMaster = session.roles.some((r) =>
    ['sales_admin', 'reconciliation_reviewer', 'accountant', 'system_admin'].includes(r)
  );

  const q = search.trim().toLowerCase();

  const filteredCustomers = useMemo(
    () =>
      customers.filter(
        (c) =>
          !q ||
          c.custId.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          (c.phone || '').toLowerCase().includes(q)
      ),
    [customers, q]
  );

  const filteredAliases = useMemo(
    () =>
      aliases.filter((a) => {
        const cust = customers.find((c) => c.id === a.customerId);
        if (!q) return true;
        return (
          a.aliasName.toLowerCase().includes(q) ||
          (a.sourceBankAccountHint || '').toLowerCase().includes(q) ||
          (cust?.name || '').toLowerCase().includes(q) ||
          (cust?.custId || '').toLowerCase().includes(q)
        );
      }),
    [aliases, customers, q]
  );

  const filteredProducts = useMemo(
    () =>
      products.filter(
        (p) =>
          !q ||
          p.sku.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          p.baseUnit.toLowerCase().includes(q)
      ),
    [products, q]
  );

  const filteredStaff = useMemo(
    () =>
      staff.filter(
        (s) =>
          !q ||
          s.staffCode.toLowerCase().includes(q) ||
          s.fullName.toLowerCase().includes(q) ||
          s.staffRole.toLowerCase().includes(q)
      ),
    [staff, q]
  );

  const branchName = (bid: string) => branches.find((b) => b.id === bid)?.name || bid;

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (!custIdInput.trim() || !custNameInput.trim()) {
      setMsg({ type: 'err', text: 'CUST ID (teks) dan Nama Pelanggan wajib diisi.' });
      return;
    }
    setBusy(true);
    try {
      await onUpsertCustomer({
        branchId: custBranchId || session.branchId,
        custId: custIdInput.trim(),
        name: custNameInput.trim(),
        phone: custPhoneInput.trim() || undefined,
        address: custAddressInput.trim() || undefined,
      });
      setCustIdInput('');
      setCustNameInput('');
      setCustPhoneInput('');
      setCustAddressInput('');
      setMsg({ type: 'ok', text: 'Master pelanggan berhasil disimpan.' });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Gagal menyimpan pelanggan.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveAlias = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (!aliasCustomerId || !aliasNameInput.trim()) {
      setMsg({ type: 'err', text: 'Pilih pelanggan resmi dan isi nama alias.' });
      return;
    }
    setBusy(true);
    try {
      await onUpsertAlias(aliasCustomerId, aliasNameInput.trim(), aliasBankHint.trim() || undefined);
      setAliasNameInput('');
      setAliasBankHint('');
      setMsg({ type: 'ok', text: 'Alias pelanggan berhasil ditambahkan.' });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Gagal menyimpan alias.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (!skuInput.trim() || !prodNameInput.trim() || !baseUnitInput.trim()) {
      setMsg({ type: 'err', text: 'SKU, Nama Produk, dan Satuan Dasar wajib diisi.' });
      return;
    }
    setBusy(true);
    try {
      await onUpsertProduct({
        sku: skuInput.trim(),
        name: prodNameInput.trim(),
        baseUnit: baseUnitInput.trim().toUpperCase(),
        isStocked: isStockedInput,
      });
      setSkuInput('');
      setProdNameInput('');
      setMsg({ type: 'ok', text: 'Master produk berhasil disimpan.' });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Gagal menyimpan produk.' });
    } finally {
      setBusy(false);
    }
  };

  const tabItems: Array<{ key: MasterTab; label: string; count: number; icon: React.ComponentType<{ className?: string }> }> = [
    { key: 'customers', label: 'Pelanggan', count: customers.length, icon: Building2 },
    { key: 'aliases', label: 'Alias Pelanggan', count: aliases.length, icon: Tag },
    { key: 'products', label: 'Produk & Satuan', count: products.length, icon: Package },
    { key: 'staff', label: 'Sales & Petugas', count: staff.length, icon: Users },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-md p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 border border-slate-200 rounded-md p-1 bg-slate-50">
          {tabItems.map((item) => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setTab(item.key);
                  setMsg(null);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
                <span
                  className={`font-mono text-[11px] px-1 rounded ${
                    active ? 'bg-slate-700 text-slate-200' : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {item.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="relative min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari ID, nama, SKU, atau alias..."
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
          />
        </div>
      </div>

      {msg && (
        <div
          className={`px-4 py-2.5 rounded-md border text-sm ${
            msg.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {msg.text}
        </div>
      )}

      {tab === 'customers' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-md overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                Daftar Pelanggan Resmi (CUST ID Teks dengan Nol Depan Terjaga)
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="text-left px-3 py-2.5">CUST ID</th>
                    <th className="text-left px-3 py-2.5">Nama Pelanggan</th>
                    <th className="text-left px-3 py-2.5">Cabang</th>
                    <th className="text-left px-3 py-2.5">Telepon</th>
                    <th className="text-left px-3 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredCustomers.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-900">
                        {c.custId}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-900">{c.name}</div>
                        {c.address && <div className="text-xs text-slate-500">{c.address}</div>}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">{branchName(c.branchId)}</td>
                      <td className="px-3 py-2 text-xs text-slate-600 font-mono">{c.phone || '-'}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block px-1.5 py-0.5 text-[11px] font-medium rounded border ${
                            c.isActive
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                              : 'bg-slate-100 border-slate-200 text-slate-600'
                          }`}
                        >
                          {c.isActive ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {filteredCustomers.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">
                        Tidak ada pelanggan sesuai pencarian.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-md p-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Tambah / Perbarui Pelanggan</h3>
            {!canMutateMaster ? (
              <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded p-3">
                Mode baca-saja untuk role Anda.
              </div>
            ) : (
              <form onSubmit={handleSaveCustomer} className="space-y-3">
                {session.allBranches && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Cabang</label>
                    <select
                      value={custBranchId}
                      onChange={(e) => setCustBranchId(e.target.value)}
                      className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm"
                    >
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.code} — {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    CUST ID (Teks Exact, mis. 00104)
                  </label>
                  <input
                    type="text"
                    value={custIdInput}
                    onChange={(e) => setCustIdInput(e.target.value)}
                    placeholder="00104"
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nama Pelanggan</label>
                  <input
                    type="text"
                    value={custNameInput}
                    onChange={(e) => setCustNameInput(e.target.value)}
                    placeholder="Toko ..."
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Telepon</label>
                  <input
                    type="text"
                    value={custPhoneInput}
                    onChange={(e) => setCustPhoneInput(e.target.value)}
                    placeholder="0812..."
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Alamat</label>
                  <textarea
                    rows={2}
                    value={custAddressInput}
                    onChange={(e) => setCustAddressInput(e.target.value)}
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                  Simpan Pelanggan
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {tab === 'aliases' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-md overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">
                Pemetaan Alias Pelanggan & Nama Pengirim Transfer
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Digunakan sebagai saran pencocokan saat impor arsip atau pencocokan receipt App 1, tanpa menggantikan identitas resmi CUST ID.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="text-left px-3 py-2.5">Nama Alias / Pengirim</th>
                    <th className="text-left px-3 py-2.5">Pelanggan Resmi</th>
                    <th className="text-left px-3 py-2.5">Petunjuk Rekening / Sumber</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAliases.map((a) => {
                    const cust = customers.find((c) => c.id === a.customerId);
                    return (
                      <tr key={a.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-900">{a.aliasName}</td>
                        <td className="px-3 py-2 text-slate-700">
                          <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded mr-1.5">
                            {cust?.custId || '-'}
                          </span>
                          {cust?.name || a.customerId}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {a.sourceBankAccountHint || '-'}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredAliases.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-slate-500">
                        Belum ada alias pelanggan.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-md p-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Tambah Alias Pelanggan</h3>
            {!canMutateMaster ? (
              <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded p-3">
                Mode baca-saja untuk role Anda.
              </div>
            ) : (
              <form onSubmit={handleSaveAlias} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Pelanggan Resmi</label>
                  <select
                    value={aliasCustomerId}
                    onChange={(e) => setAliasCustomerId(e.target.value)}
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm"
                  >
                    <option value="">— Pilih Pelanggan —</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.custId} — {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nama Alias / Pengirim</label>
                  <input
                    type="text"
                    value={aliasNameInput}
                    onChange={(e) => setAliasNameInput(e.target.value)}
                    placeholder="mis. SUMBER MAKMUR TB"
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Catatan / Bank Hint</label>
                  <input
                    type="text"
                    value={aliasBankHint}
                    onChange={(e) => setAliasBankHint(e.target.value)}
                    placeholder="mis. BCA a.n. Budi"
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                  Simpan Alias
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {tab === 'products' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-md overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Master Produk & Satuan</h3>
              {!canViewHpp && (
                <span className="inline-flex items-center gap-1 text-xs text-slate-600 bg-slate-100 border border-slate-200 px-2 py-1 rounded">
                  <Lock className="w-3.5 h-3.5 text-slate-500" />
                  Kolom HPP & valuasi stok disembunyikan oleh kebijakan RLS untuk role Anda
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="text-left px-3 py-2.5">SKU</th>
                    <th className="text-left px-3 py-2.5">Nama Produk</th>
                    <th className="text-left px-3 py-2.5">Satuan</th>
                    <th className="text-left px-3 py-2.5">Kelola Stok</th>
                    {canViewHpp && (
                      <>
                        <th className="text-right px-3 py-2.5">Qty Tersedia</th>
                        <th className="text-right px-3 py-2.5">HPP Rata-Rata</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredProducts.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-900">{p.sku}</td>
                      <td className="px-3 py-2 text-slate-900 font-medium">{p.name}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-600">{p.baseUnit}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {p.isStocked ? 'Barang Stok' : 'Non-Stok / Jasa'}
                      </td>
                      {canViewHpp && (
                        <>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-800">
                            {p.qtyOnHand !== undefined ? formatQty(p.qtyOnHand) : '-'}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-800">
                            {p.avgUnitCost !== undefined ? formatIDR(p.avgUnitCost) : (
                              <span className="text-amber-700 text-xs">Belum ada HPP</span>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                  {filteredProducts.length === 0 && (
                    <tr>
                      <td colSpan={canViewHpp ? 6 : 4} className="px-4 py-8 text-center text-slate-500">
                        Tidak ada produk ditemukan.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-md p-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Tambah / Perbarui Produk</h3>
            {!canMutateMaster ? (
              <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded p-3">
                Mode baca-saja untuk role Anda.
              </div>
            ) : (
              <form onSubmit={handleSaveProduct} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">SKU</label>
                  <input
                    type="text"
                    value={skuInput}
                    onChange={(e) => setSkuInput(e.target.value)}
                    placeholder="BRS-05"
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nama Produk</label>
                  <input
                    type="text"
                    value={prodNameInput}
                    onChange={(e) => setProdNameInput(e.target.value)}
                    placeholder="Beras Premium 5kg"
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Satuan Dasar</label>
                  <input
                    type="text"
                    value={baseUnitInput}
                    onChange={(e) => setBaseUnitInput(e.target.value)}
                    placeholder="SAK / CRT / PCS"
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm font-mono"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-700 pt-1">
                  <input
                    type="checkbox"
                    checked={isStockedInput}
                    onChange={(e) => setIsStockedInput(e.target.checked)}
                    className="rounded border-slate-300 text-teal-700"
                  />
                  Kelola persediaan & HPP (memerlukan HPP valid saat rilis)
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-3 py-2 rounded-md disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                  Simpan Produk
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {tab === 'staff' && (
        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">
              Direktori Sales, Penagih, Sopir & Petugas Rekonsiliasi
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Menggunakan tabel bersama <code className="font-mono">staff</code> antara App 1 dan App 2.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2.5">Kode</th>
                  <th className="text-left px-3 py-2.5">Nama Lengkap</th>
                  <th className="text-left px-3 py-2.5">Peran Lapangan</th>
                  <th className="text-left px-3 py-2.5">Cabang</th>
                  <th className="text-left px-3 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredStaff.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-800">{s.staffCode}</td>
                    <td className="px-3 py-2 font-medium text-slate-900">{s.fullName}</td>
                    <td className="px-3 py-2 text-xs uppercase tracking-wide text-slate-600">{s.staffRole}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{branchName(s.branchId)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block px-1.5 py-0.5 text-[11px] font-medium rounded border ${
                          s.isActive
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            : 'bg-slate-100 border-slate-200 text-slate-600'
                        }`}
                      >
                        {s.isActive ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
