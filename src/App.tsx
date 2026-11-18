import React, { useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  BookOpenCheck,
  CheckSquare,
  Database,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FolderUp,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  ShieldAlert,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { NotaDetailDrawer } from './components/NotaDetailDrawer';
import { NotaFormModal } from './components/NotaFormModal';
import { formatDateTimeJakarta, todayISOJakarta } from './lib/dates';
import { getSupabaseClient } from './lib/supabase';
import {
  createDemoGateway,
  createLiveSupabaseGateway,
  getInitialOperationMode,
  type AppOperationMode,
  type FinOpsGateway,
} from './services/finopsService';
import type { AppRouteKey, AppUserSession } from './types/app';
import { ImporArsipView } from './views/ImporArsipView';
import { MasterDataView } from './views/MasterDataView';
import { NotaDaftarView } from './views/NotaDaftarView';
import { PencocokanPembayaranView } from './views/PencocokanPembayaranView';
import { PiutangPelangganView } from './views/PiutangPelangganView';
import { RekapPenjualanView } from './views/RekapPenjualanView';
import { RekonsiliasiAlmiraView } from './views/RekonsiliasiAlmiraView';
import { RingkasanPenjualanView } from './views/RingkasanPenjualanView';
import { SetupDanUatView } from './views/SetupDanUatView';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const NAV_ITEMS: Array<{
  key: AppRouteKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: 'ringkasan', label: 'Ringkasan Penjualan', icon: BarChart3 },
  { key: 'rekap', label: 'Rekap Penjualan', icon: FileSpreadsheet },
  { key: 'nota', label: 'Nota & Detail Produk', icon: FileText },
  { key: 'pencocokan', label: 'Pencocokan Pembayaran', icon: ArrowLeftRight },
  { key: 'almira', label: 'Rekonsiliasi (Almira)', icon: CheckSquare },
  { key: 'piutang', label: 'Piutang Pelanggan', icon: Wallet },
  { key: 'impor', label: 'Impor & Arsip', icon: FolderUp },
  { key: 'master', label: 'Master Data', icon: Users },
  { key: 'setup_uat', label: 'Setup, Outbox & UAT', icon: Database },
];

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <FinOpsAppShell />
    </QueryClientProvider>
  );
}

function FinOpsAppShell() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<AppOperationMode>(() => getInitialOperationMode());
  const [activeRoute, setActiveRoute] = useState<AppRouteKey>('ringkasan');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Gateway memoized by mode
  const demoGateway = useMemo(() => createDemoGateway(), []);
  const liveGateway = useMemo(
    () => (mode === 'live_supabase' ? createLiveSupabaseGateway() : null),
    [mode]
  );
  const gateway: FinOpsGateway | null =
    mode === 'demo_isolated' ? demoGateway : mode === 'live_supabase' ? liveGateway : null;

  // Auth state for live_supabase
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Demo role tracking (ensures sessionQuery key & all role-guarded queries update immediately)
  const [demoUserId, setDemoUserId] = useState<string>(() => demoGateway.getDemoUsers()[0].userId);

  // Filters & active selections
  const [activeBranchFilter, setActiveBranchFilter] = useState<string>('');
  const [cutoffDate, setCutoffDate] = useState<string>('');
  const [includeArchive, setIncludeArchive] = useState<boolean>(false);
  const [arAsOfDate, setArAsOfDate] = useState<string>(todayISOJakarta());

  // Modals / Drawers
  const [selectedNotaId, setSelectedNotaId] = useState<string | null>(null);
  const [newNotaOpen, setNewNotaOpen] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string>(() => new Date().toISOString());

  // Session query
  const sessionQuery = useQuery({
    queryKey: ['session', mode, mode === 'demo_isolated' ? demoUserId : 'live'],
    enabled: gateway !== null,
    placeholderData: (previousData) => (mode === 'demo_isolated' ? previousData : undefined),
    queryFn: async () => {
      if (!gateway) return null;
      if (mode === 'demo_isolated') {
        demoGateway.switchDemoUser(demoUserId);
      }
      return gateway.getSession();
    },
  });

  const session: AppUserSession | null = sessionQuery.data ?? null;
  const companyId = session?.companyId || '';
  const hasActiveCompany = Boolean(session && companyId);

  // Supabase auth state listener + Realtime invalidation
  useEffect(() => {
    if (mode !== 'live_supabase') return;
    const sb = getSupabaseClient();
    if (!sb) return;

    const { data: authSub } = sb.auth.onAuthStateChange(() => {
      qc.invalidateQueries();
      setLastSyncedAt(new Date().toISOString());
    });

    if (!companyId) {
      return () => {
        authSub.subscription.unsubscribe();
      };
    }

    const channel = sb
      .channel(`finops-app2-${companyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sales_documents', filter: `company_id=eq.${companyId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['finops'] });
          setLastSyncedAt(new Date().toISOString());
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sales_lines' },
        () => {
          qc.invalidateQueries({ queryKey: ['finops'] });
          setLastSyncedAt(new Date().toISOString());
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payment_allocations', filter: `company_id=eq.${companyId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['finops'] });
          setLastSyncedAt(new Date().toISOString());
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reconciliation_reviews', filter: `company_id=eq.${companyId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['finops'] });
          setLastSyncedAt(new Date().toISOString());
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'receipts', filter: `company_id=eq.${companyId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['finops'] });
          setLastSyncedAt(new Date().toISOString());
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'discrepancy_cases', filter: `company_id=eq.${companyId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['finops'] });
          setLastSyncedAt(new Date().toISOString());
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'accounting_events', filter: `company_id=eq.${companyId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['finops'] });
          setLastSyncedAt(new Date().toISOString());
        }
      )
      .subscribe();

    return () => {
      authSub.subscription.unsubscribe();
      sb.removeChannel(channel);
    };
  }, [mode, companyId, qc]);

  const effectiveBranchId = session?.allBranches
    ? activeBranchFilter || null
    : session?.branchId || null;

  // Shared domain queries
  const settingsQuery = useQuery({
    queryKey: ['finops', mode, 'settings', companyId],
    enabled: Boolean(gateway && hasActiveCompany),
    queryFn: () => gateway!.getSettings(companyId),
  });

  const branchesQuery = useQuery({
    queryKey: ['finops', mode, 'branches', companyId],
    enabled: Boolean(gateway && hasActiveCompany),
    queryFn: () => gateway!.getBranches(companyId),
  });

  const summaryQuery = useQuery({
    queryKey: ['finops', mode, 'summary', companyId, effectiveBranchId, session?.userId],
    enabled: Boolean(gateway && hasActiveCompany),
    refetchInterval: mode === 'live_supabase' ? 60_000 : false,
    queryFn: () => gateway!.getDashboardSummary(companyId, effectiveBranchId),
  });

  const recapQuery = useQuery({
    queryKey: ['finops', mode, 'recap', companyId, effectiveBranchId, cutoffDate, includeArchive, session?.userId],
    enabled: Boolean(gateway && hasActiveCompany),
    queryFn: () =>
      gateway!.getSalesRecap({
        companyId,
        branchId: effectiveBranchId,
        cutoffDate: cutoffDate || null,
        includeArchive,
      }),
  });

  const archiveRecapQuery = useQuery({
    queryKey: ['finops', mode, 'archive_recap', companyId, effectiveBranchId, session?.userId],
    enabled: Boolean(gateway && hasActiveCompany && activeRoute === 'impor'),
    queryFn: () =>
      gateway!.getSalesRecap({
        companyId,
        branchId: effectiveBranchId,
        includeArchive: true,
      }),
  });

  const receiptsQuery = useQuery({
    queryKey: ['finops', mode, 'receipts', companyId, effectiveBranchId, session?.userId],
    enabled: Boolean(gateway && hasActiveCompany),
    queryFn: () => gateway!.getAllocatableReceipts(companyId, effectiveBranchId),
  });

  const allocationsQuery = useQuery({
    queryKey: ['finops', mode, 'allocations', companyId, session?.userId],
    enabled: Boolean(gateway && hasActiveCompany),
    queryFn: () => gateway!.getAllocations(companyId),
  });

  const receivablesQuery = useQuery({
    queryKey: ['finops', mode, 'receivables', companyId, arAsOfDate, effectiveBranchId, session?.userId],
    enabled: Boolean(gateway && hasActiveCompany),
    queryFn: () => gateway!.getCustomerReceivables(companyId, arAsOfDate, effectiveBranchId),
  });

  const reconQueueQuery = useQuery({
    queryKey: ['finops', mode, 'recon_queue', companyId, session?.userId],
    enabled: Boolean(gateway && hasActiveCompany),
    queryFn: () => gateway!.getReconciliationQueue(companyId),
  });

  const discrepanciesQuery = useQuery({
    queryKey: ['finops', mode, 'discrepancies', companyId, session?.userId],
    enabled: Boolean(gateway && hasActiveCompany),
    queryFn: () => gateway!.getDiscrepancyCases(companyId),
  });

  const accountingEventsQuery = useQuery({
    queryKey: ['finops', mode, 'accounting_events', companyId, session?.userId],
    enabled: Boolean(gateway && hasActiveCompany),
    queryFn: () => gateway!.getAccountingEvents(companyId),
  });

  const importBatchesQuery = useQuery({
    queryKey: ['finops', mode, 'import_batches', companyId, session?.userId],
    enabled: Boolean(gateway && hasActiveCompany),
    queryFn: () => gateway!.getImportBatches(companyId),
  });

  const customersQuery = useQuery({
    queryKey: ['finops', mode, 'customers', companyId, session?.userId],
    enabled: Boolean(gateway && hasActiveCompany),
    queryFn: () => gateway!.getCustomers(companyId),
  });

  const aliasesQuery = useQuery({
    queryKey: ['finops', mode, 'aliases', companyId, session?.userId],
    enabled: Boolean(gateway && hasActiveCompany),
    queryFn: () => gateway!.getAliases(companyId),
  });

  const productsQuery = useQuery({
    queryKey: ['finops', mode, 'products', companyId, session?.userId],
    enabled: Boolean(gateway && hasActiveCompany),
    queryFn: () => gateway!.getProducts(companyId),
  });

  const staffQuery = useQuery({
    queryKey: ['finops', mode, 'staff', companyId, session?.userId],
    enabled: Boolean(gateway && hasActiveCompany),
    queryFn: () => gateway!.getStaff(companyId),
  });

  const taxCodesQuery = useQuery({
    queryKey: ['finops', mode, 'tax_codes', companyId, session?.userId],
    enabled: Boolean(gateway && hasActiveCompany),
    queryFn: () => gateway!.getTaxCodes(companyId),
  });

  const invalidateAll = async () => {
    await qc.invalidateQueries({ queryKey: ['finops'] });
    setLastSyncedAt(new Date().toISOString());
  };

  const handleSwitchDemoRole = async (nextUserId: string) => {
    demoGateway.switchDemoUser(nextUserId);
    setDemoUserId(nextUserId);
    setActiveBranchFilter('');
    await qc.invalidateQueries();
    setLastSyncedAt(new Date().toISOString());
  };

  const handleEnterDemo = () => {
    demoGateway.switchDemoUser(demoUserId);
    setMode('demo_isolated');
    setActiveRoute('ringkasan');
    qc.invalidateQueries();
    setLastSyncedAt(new Date().toISOString());
  };

  const handleExitDemo = () => {
    setMode(getInitialOperationMode());
    setSelectedNotaId(null);
    setNewNotaOpen(false);
    qc.invalidateQueries();
  };

  const handleLiveLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const sb = getSupabaseClient();
    if (!sb) return;
    setAuthError(null);
    setAuthLoading(true);
    try {
      const { error } = await sb.auth.signInWithPassword({
        email: authEmail.trim(),
        password: authPassword,
      });
      if (error) throw error;
      await qc.invalidateQueries();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Gagal masuk ke Supabase.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLiveLogout = async () => {
    const sb = getSupabaseClient();
    if (sb) {
      await sb.auth.signOut();
    }
    setSelectedNotaId(null);
    qc.clear();
  };

  // STATE 1: Setup Required (No Supabase env vars & user hasn't entered Demo)
  if (mode === 'setup_required') {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
        <header className="bg-slate-900 text-white border-b border-slate-800">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-teal-400 font-semibold">
                FINOPS_SHARED_V1 &bull; App 2
              </div>
              <h1 className="text-lg font-semibold tracking-tight">
                Penjualan &amp; Rekonsiliasi
              </h1>
            </div>
            <button
              type="button"
              onClick={handleEnterDemo}
              className="px-3.5 py-2 rounded-md bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold"
            >
              Masuk Mode Demo Terisolasi (Data Sintetis)
            </button>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
          <div className="bg-amber-50 border border-amber-300 rounded-md p-4 flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-semibold text-amber-950">
                  Variabel Koneksi Supabase Bersama Belum Dikonfigurasi
                </h2>
                <p className="text-xs text-amber-900 mt-1 max-w-3xl">
                  Aplikasi tidak menyambungkan data contoh secara diam-diam ke mode produksi. Isi{' '}
                  <code className="font-mono bg-amber-100 px-1 rounded">VITE_SUPABASE_URL</code> dan{' '}
                  <code className="font-mono bg-amber-100 px-1 rounded">VITE_SUPABASE_PUBLISHABLE_KEY</code>{' '}
                  pada file <code className="font-mono bg-amber-100 px-1 rounded">.env.local</code> (menggunakan proyek Supabase yang sama dengan App 1) serta terapkan migrasi{' '}
                  <code className="font-mono bg-amber-100 px-1 rounded">0005</code> &amp;{' '}
                  <code className="font-mono bg-amber-100 px-1 rounded">0006</code>. Atau gunakan tombol di bawah untuk mengevaluasi seluruh alur kerja dalam Mode Demo Terisolasi.
                </p>
              </div>
            </div>
          </div>

          <SetupDanUatView mode={mode} onEnterDemoMode={handleEnterDemo} />
        </main>
      </div>
    );
  }

  // STATE 2: Live Supabase configured, waiting for authentication
  if (mode === 'live_supabase' && !sessionQuery.isLoading && !session) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-md p-6 shadow-sm">
          <div className="border-b border-slate-200 pb-4 mb-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-teal-700">
              FINOPS_SHARED_V1 &bull; App 2
            </div>
            <h1 className="text-xl font-semibold text-slate-900 mt-1">
              Penjualan &amp; Rekonsiliasi
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Masuk menggunakan akun Supabase Auth Anda. Hak akses cabang dan role ditentukan sepenuhnya oleh tabel <code className="font-mono">memberships</code> dan RLS PostgreSQL.
            </p>
          </div>

          {authError && (
            <div className="mb-4 p-3 rounded border border-rose-200 bg-rose-50 text-xs text-rose-800">
              {authError}
            </div>
          )}

          <form onSubmit={handleLiveLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                required
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="nama@perusahaan.co.id"
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-teal-700"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Kata Sandi</label>
              <input
                type="password"
                required
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-teal-700"
              />
            </div>
            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-2.5 px-4 rounded-md bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold disabled:opacity-50"
            >
              {authLoading ? 'Memverifikasi Sesi...' : 'Masuk ke Workspace'}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
            <span>Butuh simulasi tanpa database?</span>
            <button
              type="button"
              onClick={handleEnterDemo}
              className="font-semibold text-slate-800 hover:text-teal-700 underline"
            >
              Buka Mode Demo Terisolasi
            </button>
          </div>
        </div>
      </div>
    );
  }

  // STATE 2B: Authenticated user in Live Supabase has NO active company membership
  if (mode === 'live_supabase' && session && !hasActiveCompany) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
        <div className="max-w-lg w-full bg-white border border-slate-200 rounded-md p-6">
          <div className="flex items-center gap-2 text-rose-700 mb-2">
            <ShieldAlert className="w-5 h-5" />
            <h2 className="text-base font-semibold">Akun Belum Memiliki Membership Perusahaan</h2>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Anda masuk sebagai <span className="font-mono font-semibold">{session.email}</span>, tetapi tidak ditemukan baris aktif pada tabel <code className="font-mono">memberships</code>. Hubungi System Admin untuk memberikan akses perusahaan, cabang, dan role.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={handleLiveLogout}
              className="px-3 py-2 rounded border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Keluar
            </button>
          </div>
        </div>
      </div>
    );
  }

  const canViewHpp = Boolean(
    session?.roles.some((r) =>
      [
        'accountant',
        'accounting_approver',
        'reconciliation_reviewer',
        'finance_checker',
        'owner_viewer',
        'system_admin',
      ].includes(r)
    )
  );

  const canCreateNota = Boolean(
    session?.roles.some((r) => ['sales_admin', 'reconciliation_reviewer'].includes(r))
  );

  const settings = settingsQuery.data ?? {
    app1Url: null,
    app2Url: null,
    app3Url: null,
    reconciliationLabel: 'REKONSILIASI (ALMIRA)',
    roundingScale: 0,
  };

  const branches = branchesQuery.data ?? [];
  const summary = summaryQuery.data ?? {
    salesByDeliveryAmount: '0.00',
    salesDocCount: 0,
    openReceivableAmount: '0.00',
    openReceivableCount: 0,
    waitingVerificationReceiptAmount: '0.00',
    waitingVerificationReceiptCount: 0,
    availableVerifiedReceiptAmount: '0.00',
    availableVerifiedReceiptCount: 0,
    needsReviewCount: 0,
    openDiscrepancyCount: 0,
    pendingAccountingEventsCount: 0,
    pendingAllocationProposalCount: 0,
  };

  const activeNav = NAV_ITEMS.find((n) => n.key === activeRoute) ?? NAV_ITEMS[0];

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full bg-slate-900 text-slate-200">
      <div className="px-4 py-4 border-b border-slate-800">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-teal-400">
          FINOPS_SHARED_V1 &bull; APP 2
        </div>
        <div className="text-sm font-semibold text-white mt-0.5 leading-snug">
          Penjualan &amp; Rekonsiliasi
        </div>
        <div className="text-[11px] text-slate-400 mt-1 truncate">
          {session?.companyName || 'Memuat perusahaan...'}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-0.5 thin-scrollbar">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeRoute === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setActiveRoute(item.key);
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-colors text-left ${
                isActive
                  ? 'bg-teal-700 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Cross-app links & user info */}
      <div className="p-3 border-t border-slate-800 space-y-2.5 text-xs">
        {(settings.app1Url || settings.app3Url) && (
          <div className="space-y-1 pb-2 border-b border-slate-800">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Aplikasi Terhubung
            </div>
            {settings.app1Url && (
              <a
                href={settings.app1Url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between text-slate-300 hover:text-white py-1"
              >
                <span>App 1: Penerimaan &amp; Setoran</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {settings.app3Url && (
              <a
                href={settings.app3Url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between text-slate-300 hover:text-white py-1"
              >
                <span>App 3: Akuntansi &amp; GL</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}

        <div className="bg-slate-800/70 rounded p-2.5">
          <div className="font-semibold text-white truncate">{session?.fullName}</div>
          <div className="text-[11px] text-slate-400 truncate">{session?.email}</div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {(session?.roles.length ? session.roles : ['no_role']).map((r) => (
              <span
                key={r}
                className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-200"
              >
                {r}
              </span>
            ))}
          </div>
          {mode === 'demo_isolated' && (
            <div className="mt-2.5 pt-2 border-t border-slate-700">
              <label className="block text-[10px] uppercase tracking-wider text-slate-400 mb-1">
                Ganti Role Demo
              </label>
              <select
                value={demoUserId}
                onChange={(e) => void handleSwitchDemoRole(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 text-slate-100 rounded px-2 py-1 text-[11px]"
              >
                {demoGateway.getDemoUsers().map((u) => (
                  <option key={u.userId} value={u.userId}>
                    {u.fullName}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {mode === 'live_supabase' && (
          <button
            type="button"
            onClick={handleLiveLogout}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded border border-slate-700 hover:bg-slate-800 text-slate-300"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Keluar Sesi</span>
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col">
      {/* Permanent Isolated Demo Banner */}
      {mode === 'demo_isolated' && (
        <div className="bg-amber-950 text-amber-100 border-b border-amber-800 px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-2 z-30">
          <div className="flex items-center gap-2 font-semibold">
            <BookOpenCheck className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              MODE DEMO TERISOLASI — DATA SINTETIS (TIDAK TERHUBUNG KE DATABASE PRODUKSI)
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[11px] text-amber-200">Uji Peran:</label>
            <select
              value={demoUserId}
              onChange={(e) => void handleSwitchDemoRole(e.target.value)}
              className="bg-amber-900 border border-amber-700 text-white rounded px-2 py-1 text-xs"
            >
              {demoGateway.getDemoUsers().map((u) => (
                <option key={u.userId} value={u.userId}>
                  {u.fullName} ({u.roles.join(', ') || 'tanpa role'})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleExitDemo}
              className="px-2.5 py-1 rounded bg-amber-800 hover:bg-amber-700 text-white text-[11px] font-medium"
            >
              Keluar Demo
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:block w-64 shrink-0 border-r border-slate-800">
          {renderSidebarContent()}
        </aside>

        {/* Mobile Drawer Sidebar */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-40 lg:hidden flex">
            <div className="w-64 h-full">{renderSidebarContent()}</div>
            <div
              className="flex-1 bg-slate-900/50"
              onClick={() => setMobileMenuOpen(false)}
            />
          </div>
        )}

        {/* Main Workspace */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top Operational Header */}
          <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden p-1.5 rounded border border-slate-300 text-slate-700"
                aria-label="Buka menu"
              >
                {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
              </button>
              <div>
                <h1 className="text-base sm:text-lg font-semibold text-slate-900 leading-tight">
                  {activeNav.label}
                </h1>
                <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-2 mt-0.5">
                  <span>{session?.companyName}</span>
                  <span>&bull;</span>
                  <span>
                    {session?.allBranches
                      ? branches.find((b) => b.id === activeBranchFilter)?.name || 'Semua Cabang'
                      : session?.branchName}
                  </span>
                  <span>&bull;</span>
                  <span className="font-mono">Sinkron: {formatDateTimeJakarta(lastSyncedAt)}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {session?.allBranches && branches.length > 1 && (
                <select
                  value={activeBranchFilter}
                  onChange={(e) => setActiveBranchFilter(e.target.value)}
                  className="border border-slate-300 rounded-md px-2.5 py-1.5 text-xs bg-white text-slate-800"
                >
                  <option value="">Semua Cabang</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} — {b.name}
                    </option>
                  ))}
                </select>
              )}

              <button
                type="button"
                onClick={invalidateAll}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Muat Ulang</span>
              </button>

              {canCreateNota && (
                <button
                  type="button"
                  onClick={() => setNewNotaOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Buat Nota</span>
                </button>
              )}
            </div>
          </header>

          {/* View Body */}
          <main className="flex-1 p-4 sm:p-6 overflow-y-auto">
            {session && session.roles.length === 0 && (
              <div className="mb-4 bg-rose-50 border border-rose-200 rounded-md p-3.5 flex items-center gap-2 text-xs text-rose-800">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>
                  Akun aktif saat ini tidak memiliki role operasional (<code className="font-mono">roles = []</code>). Semua operasi baca/tulis dibatasi oleh RLS dan guard backend.
                </span>
              </div>
            )}

            {activeRoute === 'ringkasan' && (
              <RingkasanPenjualanView
                summary={summary}
                discrepancies={discrepanciesQuery.data ?? []}
                accountingEvents={accountingEventsQuery.data ?? []}
                onNavigate={setActiveRoute}
                onOpenNewNota={() => setNewNotaOpen(true)}
              />
            )}

            {activeRoute === 'rekap' && (
              <RekapPenjualanView
                rows={recapQuery.data ?? []}
                loading={recapQuery.isLoading}
                branches={branches}
                staffList={staffQuery.data ?? []}
                cutoffDate={cutoffDate}
                onCutoffDateChange={setCutoffDate}
                includeArchive={includeArchive}
                onIncludeArchiveChange={setIncludeArchive}
                onSelectDocument={setSelectedNotaId}
                onOpenNewNota={() => setNewNotaOpen(true)}
                onGoToImport={() => setActiveRoute('impor')}
              />
            )}

            {activeRoute === 'nota' && (
              <NotaDaftarView
                rows={recapQuery.data ?? []}
                onSelectDocument={setSelectedNotaId}
                onOpenNewNota={() => setNewNotaOpen(true)}
              />
            )}

            {activeRoute === 'pencocokan' && session && (
              <PencocokanPembayaranView
                session={session}
                customers={customersQuery.data ?? []}
                receipts={receiptsQuery.data ?? []}
                recapRows={recapQuery.data ?? []}
                allocations={allocationsQuery.data ?? []}
                onProposeAllocation={async (branchId, items) => {
                  await gateway!.proposePaymentAllocation({ companyId, branchId, items });
                  await invalidateAll();
                }}
                onApproveAllocation={async (allocationIds, notes) => {
                  await gateway!.approvePaymentAllocation(allocationIds, notes);
                  await invalidateAll();
                }}
                onReverseAllocation={async (allocationId, expectedVersion, reason) => {
                  await gateway!.reversePaymentAllocation(allocationId, expectedVersion, reason);
                  await invalidateAll();
                }}
                onSelectDocument={setSelectedNotaId}
              />
            )}

            {activeRoute === 'almira' && session && (
              <RekonsiliasiAlmiraView
                session={session}
                settings={settings}
                queue={reconQueueQuery.data ?? []}
                onSaveReview={async (params) => {
                  await gateway!.saveReconciliationReview({ companyId, ...params });
                  await invalidateAll();
                }}
                onSelectDocument={setSelectedNotaId}
              />
            )}

            {activeRoute === 'piutang' && (
              <PiutangPelangganView
                asOfDate={arAsOfDate}
                onAsOfDateChange={setArAsOfDate}
                receivables={receivablesQuery.data ?? []}
                recapRows={recapQuery.data ?? []}
                onSelectDocument={setSelectedNotaId}
              />
            )}

            {activeRoute === 'impor' && session && (
              <ImporArsipView
                session={session}
                branches={branches}
                customers={customersQuery.data ?? []}
                aliases={aliasesQuery.data ?? []}
                products={productsQuery.data ?? []}
                staffList={staffQuery.data ?? []}
                batches={importBatchesQuery.data ?? []}
                archiveRows={(archiveRecapQuery.data ?? []).filter((r) => r.isLegacyArchive)}
                onCommitImport={async (params) => {
                  const res = await gateway!.commitSalesImport({ companyId, ...params });
                  await invalidateAll();
                  return res;
                }}
                onQuickAddCustomer={async (branchId, custId, name) => {
                  await gateway!.upsertCustomer({ companyId, branchId, custId, name });
                  await invalidateAll();
                }}
                onQuickAddProduct={async (sku, name, unitCode) => {
                  await gateway!.upsertProduct({
                    companyId,
                    sku,
                    name,
                    baseUnit: unitCode,
                    isStocked: false,
                  });
                  await invalidateAll();
                }}
                onSelectDocument={setSelectedNotaId}
              />
            )}

            {activeRoute === 'master' && session && (
              <MasterDataView
                session={session}
                branches={branches}
                customers={customersQuery.data ?? []}
                aliases={aliasesQuery.data ?? []}
                products={productsQuery.data ?? []}
                staff={staffQuery.data ?? []}
                canViewHpp={canViewHpp}
                onUpsertCustomer={async (payload) => {
                  await gateway!.upsertCustomer({ companyId, ...payload });
                  await invalidateAll();
                }}
                onUpsertAlias={async (customerId, aliasName, bankHint) => {
                  await gateway!.upsertCustomerAlias(companyId, customerId, aliasName, bankHint);
                  await invalidateAll();
                }}
                onUpsertProduct={async (payload) => {
                  await gateway!.upsertProduct({ companyId, ...payload });
                  await invalidateAll();
                }}
              />
            )}

            {activeRoute === 'setup_uat' && (
              <SetupDanUatView
                mode={mode}
                accountingEvents={accountingEventsQuery.data ?? []}
                onEnterDemoMode={handleEnterDemo}
                onExitDemoMode={handleExitDemo}
              />
            )}
          </main>
        </div>
      </div>

      {/* Modal Buat Nota Baru */}
      {session && newNotaOpen && (
        <NotaFormModal
          isOpen={newNotaOpen}
          onClose={() => setNewNotaOpen(false)}
          session={session}
          branches={branches}
          customers={customersQuery.data ?? []}
          products={productsQuery.data ?? []}
          staffList={staffQuery.data ?? []}
          taxCodes={taxCodesQuery.data ?? []}
          onSubmitDraft={async (payload) => {
            const created = await gateway!.draftSale({
              companyId,
              branchId: payload.branchId,
              customerId: payload.customerId,
              salesStaffId: payload.salesStaffId,
              invoiceDate: payload.invoiceDate,
              deliveryDate: payload.deliveryDate,
              dueDate: payload.dueDate,
              plannedPaymentMethod: payload.plannedPaymentMethod,
              taxBasis: payload.taxBasis,
              taxCodeId: payload.taxCodeId,
              sourceInvoiceNo: payload.sourceInvoiceNo,
              notes: payload.notes,
              lines: payload.lines,
            });
            if (payload.submitImmediately) {
              await gateway!.submitSale(created.salesDocumentId, 1);
            }
            await invalidateAll();
            setSelectedNotaId(created.salesDocumentId);
          }}
        />
      )}

      {/* Drawer Detail Nota, Persetujuan/Rilis, Nota Kredit & Catatan */}
      {session && (
        <NotaDetailDrawer
          salesDocumentId={selectedNotaId}
          onClose={() => setSelectedNotaId(null)}
          session={session}
          loadDetail={(id) => gateway!.getSalesDocumentDetail(id)}
          onSubmitSale={async (id, version) => {
            await gateway!.submitSale(id, version);
            await invalidateAll();
          }}
          onApproveAndRelease={async (id, version, deliveryDate, note) => {
            await gateway!.approveAndReleaseSale({
              salesDocumentId: id,
              expectedVersion: version,
              confirmedDeliveryDate: deliveryDate,
              approvalNote: note,
            });
            await invalidateAll();
          }}
          onIssueCreditNote={async (origId, issueDate, reason, lines) => {
            await gateway!.issueSalesCreditNote({
              originalSalesDocumentId: origId,
              issueDate,
              reason,
              lines,
            });
            await invalidateAll();
          }}
          onAppendNote={async (id, note) => {
            await gateway!.appendSalesNote(id, note);
            await invalidateAll();
          }}
        />
      )}
    </div>
  );
}

export default App;
