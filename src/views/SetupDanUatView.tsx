import React, { useState } from 'react';
import { CheckCircle2, Database, Play, ShieldCheck, Terminal, XCircle } from 'lucide-react';
import { runDomainUatSuite } from '../engine/demoLedgerEngine';
import { formatDateTimeJakarta } from '../lib/dates';
import { getSupabaseConfigStatus } from '../lib/supabase';
import type { AppOperationMode } from '../services/finopsService';
import type { AccountingEventItem, UatTestResult } from '../types/app';
import { AccountingStatusBadge } from '../components/StatusBadges';

interface SetupDanUatViewProps {
  mode: AppOperationMode;
  accountingEvents?: AccountingEventItem[];
  onEnterDemoMode?: () => void;
  onExitDemoMode?: () => void;
}

export function SetupDanUatView({
  mode,
  accountingEvents = [],
  onEnterDemoMode,
  onExitDemoMode,
}: SetupDanUatViewProps) {
  const sbStatus = getSupabaseConfigStatus();
  const [uatResults, setUatResults] = useState<UatTestResult[] | null>(null);

  const handleRunUat = () => {
    const res = runDomainUatSuite();
    setUatResults(res);
  };

  const passedCount = uatResults ? uatResults.filter((r) => r.passed).length : 0;

  return (
    <div className="space-y-4">
      {/* Status Konfigurasi & Koneksi */}
      <div className="bg-white border border-slate-200 rounded-md p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-teal-700" />
              <h2 className="text-base font-semibold text-slate-900">
                Status Layanan Supabase Bersama & Kompatibilitas FINOPS_SHARED_V1
              </h2>
            </div>
            <p className="text-xs text-slate-600 mt-1 max-w-2xl">
              App 2 (Penjualan &amp; Rekonsiliasi) terhubung ke proyek Supabase dan database PostgreSQL yang sama dengan App 1 (Penerimaan &amp; Setoran) melalui skema bersama <code className="font-mono">FINOPS_SHARED_V1</code>.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {mode !== 'demo_isolated' && onEnterDemoMode && (
              <button
                type="button"
                onClick={onEnterDemoMode}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md bg-slate-900 hover:bg-slate-800 text-white"
              >
                Masuk Mode Demo Terisolasi (Data Sintetis)
              </button>
            )}
            {mode === 'demo_isolated' && onExitDemoMode && (
              <button
                type="button"
                onClick={onExitDemoMode}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
              >
                Keluar Mode Demo
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
          <div className="border border-slate-200 rounded-md p-3 bg-slate-50">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Variabel Lingkungan Client
            </div>
            <div className="mt-1.5 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-mono text-slate-700">VITE_SUPABASE_URL</span>
                <span className={sbStatus.hasUrl ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>
                  {sbStatus.hasUrl ? sbStatus.urlPreview : 'Belum diatur'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-slate-700">VITE_SUPABASE_PUBLISHABLE_KEY</span>
                <span className={sbStatus.hasKey ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>
                  {sbStatus.hasKey ? 'Tersedia' : 'Belum diatur'}
                </span>
              </div>
            </div>
          </div>

          <div className="border border-slate-200 rounded-md p-3 bg-slate-50">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Mode Operasi Saat Ini
            </div>
            <div className="mt-1.5 text-sm font-semibold text-slate-900">
              {mode === 'live_supabase'
                ? 'Terhubung ke Supabase Bersama (Live)'
                : mode === 'demo_isolated'
                  ? 'Mode Demo Terisolasi (Data Sintetis)'
                  : 'Menunggu Konfigurasi Supabase'}
            </div>
            <div className="text-xs text-slate-600 mt-0.5">
              {mode === 'live_supabase'
                ? 'Autentikasi JWT + RLS + Realtime aktif.'
                : 'Tidak ada koneksi atau penulisan ke database produksi.'}
            </div>
          </div>

          <div className="border border-slate-200 rounded-md p-3 bg-slate-50">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Migrasi SQL Aditif App 2
            </div>
            <div className="mt-1.5 text-xs text-slate-700 space-y-1 font-mono">
              <div>0005_finops_app2_schema_and_rls.sql</div>
              <div>0006_finops_app2_rpcs_and_views.sql</div>
            </div>
          </div>
        </div>

        {/* Checklist Kompatibilitas App 1 -> App 2 */}
        <div className="mt-4 border border-slate-200 rounded-md p-3.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 mb-2">
            <ShieldCheck className="w-4 h-4 text-teal-700" />
            <span>Ringkasan Audit Kompatibilitas Skema App 1 &rarr; App 2</span>
          </div>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-slate-700 list-disc pl-4">
            <li>
              <strong>Aditif Tanpa Fork:</strong> Menggunakan ulang <code className="font-mono">receipts</code>,{' '}
              <code className="font-mono">customers</code>, <code className="font-mono">sales_documents</code>,{' '}
              <code className="font-mono">payment_allocations</code>, dan <code className="font-mono">accounting_events</code> dari migrasi 0001–0004.
            </li>
            <li>
              <strong>Perbaikan Kebijakan SELECT RLS (0005):</strong> Menutup celah migrasi 0002 di mana tabel seperti{' '}
              <code className="font-mono">products</code>, <code className="font-mono">sales_lines</code>, dan{' '}
              <code className="font-mono">reconciliation_reviews</code> terkunci oleh FORCE RLS tanpa policy SELECT.
            </li>
            <li>
              <strong>Proteksi HPP &amp; Stok:</strong> Tabel <code className="font-mono">inventory_valuations</code> &amp;{' '}
              <code className="font-mono">inventory_movements</code> hanya dibuka untuk role non-sales-admin yang berhak.
            </li>
            <li>
              <strong>Anti Double-Join &amp; 12 RPC Resmi:</strong> View <code className="font-mono">v_app2_document_balances</code> mengagregasi alokasi dan nota kredit secara terpisah sebelum join 1:1 ke baris nota.
            </li>
          </ul>
        </div>
      </div>

      {/* Outbox Akuntansi App 3 */}
      {accountingEvents.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Outbox Event Akuntansi (Integrasi ke App 3)
              </h3>
              <p className="text-xs text-slate-500">
                Status awal <code className="font-mono">waiting_accounting_module</code> atau <code className="font-mono">queued</code> bersifat jujur hingga App 3 memposting jurnal.
              </p>
            </div>
            <span className="font-mono text-xs text-slate-500">{accountingEvents.length} event terbaru</span>
          </div>
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 uppercase text-slate-500 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2">Waktu Dibuat</th>
                  <th className="text-left px-3 py-2">Tipe Event</th>
                  <th className="text-left px-3 py-2">Tanggal Efektif</th>
                  <th className="text-left px-3 py-2">Sumber</th>
                  <th className="text-left px-3 py-2">Status Posting</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {accountingEvents.slice(0, 20).map((ev) => (
                  <tr key={ev.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-600">{formatDateTimeJakarta(ev.createdAt)}</td>
                    <td className="px-3 py-2 font-mono font-semibold text-slate-900">{ev.eventType}</td>
                    <td className="px-3 py-2 font-mono text-slate-700">{ev.effectiveDate}</td>
                    <td className="px-3 py-2 font-mono text-slate-600">
                      {ev.sourceType} (v{ev.sourceVersion})
                    </td>
                    <td className="px-3 py-2">
                      <AccountingStatusBadge status={ev.processingStatus as 'not_ready'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Automated UAT Runner (UAT-01 .. UAT-11) */}
      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-teal-700" />
              <h3 className="text-sm font-semibold text-slate-900">
                Verifikasi Otomatis UAT Domain (UAT-01 s/d UAT-11)
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Menguji seluruh aturan bisnis inti (alokasi 1:N &amp; M:1, kas di penagih, arsip legacy, pembalikan alokasi, nota kredit, review kredit, idempotensi file, cut-off Nov/Des, RLS/maker-checker, dan pemblokiran HPP kosong) secara deterministik di sandbox terisolasi.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {uatResults && (
              <span
                className={`px-2.5 py-1 text-xs font-semibold rounded border ${
                  passedCount === uatResults.length
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border-rose-200 text-rose-800'
                }`}
              >
                {passedCount}/{uatResults.length} LULUS
              </span>
            )}
            <button
              type="button"
              onClick={handleRunUat}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md bg-teal-700 hover:bg-teal-800 text-white"
            >
              <Play className="w-3.5 h-3.5" />
              Jalankan Semua Uji UAT
            </button>
          </div>
        </div>

        {uatResults ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 uppercase text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2.5 w-20">Kode</th>
                  <th className="text-left px-3 py-2.5">Skenario Uji</th>
                  <th className="text-left px-3 py-2.5">Ekspektasi</th>
                  <th className="text-left px-3 py-2.5">Hasil Aktual</th>
                  <th className="text-center px-3 py-2.5 w-24">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {uatResults.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-mono font-semibold text-slate-900">{r.id}</td>
                    <td className="px-3 py-2.5 text-slate-900 font-medium">{r.title}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-600">{r.expected}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-800">{r.actual}</td>
                    <td className="px-3 py-2.5 text-center">
                      {r.passed ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border bg-emerald-50 border-emerald-200 text-emerald-700 font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          LULUS
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border bg-rose-50 border-rose-200 text-rose-700 font-semibold">
                          <XCircle className="w-3.5 h-3.5" />
                          GAGAL
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-xs text-slate-500">
            Klik &ldquo;Jalankan Semua Uji UAT&rdquo; untuk menjalankan skenario UAT-01 sampai UAT-11 dan melihat hasil ekspektasi vs aktual.
          </div>
        )}
      </div>
    </div>
  );
}
