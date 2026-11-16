import * as XLSX from 'xlsx';
import { computeISOWeek, computeMonthCode, formatDateID, parseExplicitDate, type ExplicitDateFormat } from './dates';
import { mulDec, parseLocalizedDecimal, roundHalfUp, toDec } from './decimal';
import type { CustomerAlias, ImportRowPreview, MasterCustomer, MasterProduct, MasterStaff, SalesRecapRow } from '../types/app';

export const CORE_14_HEADERS = [
  'DELIVERY DATE',
  'WEEK',
  'MONTH',
  'CUST ID',
  'CUST NAME',
  'PRODUCT',
  'QTY',
  'NET PRICE',
  'TOTAL SALES',
  'SALES NAME',
  'METODE PEMBAYARAN',
  'STATUS PEMBAYARAN',
  'KETERANGAN',
  'REKONSILIASI (ALMIRA)',
] as const;

export const EXTENDED_HEADERS = [
  ...CORE_14_HEADERS,
  'NOMOR NOTA',
  'ID BARIS SUMBER',
  'TANGGAL JATUH TEMPO',
  'KODE PRODUK',
  'SATUAN',
] as const;

export async function sha256Hex(buffer: ArrayBuffer | string): Promise<string> {
  const bytes = typeof buffer === 'string' ? new TextEncoder().encode(buffer) : new Uint8Array(buffer);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Deterministic fallback hash for non-HTTPS contexts
  let h1 = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h1 ^= bytes[i];
    h1 = Math.imul(h1, 0x01000193);
  }
  return `fnv-${(h1 >>> 0).toString(16).padStart(8, '0')}-${bytes.length}`;
}

export function downloadTemplateWorkbook(extended: boolean) {
  const headers = extended ? [...EXTENDED_HEADERS] : [...CORE_14_HEADERS];
  const sampleRow = extended
    ? [
        '16/11/2026',
        '2026-W47',
        '2026-11',
        '00104',
        'Toko Sumber Makmur',
        'Beras Premium 5kg',
        10,
        72000,
        720000,
        'Budi Santoso',
        'Transfer',
        'Belum Dibayar',
        'Pengiriman pagi rute utara',
        'Belum Diperiksa',
        'INV-EXT-1001',
        'LINE-01',
        '16/12/2026',
        'BRS-05',
        'SAK',
      ]
    : [
        '16/11/2026',
        '2026-W47',
        '2026-11',
        '00104',
        'Toko Sumber Makmur',
        'Beras Premium 5kg',
        10,
        72000,
        720000,
        'Budi Santoso',
        'Transfer',
        'Belum Dibayar',
        'Pengiriman pagi rute utara',
        'Belum Diperiksa',
      ];

  const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
  // Ensure CUST ID column stays text so leading zeros are preserved
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length + 4, 14) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Rekap Penjualan');
  const filename = extended ? 'template_rekap_penjualan_diperluas.xlsx' : 'template_rekap_14_kolom_asli.xlsx';
  XLSX.writeFile(wb, filename);
}

export function exportSalesRecapWorkbook(
  rows: SalesRecapRow[],
  mode: 'operational' | 'legacy_source',
  format: 'xlsx' | 'csv'
) {
  const statusLabel = (s: string) => {
    if (s === 'paid') return 'Lunas';
    if (s === 'partially_paid') return 'Dibayar Sebagian';
    if (s === 'overpaid') return 'Lebih Bayar';
    return 'Belum Dibayar';
  };
  const reconLabel = (s: string) => {
    if (s === 'matched') return 'Cocok';
    if (s === 'needs_review') return 'Perlu Ditinjau';
    if (s === 'discrepancy') return 'Selisih';
    if (s === 'reviewed') return 'Selesai';
    return 'Belum Diperiksa';
  };

  const aoa: unknown[][] = [[
    ...CORE_14_HEADERS,
    'NOMOR NOTA',
    'TAGIHAN NETO DOKUMEN',
    'TERBAYAR DOKUMEN',
    'SISA PIUTANG DOKUMEN',
    'SALDO TITIPAN PELANGGAN',
    'STATUS JURNAL',
    'SUMBER DATA',
  ]];

  for (const r of rows) {
    const legacy = (r.legacySourceData || {}) as Record<string, string>;
    const metode = mode === 'legacy_source' && legacy.legacy_method ? legacy.legacy_method : r.metodePembayaran;
    const status = mode === 'legacy_source' && legacy.legacy_status ? legacy.legacy_status : statusLabel(r.statusPembayaran);
    const recon =
      mode === 'legacy_source' && legacy.legacy_recon
        ? legacy.legacy_recon
        : `${reconLabel(r.reconciliationStatus)}${r.reconciledByName ? ` (${r.reconciledByName})` : ''}`;

    aoa.push([
      formatDateID(r.deliveryDate),
      r.isoWeek,
      r.isoMonth,
      r.custId,
      r.custName,
      `${r.productSku} - ${r.productName}`,
      Number(r.quantity),
      Number(r.netUnitPrice),
      Number(mode === 'legacy_source' && r.rawSourceTotal ? r.rawSourceTotal : r.lineTotal),
      r.salesName,
      metode,
      status,
      r.keterangan,
      recon,
      r.docNumber,
      Number(r.netBillAmount),
      Number(r.paidAmount),
      Number(r.outstandingAmount),
      Number(r.customerDepositBalance),
      r.accountingStatus,
      r.isLegacyArchive ? 'Arsip Sumber' : 'Operasional Aktif',
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, mode === 'operational' ? 'Rekap Operasional' : 'Arsip Sumber');
  const fileName = `penjualan_${mode === 'operational' ? 'rekap_operasional' : 'arsip_sumber'}_${new Date().toISOString().slice(0, 10)}.${format}`;
  if (format === 'csv') {
    XLSX.writeFile(wb, fileName, { bookType: 'csv' });
  } else {
    XLSX.writeFile(wb, fileName);
  }
}

export interface ParsedWorkbookInfo {
  fileName: string;
  fileHash: string;
  sheetNames: string[];
  workbook: XLSX.WorkBook;
}

export async function readWorkbookFile(file: File): Promise<ParsedWorkbookInfo> {
  const buffer = await file.arrayBuffer();
  const fileHash = await sha256Hex(buffer);
  const workbook = XLSX.read(buffer, { type: 'array', raw: true });
  return {
    fileName: file.name,
    fileHash,
    sheetNames: workbook.SheetNames,
    workbook,
  };
}

export function extractSheetHeadersAndRows(workbook: XLSX.WorkBook, sheetName: string) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return { headers: [] as string[], rawRows: [] as Record<string, unknown>[] };
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
  if (matrix.length === 0) return { headers: [], rawRows: [] };

  const headers = (matrix[0] || []).map((h, i) => String(h ?? '').trim() || `KOLOM_${i + 1}`);
  const rawRows: Record<string, unknown>[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const rowArr = matrix[r] || [];
    const hasContent = rowArr.some((cell) => String(cell ?? '').trim() !== '');
    if (!hasContent) continue;
    const obj: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      obj[h] = rowArr[idx] ?? '';
    });
    rawRows.push(obj);
  }
  return { headers, rawRows };
}

export function autoSuggestColumnMapping(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const find = (candidates: string[]) => {
    for (const c of candidates) {
      const exact = headers.find((h) => h.toUpperCase() === c);
      if (exact) return exact;
    }
    for (const c of candidates) {
      const partial = headers.find((h) => h.toUpperCase().includes(c));
      if (partial) return partial;
    }
    return '';
  };

  map.deliveryDate = find(['DELIVERY DATE', 'TANGGAL KIRIM', 'TGL KIRIM']);
  map.week = find(['WEEK', 'MINGGU']);
  map.month = find(['MONTH', 'BULAN']);
  map.custId = find(['CUST ID', 'CUSTOMER ID', 'KODE PELANGGAN', 'ID PELANGGAN']);
  map.custName = find(['CUST NAME', 'CUSTOMER NAME', 'NAMA PELANGGAN', 'PELANGGAN']);
  map.product = find(['PRODUCT', 'PRODUK', 'NAMA PRODUK', 'BARANG']);
  map.productSku = find(['KODE PRODUK', 'SKU', 'PRODUCT CODE']);
  map.unitCode = find(['SATUAN', 'UNIT', 'UOM']);
  map.qty = find(['QTY', 'QUANTITY', 'JUMLAH']);
  map.netPrice = find(['NET PRICE', 'HARGA SATUAN', 'HARGA', 'PRICE']);
  map.totalSales = find(['TOTAL SALES', 'TOTAL', 'SUBTOTAL']);
  map.salesName = find(['SALES NAME', 'SALES', 'NAMA SALES']);
  map.paymentMethod = find(['METODE PEMBAYARAN', 'METODE', 'PAYMENT METHOD']);
  map.paymentStatus = find(['STATUS PEMBAYARAN', 'STATUS BAYAR', 'STATUS']);
  map.notes = find(['KETERANGAN', 'CATATAN', 'NOTES']);
  map.recon = find(['REKONSILIASI (ALMIRA)', 'REKONSILIASI', 'ALMIRA']);
  map.sourceDocId = find(['NOMOR NOTA', 'NO NOTA', 'INVOICE', 'NO FAKTUR']);
  map.sourceLineId = find(['ID BARIS SUMBER', 'LINE ID']);
  map.dueDate = find(['TANGGAL JATUH TEMPO', 'JATUH TEMPO', 'DUE DATE']);
  return map;
}

export async function validateAndBuildImportPreview(params: {
  rawRows: Record<string, unknown>[];
  mapping: Record<string, string>;
  dateFormat: ExplicitDateFormat;
  decimalFormat: 'id_comma' | 'en_dot';
  customers: MasterCustomer[];
  aliases: CustomerAlias[];
  products: MasterProduct[];
  staffList: MasterStaff[];
}): Promise<ImportRowPreview[]> {
  const { rawRows, mapping, dateFormat, decimalFormat, customers, aliases, products, staffList } = params;
  const results: ImportRowPreview[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i];
    const rowNo = i + 2;
    const msgs: string[] = [];
    let status: 'valid' | 'warning' | 'error' = 'valid';

    const deliveryRaw = String(raw[mapping.deliveryDate] ?? '').trim();
    const parsedDelivery = parseExplicitDate(raw[mapping.deliveryDate], dateFormat);
    if (!parsedDelivery.isoDate) {
      status = 'error';
      msgs.push(parsedDelivery.error || 'DELIVERY DATE tidak valid');
    }

    const weekRaw = String(raw[mapping.week] ?? '').trim();
    const weekDerived = computeISOWeek(parsedDelivery.isoDate);
    if (weekRaw && weekDerived !== '-' && weekRaw !== weekDerived) {
      if (status === 'valid') status = 'warning';
      msgs.push(`WEEK sumber (${weekRaw}) berbeda dengan derivasi ISO (${weekDerived})`);
    }

    const monthRaw = String(raw[mapping.month] ?? '').trim();
    const monthDerived = computeMonthCode(parsedDelivery.isoDate);
    if (monthRaw && monthDerived !== '-' && monthRaw !== monthDerived) {
      if (status === 'valid') status = 'warning';
      msgs.push(`MONTH sumber (${monthRaw}) berbeda dengan derivasi (${monthDerived})`);
    }

    const custId = String(raw[mapping.custId] ?? '').trim();
    const custName = String(raw[mapping.custName] ?? '').trim();

    // Exact CUST ID match terlebih dahulu (tidak pernah auto-replace lewat fuzzy name!)
    const exactCustMatches = customers.filter((c) => c.custId === custId);
    let resolvedCustomerId: string | null = null;
    let suggestedCustomerMatch: ImportRowPreview['suggestedCustomerMatch'] = null;

    if (!custId) {
      status = 'error';
      msgs.push('CUST ID kosong.');
    } else if (exactCustMatches.length > 1) {
      if (status === 'valid') status = 'warning';
      msgs.push(`Duplikat CUST ID "${custId}" pada master pelanggan.`);
    } else if (exactCustMatches.length === 1) {
      resolvedCustomerId = exactCustMatches[0].id;
    } else {
      // Bantu usulan lewat alias atau nama, namun jangan otomatis mengganti!
      const aliasHit = aliases.find((a) => a.aliasName.toLowerCase() === custName.toLowerCase());
      const nameHit = customers.find((c) => c.name.toLowerCase() === custName.toLowerCase());
      const candidate = aliasHit ? customers.find((c) => c.id === aliasHit.customerId) : nameHit;
      if (candidate) {
        suggestedCustomerMatch = {
          customerId: candidate.id,
          custId: candidate.custId,
          name: candidate.name,
          via: aliasHit ? 'Alias Pelanggan' : 'Kemiripan Nama',
        };
      }
      if (status === 'valid') status = 'warning';
      msgs.push(`CUST ID "${custId}" tidak dikenal di master pelanggan (perlu resolusi manual).`);
    }

    const skuRaw = String(raw[mapping.productSku] ?? '').trim();
    const prodRaw = String(raw[mapping.product] ?? '').trim();
    const matchedProd = products.find(
      (p) =>
        (skuRaw && p.sku.toLowerCase() === skuRaw.toLowerCase()) ||
        (prodRaw && (p.sku.toLowerCase() === prodRaw.toLowerCase() || p.name.toLowerCase() === prodRaw.toLowerCase()))
    );
    const resolvedProductId = matchedProd?.id ?? null;
    if (!matchedProd) {
      if (status === 'valid') status = 'warning';
      msgs.push(`Produk/SKU "${skuRaw || prodRaw}" belum terdaftar di master.`);
    }

    const unitCode = String(raw[mapping.unitCode] ?? '').trim() || matchedProd?.baseUnit || 'PCS';
    const qtyStr = parseLocalizedDecimal(raw[mapping.qty] as string | number, decimalFormat);
    const priceStr = parseLocalizedDecimal(raw[mapping.netPrice] as string | number, decimalFormat);
    const totalStr = parseLocalizedDecimal(raw[mapping.totalSales] as string | number, decimalFormat);

    if (!qtyStr || toDec(qtyStr).lte(0)) {
      status = 'error';
      msgs.push('QTY harus angka > 0.');
    }
    if (!priceStr || toDec(priceStr).lt(0)) {
      status = 'error';
      msgs.push('NET PRICE harus angka >= 0.');
    }

    const computed =
      qtyStr && priceStr ? roundHalfUp(mulDec(qtyStr, priceStr), 0).toFixed(2) : '0.00';
    const rawTotalFormatted = totalStr ? roundHalfUp(toDec(totalStr), 0).toFixed(2) : computed;
    const hasPriceDiscrepancy = totalStr !== null && toDec(rawTotalFormatted).minus(toDec(computed)).abs().gt(1);

    if (hasPriceDiscrepancy) {
      if (status === 'valid') status = 'warning';
      msgs.push(
        `Selisih TOTAL SALES: nilai sumber (${rawTotalFormatted}) ≠ QTY × NET PRICE (${computed}). Nilai sumber dipertahankan untuk keputusan reviewer.`
      );
    }

    const salesName = String(raw[mapping.salesName] ?? '').trim();
    const matchedSales = staffList.find((s) => s.fullName.toLowerCase() === salesName.toLowerCase());
    if (salesName && !matchedSales && status === 'valid') {
      status = 'warning';
      msgs.push(`Sales "${salesName}" belum terdaftar di master petugas.`);
    }

    const dueRaw = mapping.dueDate ? raw[mapping.dueDate] : '';
    const parsedDue = dueRaw ? parseExplicitDate(dueRaw, dateFormat) : { isoDate: null };

    const fp = await sha256Hex(
      `${parsedDelivery.isoDate ?? deliveryRaw}|${custId}|${skuRaw || prodRaw}|${qtyStr ?? ''}|${rawTotalFormatted}`
    );

    results.push({
      rowNo,
      rawCells: raw,
      deliveryDateRaw: deliveryRaw,
      deliveryDateIso: parsedDelivery.isoDate,
      weekRaw,
      weekDerived,
      monthRaw,
      monthDerived,
      custId,
      custName,
      productSku: matchedProd?.sku || skuRaw,
      productName: prodRaw || matchedProd?.name || '',
      unitCode,
      quantity: qtyStr ?? '0',
      netUnitPrice: priceStr ?? '0',
      rawTotalSales: rawTotalFormatted,
      computedTotalSales: computed,
      hasPriceDiscrepancy,
      salesName,
      sourceDocId: String(raw[mapping.sourceDocId] ?? '').trim(),
      sourceLineId: String(raw[mapping.sourceLineId] ?? '').trim(),
      dueDateIso: parsedDue.isoDate,
      legacyMethodLabel: String(raw[mapping.paymentMethod] ?? '').trim(),
      legacyStatusLabel: String(raw[mapping.paymentStatus] ?? '').trim(),
      legacyReconLabel: String(raw[mapping.recon] ?? '').trim(),
      notes: String(raw[mapping.notes] ?? '').trim(),
      resolvedCustomerId,
      suggestedCustomerMatch,
      resolvedProductId,
      resolvedSalesStaffId: matchedSales?.id ?? null,
      validationStatus: status,
      validationMessages: msgs,
      fingerprint: fp,
    });
  }

  return results;
}
