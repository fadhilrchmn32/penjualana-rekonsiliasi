import assert from 'node:assert/strict';
import { runDomainUatSuite } from '../src/engine/demoLedgerEngine';
import { computeISOWeek, computeMonthCode, parseExplicitDate } from '../src/lib/dates';
import { parseLocalizedDecimal, roundHalfUp } from '../src/lib/decimal';
import { validateAndBuildImportPreview } from '../src/lib/excelImportExport';
import type { CustomerAlias, MasterCustomer, MasterProduct, MasterStaff } from '../src/types/app';

async function runTests() {
  console.log('=== UAT & Domain Verification Suite: Penjualan & Rekonsiliasi (App 2) ===\n');

  // 1. Run core UAT-01 .. UAT-11 domain suite
  const uatResults = runDomainUatSuite();
  for (const r of uatResults) {
    const tag = r.passed ? 'PASS' : 'FAIL';
    console.log(`[${tag}] ${r.id}: ${r.title}`);
    console.log(`       Expected: ${r.expected}`);
    console.log(`       Actual  : ${r.actual}\n`);
    assert.equal(r.passed, true, `${r.id} failed: expected (${r.expected}), actual (${r.actual})`);
  }

  // 2. Date parsing safety: ambiguous string rejected when UNCONFIRMED; explicit format accepted
  const unconfirmed = parseExplicitDate('04/05/26', 'UNCONFIRMED');
  assert.equal(unconfirmed.isoDate, null, 'Ambiguous date must fail when UNCONFIRMED');
  const ddmmyyyy = parseExplicitDate('04/05/26', 'DD/MM/YYYY');
  assert.equal(ddmmyyyy.isoDate, '2026-05-04');
  const mmddyyyy = parseExplicitDate('04/05/26', 'MM/DD/YYYY');
  assert.equal(mmddyyyy.isoDate, '2026-04-05');
  assert.equal(computeISOWeek('2026-11-16'), '2026-W47');
  assert.equal(computeMonthCode('2026-11-16'), '2026-11');
  console.log('[PASS] Extra-01: Ambiguous date parsing blocked unless explicit format confirmed');

  // 3. Decimal half-up & localized Indonesian number parsing
  assert.equal(roundHalfUp('125.5', 0).toString(), '126');
  assert.equal(parseLocalizedDecimal('Rp 1.250.500,75', 'id_comma'), '1250500.75');
  assert.equal(parseLocalizedDecimal('1,250,500.75', 'en_dot'), '1250500.75');
  console.log('[PASS] Extra-02: Half-up decimal rounding & localized Indonesian numeric parsing');

  // 4. Import preview: leading zero CUST ID retention, alias suggestion without auto-overwriting, price discrepancy warning
  const customers: MasterCustomer[] = [
    {
      id: 'c-1',
      companyId: 'co-1',
      branchId: 'br-1',
      custId: '00104',
      name: 'Toko Sumber Makmur',
      defaultSalesId: 's-1',
      phone: null,
      address: null,
      isActive: true,
    },
  ];
  const aliases: CustomerAlias[] = [
    {
      id: 'a-1',
      companyId: 'co-1',
      customerId: 'c-1',
      aliasName: 'SUMBER MAKMUR TB',
      sourceBankAccountHint: null,
    },
  ];
  const products: MasterProduct[] = [
    {
      id: 'p-1',
      companyId: 'co-1',
      sku: 'BRS-05',
      name: 'Beras Premium 5kg',
      baseUnit: 'SAK',
      isStocked: true,
      isActive: true,
    },
  ];
  const staff: MasterStaff[] = [
    {
      id: 's-1',
      companyId: 'co-1',
      branchId: 'br-1',
      staffCode: 'SLS-01',
      fullName: 'Budi Santoso',
      staffRole: 'sales',
      isActive: true,
    },
  ];

  const preview = await validateAndBuildImportPreview({
    rawRows: [
      {
        'DELIVERY DATE': '16/11/2026',
        WEEK: '2026-W47',
        MONTH: '2026-11',
        'CUST ID': '00104',
        'CUST NAME': 'Toko Sumber Makmur',
        PRODUCT: 'Beras Premium 5kg',
        QTY: '10',
        'NET PRICE': '72.000',
        'TOTAL SALES': '725.000', // intentional 5.000 diff!
        'SALES NAME': 'Budi Santoso',
        'METODE PEMBAYARAN': 'Transfer',
        'STATUS PEMBAYARAN': 'Lunas',
        KETERANGAN: 'Uji impor',
        'REKONSILIASI (ALMIRA)': 'Cocok',
      },
    ],
    mapping: {
      deliveryDate: 'DELIVERY DATE',
      week: 'WEEK',
      month: 'MONTH',
      custId: 'CUST ID',
      custName: 'CUST NAME',
      product: 'PRODUCT',
      qty: 'QTY',
      netPrice: 'NET PRICE',
      totalSales: 'TOTAL SALES',
      salesName: 'SALES NAME',
      paymentMethod: 'METODE PEMBAYARAN',
      paymentStatus: 'STATUS PEMBAYARAN',
      notes: 'KETERANGAN',
      reconciliation: 'REKONSILIASI (ALMIRA)',
    },
    dateFormat: 'DD/MM/YYYY',
    decimalFormat: 'id_comma',
    customers,
    aliases,
    products,
    staffList: staff,
  });

  assert.equal(preview.length, 1);
  assert.equal(preview[0].custId, '00104', 'Leading zero in CUST ID must be preserved');
  assert.equal(preview[0].resolvedCustomerId, 'c-1');
  assert.equal(preview[0].hasPriceDiscrepancy, true, 'Price discrepancy between QTY*NET PRICE and TOTAL SALES must be flagged');
  assert.equal(preview[0].validationStatus, 'warning');
  console.log('[PASS] Extra-03: Import preview preserves leading-zero CUST ID and flags raw vs computed total discrepancy');

  console.log(`\nALL ${uatResults.length + 3} CHECKS PASSED.`);
}

void runTests();
