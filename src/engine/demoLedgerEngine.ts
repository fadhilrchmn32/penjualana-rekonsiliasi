import Decimal from 'decimal.js';
import { computeISOWeek, computeMonthCode, daysBetweenISO, todayISOJakarta } from '../lib/dates';
import { addDec, mulDec, roundHalfUp, subDec, toDec } from '../lib/decimal';
import type {
  AccountingEventItem,
  AllocatableReceipt,
  AppSettingsContext,
  AppUserSession,
  BranchOption,
  CustomerAlias,
  CustomerReceivableRow,
  DashboardSummary,
  DiscrepancyCaseItem,
  ImportBatchSummary,
  ImportRowPreview,
  MasterCustomer,
  MasterProduct,
  MasterStaff,
  PaymentAllocationItem,
  ReconciliationQueueItem,
  SalesDocumentDetail,
  SalesLineInput,
  SalesRecapRow,
  TaxCodeOption,
  UatTestResult,
} from '../types/app';
import type {
  AccountingStatus,
  PaymentStatus,
  PlannedPaymentMethod,
  ReconciliationReviewStage,
  ReconciliationStatus,
  RoleCode,
  SalesDocumentStatus,
  TaxBasis,
} from '../types/database.types';

function makeUuid(prefix: string, seq: number): string {
  const hex = seq.toString(16).padStart(12, '0');
  return `${prefix.padEnd(8, '0').slice(0, 8)}-0000-4000-8000-${hex}`;
}

interface InternalSaleDoc {
  id: string;
  companyId: string;
  branchId: string;
  docNumber: string;
  sourceInvoiceNo: string | null;
  docType: 'sales_invoice' | 'credit_note' | 'debit_note';
  customerId: string;
  salesStaffId: string | null;
  invoiceDate: string;
  deliveryDate: string | null;
  dueDate: string | null;
  plannedPaymentMethod: PlannedPaymentMethod;
  taxBasis: TaxBasis;
  taxCodeId: string | null;
  subtotalAmount: string;
  taxAmount: string;
  roundingDiff: string;
  totalAmount: string;
  status: SalesDocumentStatus;
  reconciliationStatus: ReconciliationStatus;
  reconciledBy: string | null;
  reconciledByName: string | null;
  reconciledAt: string | null;
  reconciliationNote: string | null;
  reviewStage: ReconciliationReviewStage;
  reviewReasonCode: string | null;
  accountingStatus: AccountingStatus;
  deliveryProofPath: string | null;
  notes: string | null;
  isLegacyArchive: boolean;
  legacySourceData: Record<string, unknown>;
  amendedFromId: string | null;
  createdBy: string | null;
  submittedBy: string | null;
  approvedBy: string | null;
  version: number;
  createdAt: string;
}

interface InternalSaleLine {
  id: string;
  salesDocumentId: string;
  lineNo: number;
  productId: string;
  skuSnapshot: string;
  nameSnapshot: string;
  unitCode: string;
  quantity: string;
  netUnitPrice: string;
  lineTotalRaw: string;
  lineTotal: string;
  roundingDiff: string;
  rawSourceTotal: string | null;
  hasPriceDiscrepancy: boolean;
  notes: string | null;
}

interface InternalReceipt {
  id: string;
  companyId: string;
  branchId: string;
  receiptNumber: string;
  receiptChannel: 'bank_transfer' | 'cash';
  customerId: string | null;
  isUnknownIdentity: boolean;
  senderNameRaw: string | null;
  customerPaidAt: string;
  bankValueDate: string | null;
  verifiedAt: string | null;
  customerGrossAmount: string;
  verifiedAmount: string;
  refundedAmount: string;
  optionalInvoiceRef: string | null;
  status: 'waiting_verification' | 'verified' | 'rejected' | 'reversed';
  depositStatus: 'not_applicable' | 'not_deposited' | 'partially_deposited' | 'deposited' | 'discrepancy';
  collectorName: string | null;
  evidencePath: string | null;
  version: number;
}

interface InternalAllocation {
  id: string;
  companyId: string;
  branchId: string;
  receiptId: string;
  salesDocumentId: string;
  allocatedAmount: string;
  status: 'proposed' | 'approved' | 'rejected' | 'reversed';
  notes: string | null;
  createdBy: string;
  createdByName: string;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  version: number;
}

interface InternalCreditLink {
  creditNoteId: string;
  targetSaleId: string;
}

interface InternalInventoryVal {
  branchId: string;
  productId: string;
  qtyOnHand: string;
  avgUnitCost: string;
}

export class FinOpsDomainEngine {
  companyId = '11111111-1111-4111-8111-111111111111';
  companyName = 'PT Distributor Nusantara (DEMO SINTETIS)';
  branches: BranchOption[] = [
    { id: '22222222-2222-4222-8222-222222222201', code: 'CBG-JKT', name: 'Cabang Jakarta Pusat' },
    { id: '22222222-2222-4222-8222-222222222202', code: 'CBG-BDG', name: 'Cabang Bandung' },
  ];
  settings: AppSettingsContext = {
    app1Url: null,
    app2Url: null,
    app3Url: null,
    reconciliationLabel: 'REKONSILIASI (ALMIRA)',
    roundingScale: 0,
  };

  demoUsers: Array<{
    userId: string;
    email: string;
    fullName: string;
    branchId: string;
    allBranches: boolean;
    roles: RoleCode[];
  }> = [
    {
      userId: 'u-sales-admin',
      email: 'admin.penjualan@demo.local',
      fullName: 'Rina (Admin Penjualan)',
      branchId: '22222222-2222-4222-8222-222222222201',
      allBranches: false,
      roles: ['sales_admin'],
    },
    {
      userId: 'u-almira',
      email: 'almira.rekonsiliasi@demo.local',
      fullName: 'Almira (Reviewer Rekonsiliasi)',
      branchId: '22222222-2222-4222-8222-222222222201',
      allBranches: true,
      roles: ['reconciliation_reviewer'],
    },
    {
      userId: 'u-accounting',
      email: 'akuntan@demo.local',
      fullName: 'Hendra (Akuntan & Approver)',
      branchId: '22222222-2222-4222-8222-222222222201',
      allBranches: true,
      roles: ['accountant', 'accounting_approver'],
    },
    {
      userId: 'u-viewer',
      email: 'pemilik@demo.local',
      fullName: 'Direktur (Owner Viewer)',
      branchId: '22222222-2222-4222-8222-222222222201',
      allBranches: true,
      roles: ['owner_viewer'],
    },
    {
      userId: 'u-no-role',
      email: 'tamu@demo.local',
      fullName: 'Pengguna Tanpa Role',
      branchId: '22222222-2222-4222-8222-222222222201',
      allBranches: false,
      roles: [],
    },
  ];

  currentUserIndex = 0;

  customers: MasterCustomer[] = [];
  aliases: CustomerAlias[] = [];
  products: MasterProduct[] = [];
  staff: MasterStaff[] = [];
  taxCodes: TaxCodeOption[] = [
    { id: 'tax-ppn11', code: 'PPN11', name: 'PPN 11%', rate: '0.11' },
    { id: 'tax-none', code: 'NON', name: 'Tanpa Pajak', rate: '0' },
  ];
  inventoryVals: InternalInventoryVal[] = [];
  salesDocs: InternalSaleDoc[] = [];
  salesLines: InternalSaleLine[] = [];
  creditLinks: InternalCreditLink[] = [];
  receipts: InternalReceipt[] = [];
  allocations: InternalAllocation[] = [];
  appendNotes: Array<{ id: string; salesDocumentId: string; noteText: string; createdByName: string; createdAt: string }> = [];
  auditEvents: Array<{ id: string; entityType: string; entityId: string; eventAction: string; actorName: string; reason: string | null; createdAt: string }> = [];
  accountingEvents: AccountingEventItem[] = [];
  discrepancyCases: DiscrepancyCaseItem[] = [];
  importBatches: Array<ImportBatchSummary & { rows: ImportRowPreview[] }> = [];
  closedPeriods: Array<{ startDate: string; endDate: string; periodCode: string }> = [
    { startDate: '2026-10-01', endDate: '2026-10-31', periodCode: '2026-10' },
  ];
  private idempotencyStore = new Map<string, unknown>();
  private docSeq = 10;

  constructor() {
    this.seedDemoData();
  }

  getSession(): AppUserSession {
    const u = this.demoUsers[this.currentUserIndex] ?? this.demoUsers[0];
    const br = this.branches.find((b) => b.id === u.branchId) ?? this.branches[0];
    return {
      userId: u.userId,
      email: u.email,
      fullName: u.fullName,
      companyId: this.companyId,
      companyName: this.companyName,
      branchId: br.id,
      branchName: br.name,
      roles: u.roles,
      allBranches: u.allBranches,
    };
  }

  switchDemoUser(userId: string) {
    const idx = this.demoUsers.findIndex((u) => u.userId === userId);
    if (idx >= 0) this.currentUserIndex = idx;
  }

  private assertAccess(branchId: string, allowedRoles: RoleCode[], actionLabel: string) {
    const s = this.getSession();
    if (!s.roles.length) {
      throw new Error(`Akses ditolak: pengguna tidak memiliki peran aktif untuk ${actionLabel}.`);
    }
    if (!s.allBranches && s.branchId !== branchId) {
      throw new Error(`Akses cabang ditolak: Anda tidak berhak mengakses cabang ini untuk ${actionLabel}.`);
    }
    if (!s.roles.some((r) => allowedRoles.includes(r))) {
      throw new Error(`Peran (${s.roles.join(', ')}) tidak diizinkan untuk ${actionLabel}.`);
    }
    return s;
  }

  canViewHpp(): boolean {
    const s = this.getSession();
    return s.roles.some((r) =>
      ['accountant', 'accounting_approver', 'owner_viewer', 'system_admin', 'reconciliation_reviewer'].includes(r)
    );
  }

  private nextSeq(prefix: string): string {
    this.docSeq += 1;
    return `${prefix}-202611-${String(this.docSeq).padStart(4, '0')}`;
  }

  private seedDemoData() {
    const b1 = this.branches[0].id;
    const b2 = this.branches[1].id;
    this.staff = [
      { id: 'stf-1', companyId: this.companyId, branchId: b1, staffCode: 'SLS-01', fullName: 'Budi Santoso', staffRole: 'sales', isActive: true },
      { id: 'stf-2', companyId: this.companyId, branchId: b1, staffCode: 'SLS-02', fullName: 'Siti Rahayu', staffRole: 'sales', isActive: true },
      { id: 'stf-3', companyId: this.companyId, branchId: b1, staffCode: 'COL-01', fullName: 'Agus Penagih', staffRole: 'collector', isActive: true },
      { id: 'stf-4', companyId: this.companyId, branchId: b2, staffCode: 'SLS-03', fullName: 'Dedi Bandung', staffRole: 'sales', isActive: true },
    ];

    this.customers = [
      { id: 'cust-1', companyId: this.companyId, branchId: b1, custId: '00104', name: 'Toko Sumber Makmur', defaultSalesId: 'stf-1', phone: '0812-1111-0001', address: 'Jl. Pasar Baru No. 12', isActive: true },
      { id: 'cust-2', companyId: this.companyId, branchId: b1, custId: '00208', name: 'UD Berkah Jaya', defaultSalesId: 'stf-2', phone: '0812-1111-0002', address: 'Jl. Mangga Dua No. 8', isActive: true },
      { id: 'cust-3', companyId: this.companyId, branchId: b1, custId: '00315', name: 'CV Maju Bersama', defaultSalesId: 'stf-1', phone: '0812-1111-0003', address: 'Jl. Sudirman Kav. 4', isActive: true },
      { id: 'cust-4', companyId: this.companyId, branchId: b2, custId: '00490', name: 'Minimarket Harapan', defaultSalesId: 'stf-4', phone: '0812-2222-0004', address: 'Jl. Asia Afrika No. 40', isActive: true },
    ];

    this.aliases = [
      { id: 'al-1', companyId: this.companyId, customerId: 'cust-1', aliasName: 'SUMBER MAKMUR TB', sourceBankAccountHint: 'BCA-88910' },
      { id: 'al-2', companyId: this.companyId, customerId: 'cust-2', aliasName: 'BERKAH JAYA UD', sourceBankAccountHint: 'MANDIRI-33120' },
    ];

    this.products = [
      { id: 'prd-1', companyId: this.companyId, sku: 'BRS-05', name: 'Beras Premium 5kg', baseUnit: 'SAK', isStocked: true, isActive: true },
      { id: 'prd-2', companyId: this.companyId, sku: 'MYK-02', name: 'Minyak Goreng 2L', baseUnit: 'CRT', isStocked: true, isActive: true },
      { id: 'prd-3', companyId: this.companyId, sku: 'GUL-01', name: 'Gula Pasir 1kg', baseUnit: 'BAL', isStocked: true, isActive: true },
      { id: 'prd-4', companyId: this.companyId, sku: 'KOP-99', name: 'Kopi Sachet Karton (Belum Ada HPP)', baseUnit: 'CRT', isStocked: true, isActive: true },
    ];

    this.inventoryVals = [
      { branchId: b1, productId: 'prd-1', qtyOnHand: '500', avgUnitCost: '62000' },
      { branchId: b1, productId: 'prd-2', qtyOnHand: '350', avgUnitCost: '295000' },
      { branchId: b1, productId: 'prd-3', qtyOnHand: '400', avgUnitCost: '145000' },
      // prd-4 sengaja tidak punya opening stock / HPP untuk uji guardrail!
      { branchId: b2, productId: 'prd-1', qtyOnHand: '150', avgUnitCost: '62500' },
    ];

    // Nota 1: multi-produk (3 baris) untuk Toko Sumber Makmur (Rp 1.000.000, belum bayar, dirilis)
    this.salesDocs.push({
      id: makeUuid('doc', 1),
      companyId: this.companyId,
      branchId: b1,
      docNumber: 'SLS-202611-0001',
      sourceInvoiceNo: 'INV-1101',
      docType: 'sales_invoice',
      customerId: 'cust-1',
      salesStaffId: 'stf-1',
      invoiceDate: '2026-11-03',
      deliveryDate: '2026-11-04',
      dueDate: '2026-12-04',
      plannedPaymentMethod: 'transfer',
      taxBasis: 'non_tax',
      taxCodeId: null,
      subtotalAmount: '1000000.00',
      taxAmount: '0.00',
      roundingDiff: '0.00',
      totalAmount: '1000000.00',
      status: 'released',
      reconciliationStatus: 'needs_review',
      reconciledBy: null,
      reconciledByName: null,
      reconciledAt: null,
      reconciliationNote: null,
      reviewStage: 'ready_to_match',
      reviewReasonCode: null,
      accountingStatus: 'queued',
      deliveryProofPath: null,
      notes: 'Pengiriman 3 produk rutin mingguan',
      isLegacyArchive: false,
      legacySourceData: {},
      amendedFromId: null,
      createdBy: 'u-sales-admin',
      submittedBy: 'u-sales-admin',
      approvedBy: 'u-almira',
      version: 2,
      createdAt: '2026-11-04T09:15:00+07:00',
    });
    this.salesLines.push(
      { id: makeUuid('ln', 1), salesDocumentId: makeUuid('doc', 1), lineNo: 1, productId: 'prd-1', skuSnapshot: 'BRS-05', nameSnapshot: 'Beras Premium 5kg', unitCode: 'SAK', quantity: '5', netUnitPrice: '70000', lineTotalRaw: '350000', lineTotal: '350000.00', roundingDiff: '0', rawSourceTotal: null, hasPriceDiscrepancy: false, notes: 'Batch pagi' },
      { id: makeUuid('ln', 2), salesDocumentId: makeUuid('doc', 1), lineNo: 2, productId: 'prd-2', skuSnapshot: 'MYK-02', nameSnapshot: 'Minyak Goreng 2L', unitCode: 'CRT', quantity: '1', netUnitPrice: '330000', lineTotalRaw: '330000', lineTotal: '330000.00', roundingDiff: '0', rawSourceTotal: null, hasPriceDiscrepancy: false, notes: null },
      { id: makeUuid('ln', 3), salesDocumentId: makeUuid('doc', 1), lineNo: 3, productId: 'prd-3', skuSnapshot: 'GUL-01', nameSnapshot: 'Gula Pasir 1kg', unitCode: 'BAL', quantity: '2', netUnitPrice: '160000', lineTotalRaw: '320000', lineTotal: '320000.00', roundingDiff: '0', rawSourceTotal: null, hasPriceDiscrepancy: false, notes: null }
    );

    // Nota 2: Toko Sumber Makmur Rp 500.000 (kredit)
    this.salesDocs.push({
      id: makeUuid('doc', 2),
      companyId: this.companyId,
      branchId: b1,
      docNumber: 'SLS-202611-0002',
      sourceInvoiceNo: 'INV-1102',
      docType: 'sales_invoice',
      customerId: 'cust-1',
      salesStaffId: 'stf-1',
      invoiceDate: '2026-11-06',
      deliveryDate: '2026-11-07',
      dueDate: '2026-12-07',
      plannedPaymentMethod: 'credit',
      taxBasis: 'non_tax',
      taxCodeId: null,
      subtotalAmount: '500000.00',
      taxAmount: '0.00',
      roundingDiff: '0.00',
      totalAmount: '500000.00',
      status: 'released',
      reconciliationStatus: 'unreviewed',
      reconciledBy: null,
      reconciledByName: null,
      reconciledAt: null,
      reconciliationNote: null,
      reviewStage: 'ready_to_match',
      reviewReasonCode: null,
      accountingStatus: 'queued',
      deliveryProofPath: null,
      notes: 'Order tambahan akhir pekan',
      isLegacyArchive: false,
      legacySourceData: {},
      amendedFromId: null,
      createdBy: 'u-sales-admin',
      submittedBy: 'u-sales-admin',
      approvedBy: 'u-almira',
      version: 2,
      createdAt: '2026-11-07T10:00:00+07:00',
    });
    this.salesLines.push(
      { id: makeUuid('ln', 4), salesDocumentId: makeUuid('doc', 2), lineNo: 1, productId: 'prd-2', skuSnapshot: 'MYK-02', nameSnapshot: 'Minyak Goreng 2L', unitCode: 'CRT', quantity: '1.5', netUnitPrice: '333333.333333', lineTotalRaw: '500000', lineTotal: '500000.00', roundingDiff: '0', rawSourceTotal: null, hasPriceDiscrepancy: false, notes: null }
    );

    // Nota 3: UD Berkah Jaya (kredit sah jatuh tempo)
    this.salesDocs.push({
      id: makeUuid('doc', 3),
      companyId: this.companyId,
      branchId: b1,
      docNumber: 'SLS-202611-0003',
      sourceInvoiceNo: 'INV-1103',
      docType: 'sales_invoice',
      customerId: 'cust-2',
      salesStaffId: 'stf-2',
      invoiceDate: '2026-10-05',
      deliveryDate: '2026-10-06',
      dueDate: '2026-11-05',
      plannedPaymentMethod: 'credit',
      taxBasis: 'non_tax',
      taxCodeId: null,
      subtotalAmount: '850000.00',
      taxAmount: '0.00',
      roundingDiff: '0.00',
      totalAmount: '850000.00',
      status: 'released',
      reconciliationStatus: 'matched',
      reconciledBy: 'u-almira',
      reconciledByName: 'Almira (Reviewer Rekonsiliasi)',
      reconciledAt: '2026-11-08T14:20:00+07:00',
      reconciliationNote: 'Penjualan kredit sah 30 hari, surat jalan lengkap. Saldo tetap terbuka.',
      reviewStage: 'completed',
      reviewReasonCode: 'VALID_CREDIT_TERM',
      accountingStatus: 'posted',
      deliveryProofPath: null,
      notes: 'Kredit resmi TOP 30 hari',
      isLegacyArchive: false,
      legacySourceData: {},
      amendedFromId: null,
      createdBy: 'u-sales-admin',
      submittedBy: 'u-sales-admin',
      approvedBy: 'u-almira',
      version: 3,
      createdAt: '2026-10-06T08:30:00+07:00',
    });
    this.salesLines.push(
      { id: makeUuid('ln', 5), salesDocumentId: makeUuid('doc', 3), lineNo: 1, productId: 'prd-3', skuSnapshot: 'GUL-01', nameSnapshot: 'Gula Pasir 1kg', unitCode: 'BAL', quantity: '5', netUnitPrice: '170000', lineTotalRaw: '850000', lineTotal: '850000.00', roundingDiff: '0', rawSourceTotal: null, hasPriceDiscrepancy: false, notes: null }
    );

    // Nota 4: CV Maju Bersama (masih status diajukan, menunggu persetujuan)
    this.salesDocs.push({
      id: makeUuid('doc', 4),
      companyId: this.companyId,
      branchId: b1,
      docNumber: 'SLS-202611-0004',
      sourceInvoiceNo: null,
      docType: 'sales_invoice',
      customerId: 'cust-3',
      salesStaffId: 'stf-1',
      invoiceDate: '2026-11-15',
      deliveryDate: '2026-11-15',
      dueDate: '2026-12-15',
      plannedPaymentMethod: 'transfer',
      taxBasis: 'non_tax',
      taxCodeId: null,
      subtotalAmount: '700000.00',
      taxAmount: '0.00',
      roundingDiff: '0.00',
      totalAmount: '700000.00',
      status: 'submitted',
      reconciliationStatus: 'unreviewed',
      reconciledBy: null,
      reconciledByName: null,
      reconciledAt: null,
      reconciliationNote: null,
      reviewStage: 'waiting_finance_verification',
      reviewReasonCode: null,
      accountingStatus: 'not_ready',
      deliveryProofPath: null,
      notes: 'Menunggu approval & rilis Almira',
      isLegacyArchive: false,
      legacySourceData: {},
      amendedFromId: null,
      createdBy: 'u-sales-admin',
      submittedBy: 'u-sales-admin',
      approvedBy: null,
      version: 2,
      createdAt: '2026-11-15T11:20:00+07:00',
    });
    this.salesLines.push(
      { id: makeUuid('ln', 6), salesDocumentId: makeUuid('doc', 4), lineNo: 1, productId: 'prd-1', skuSnapshot: 'BRS-05', nameSnapshot: 'Beras Premium 5kg', unitCode: 'SAK', quantity: '10', netUnitPrice: '70000', lineTotalRaw: '700000', lineTotal: '700000.00', roundingDiff: '0', rawSourceTotal: null, hasPriceDiscrepancy: false, notes: null }
    );

    // Penerimaan dari App 1 (v_app2_allocatable_receipts)
    this.receipts = [
      {
        id: makeUuid('rcv', 1),
        companyId: this.companyId,
        branchId: b1,
        receiptNumber: 'RCV-TRF-202611-0001',
        receiptChannel: 'bank_transfer',
        customerId: 'cust-1',
        isUnknownIdentity: false,
        senderNameRaw: 'SUMBER MAKMUR TB',
        customerPaidAt: '2026-11-08',
        bankValueDate: '2026-11-08',
        verifiedAt: '2026-11-08T13:10:00+07:00',
        customerGrossAmount: '1200000.00',
        verifiedAmount: '1200000.00',
        refundedAmount: '0.00',
        optionalInvoiceRef: 'INV-1101 / INV-1102',
        status: 'verified',
        depositStatus: 'not_applicable',
        collectorName: null,
        evidencePath: null,
        version: 1,
      },
      {
        id: makeUuid('rcv', 2),
        companyId: this.companyId,
        branchId: b1,
        receiptNumber: 'RCV-TUN-202611-0002',
        receiptChannel: 'cash',
        customerId: 'cust-1',
        isUnknownIdentity: false,
        senderNameRaw: 'Toko Sumber Makmur',
        customerPaidAt: '2026-11-10',
        bankValueDate: null,
        verifiedAt: '2026-11-10T16:40:00+07:00',
        customerGrossAmount: '300000.00',
        verifiedAmount: '300000.00',
        refundedAmount: '0.00',
        optionalInvoiceRef: 'INV-1102',
        status: 'verified',
        depositStatus: 'not_deposited', // Uang masih di penagih!
        collectorName: 'Agus Penagih',
        evidencePath: null,
        version: 1,
      },
      {
        id: makeUuid('rcv', 3),
        companyId: this.companyId,
        branchId: b1,
        receiptNumber: 'RCV-TRF-202611-0003',
        receiptChannel: 'bank_transfer',
        customerId: 'cust-2',
        isUnknownIdentity: false,
        senderNameRaw: 'UD BERKAH JAYA',
        customerPaidAt: '2026-11-14',
        bankValueDate: null,
        verifiedAt: null,
        customerGrossAmount: '450000.00',
        verifiedAmount: '0.00',
        refundedAmount: '0.00',
        optionalInvoiceRef: 'INV-1103',
        status: 'waiting_verification', // Belum diverifikasi App 1
        depositStatus: 'not_applicable',
        collectorName: null,
        evidencePath: null,
        version: 1,
      },
      {
        id: makeUuid('rcv', 4),
        companyId: this.companyId,
        branchId: b1,
        receiptNumber: 'RCV-TRF-202611-0004',
        receiptChannel: 'bank_transfer',
        customerId: null,
        isUnknownIdentity: true, // Pengirim belum diketahui di App 1
        senderNameRaw: 'TRSF BPK HENDRO',
        customerPaidAt: '2026-11-15',
        bankValueDate: '2026-11-15',
        verifiedAt: '2026-11-15T11:00:00+07:00',
        customerGrossAmount: '500000.00',
        verifiedAmount: '500000.00',
        refundedAmount: '0.00',
        optionalInvoiceRef: null,
        status: 'verified',
        depositStatus: 'not_applicable',
        collectorName: null,
        evidencePath: null,
        version: 1,
      },
    ];

    this.accountingEvents = [
      {
        id: makeUuid('evt', 1),
        eventType: 'sales_revenue_recognized',
        sourceType: 'sales_document',
        sourceId: makeUuid('doc', 1),
        sourceVersion: 2,
        effectiveDate: '2026-11-04',
        processingStatus: 'waiting_accounting_module',
        dependencyIds: [],
        payloadSnapshot: { doc_number: 'SLS-202611-0001', total_amount: '1000000.00' },
        createdAt: '2026-11-04T09:30:00+07:00',
      },
      {
        id: makeUuid('evt', 2),
        eventType: 'sales_cogs_recognized',
        sourceType: 'sales_document',
        sourceId: makeUuid('doc', 1),
        sourceVersion: 2,
        effectiveDate: '2026-11-04',
        processingStatus: 'waiting_accounting_module',
        dependencyIds: [makeUuid('evt', 1)],
        payloadSnapshot: { doc_number: 'SLS-202611-0001', cogs_amount: '895000.00' },
        createdAt: '2026-11-04T09:30:00+07:00',
      },
    ];
  }

  private computeDocBalance(doc: InternalSaleDoc, asOfDate?: string) {
    const cutoff = asOfDate || '9999-12-31';
    const docAllocs = this.allocations.filter((a) => {
      if (a.salesDocumentId !== doc.id) return false;
      if (a.status === 'approved') {
        const r = this.receipts.find((rc) => rc.id === a.receiptId);
        const effDate = r?.bankValueDate || r?.customerPaidAt || '1900-01-01';
        return effDate <= cutoff;
      }
      return false;
    });
    const proposedAllocs = this.allocations.filter(
      (a) => a.salesDocumentId === doc.id && a.status === 'proposed'
    );

    let paid = new Decimal(0);
    let hasTransfer = false;
    let hasCash = false;
    let hasCashAtCollector = false;
    for (const a of docAllocs) {
      paid = paid.plus(toDec(a.allocatedAmount));
      const r = this.receipts.find((rc) => rc.id === a.receiptId);
      if (r?.receiptChannel === 'bank_transfer') hasTransfer = true;
      if (r?.receiptChannel === 'cash') {
        hasCash = true;
        if (['not_deposited', 'partially_deposited', 'discrepancy'].includes(r.depositStatus)) {
          hasCashAtCollector = true;
        }
      }
    }

    let pendingAlloc = new Decimal(0);
    for (const p of proposedAllocs) {
      pendingAlloc = pendingAlloc.plus(toDec(p.allocatedAmount));
    }

    const cnTotal = this.creditLinks
      .filter((cl) => cl.targetSaleId === doc.id)
      .reduce((acc, cl) => {
        const cn = this.salesDocs.find((d) => d.id === cl.creditNoteId);
        if (!cn || !['approved', 'released'].includes(cn.status)) return acc;
        if (cn.invoiceDate > cutoff) return acc;
        return acc.plus(toDec(cn.totalAmount));
      }, new Decimal(0));

    const netBill = Decimal.max(0, toDec(doc.totalAmount).minus(cnTotal));
    const outstanding = Decimal.max(0, netBill.minus(paid));

    let paymentStatus: PaymentStatus = 'unpaid';
    if (!doc.isLegacyArchive) {
      if (paid.lte(0)) paymentStatus = 'unpaid';
      else if (paid.lt(netBill)) paymentStatus = 'partially_paid';
      else if (paid.eq(netBill)) paymentStatus = 'paid';
      else paymentStatus = 'overpaid';
    }

    let paymentMethod: 'Belum Ada' | 'Transfer' | 'Tunai' | 'Campuran' = 'Belum Ada';
    if (hasTransfer && hasCash) paymentMethod = 'Campuran';
    else if (hasTransfer) paymentMethod = 'Transfer';
    else if (hasCash) paymentMethod = 'Tunai';

    return {
      creditNoteAmount: cnTotal.toFixed(2),
      netBillAmount: netBill.toFixed(2),
      paidAmount: paid.toFixed(2),
      pendingAllocationAmount: pendingAlloc.toFixed(2),
      outstandingAmount: outstanding.toFixed(2),
      derivedPaymentStatus: paymentStatus,
      derivedPaymentMethod: paymentMethod,
      hasPendingVerification: proposedAllocs.length > 0,
      hasCashAtCollector,
    };
  }

  private getCustomerDepositBalance(customerId: string, asOfDate?: string): string {
    const cutoff = asOfDate || '9999-12-31';
    let total = new Decimal(0);
    for (const r of this.receipts) {
      if (r.customerId !== customerId || r.status !== 'verified' || r.isUnknownIdentity) continue;
      const eff = r.bankValueDate || r.customerPaidAt;
      if (eff > cutoff) continue;
      const used = this.allocations
        .filter((a) => a.receiptId === r.id && a.status === 'approved')
        .reduce((acc, a) => acc.plus(toDec(a.allocatedAmount)), new Decimal(0));
      const avail = toDec(r.verifiedAmount).minus(used).minus(toDec(r.refundedAmount));
      if (avail.gt(0)) total = total.plus(avail);
    }
    return total.toFixed(2);
  }

  // --- READ MODELS ---
  getDashboardSummary(branchId?: string | null): DashboardSummary {
    const s = this.getSession();
    const activeDocs = this.salesDocs.filter(
      (d) =>
        d.docType === 'sales_invoice' &&
        !d.isLegacyArchive &&
        (s.allBranches || d.branchId === s.branchId) &&
        (!branchId || d.branchId === branchId)
    );
    const recognizedDocs = activeDocs.filter((d) => ['approved', 'released'].includes(d.status));
    let salesAmt = new Decimal(0);
    let openAmt = new Decimal(0);
    let openCount = 0;
    let needsReview = 0;
    for (const d of recognizedDocs) {
      salesAmt = salesAmt.plus(toDec(d.totalAmount));
      const bal = this.computeDocBalance(d);
      if (toDec(bal.outstandingAmount).gt(0)) {
        openAmt = openAmt.plus(toDec(bal.outstandingAmount));
        openCount += 1;
      }
      if (['unreviewed', 'needs_review', 'discrepancy'].includes(d.reconciliationStatus)) {
        needsReview += 1;
      }
    }

    const waitReceipts = this.receipts.filter(
      (r) => r.status === 'waiting_verification' && (s.allBranches || r.branchId === s.branchId)
    );
    const availReceipts = this.getAllocatableReceipts(branchId).filter(
      (r) => r.status === 'verified' && !r.isUnknownIdentity && toDec(r.availableToAllocate).gt(0)
    );

    return {
      salesByDeliveryAmount: salesAmt.toFixed(2),
      salesDocCount: recognizedDocs.length,
      openReceivableAmount: openAmt.toFixed(2),
      openReceivableCount: openCount,
      waitingVerificationReceiptAmount: waitReceipts
        .reduce((a, r) => a.plus(toDec(r.customerGrossAmount)), new Decimal(0))
        .toFixed(2),
      waitingVerificationReceiptCount: waitReceipts.length,
      availableVerifiedReceiptAmount: availReceipts
        .reduce((a, r) => a.plus(toDec(r.availableToAllocate)), new Decimal(0))
        .toFixed(2),
      availableVerifiedReceiptCount: availReceipts.length,
      needsReviewCount: needsReview,
      openDiscrepancyCount: this.discrepancyCases.filter((c) => c.status === 'open').length,
      pendingAccountingEventsCount: this.accountingEvents.filter((e) =>
        ['waiting_accounting_module', 'queued', 'failed'].includes(e.processingStatus)
      ).length,
      pendingAllocationProposalCount: this.allocations.filter((a) => a.status === 'proposed').length,
    };
  }

  getSalesRecap(params?: {
    branchId?: string | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    cutoffDate?: string | null;
    includeArchive?: boolean;
  }): SalesRecapRow[] {
    const s = this.getSession();
    const cutoff = params?.cutoffDate || undefined;
    const rows: SalesRecapRow[] = [];

    const filteredDocs = this.salesDocs.filter((d) => {
      if (d.docType !== 'sales_invoice') return false;
      if (!s.allBranches && d.branchId !== s.branchId) return false;
      if (params?.branchId && d.branchId !== params.branchId) return false;
      if (!params?.includeArchive && d.isLegacyArchive) return false;
      if (params?.dateFrom && (!d.deliveryDate || d.deliveryDate < params.dateFrom)) return false;
      if (params?.dateTo && (!d.deliveryDate || d.deliveryDate > params.dateTo)) return false;
      return true;
    });

    for (const d of filteredDocs) {
      const cust = this.customers.find((c) => c.id === d.customerId);
      const stf = this.staff.find((st) => st.id === d.salesStaffId);
      const bal = this.computeDocBalance(d, cutoff);
      const depositBal = this.getCustomerDepositBalance(d.customerId, cutoff);
      const lines = this.salesLines.filter((l) => l.salesDocumentId === d.id).sort((a, b) => a.lineNo - b.lineNo);

      for (const l of lines) {
        rows.push({
          salesLineId: l.id,
          salesDocumentId: d.id,
          branchId: d.branchId,
          docNumber: d.docNumber,
          sourceInvoiceNo: d.sourceInvoiceNo,
          docType: d.docType,
          documentStatus: d.status,
          deliveryDate: d.deliveryDate,
          isoWeek: computeISOWeek(d.deliveryDate),
          isoMonth: computeMonthCode(d.deliveryDate),
          invoiceDate: d.invoiceDate,
          dueDate: d.dueDate,
          customerUuid: d.customerId,
          custId: cust?.custId || '-',
          custName: cust?.name || '-',
          productUuid: l.productId,
          productSku: l.skuSnapshot,
          productName: l.nameSnapshot,
          lineNo: l.lineNo,
          unitCode: l.unitCode,
          quantity: l.quantity,
          netUnitPrice: l.netUnitPrice,
          lineTotal: l.lineTotal,
          rawSourceTotal: l.rawSourceTotal,
          hasPriceDiscrepancy: l.hasPriceDiscrepancy,
          salesStaffId: d.salesStaffId,
          salesName: stf?.fullName || '-',
          metodePembayaran: bal.derivedPaymentMethod,
          statusPembayaran: bal.derivedPaymentStatus,
          plannedPaymentMethod: d.plannedPaymentMethod,
          keterangan: l.notes || d.notes || '',
          reconciliationStatus: d.reconciliationStatus,
          reconcilerLabel: this.settings.reconciliationLabel,
          reconciledByName: d.reconciledByName,
          reconciledAt: d.reconciledAt,
          reconciliationNote: d.reconciliationNote,
          documentTotalAmount: d.totalAmount,
          creditNoteAmount: bal.creditNoteAmount,
          netBillAmount: bal.netBillAmount,
          paidAmount: bal.paidAmount,
          pendingAllocationAmount: bal.pendingAllocationAmount,
          outstandingAmount: bal.outstandingAmount,
          customerDepositBalance: depositBal,
          hasPendingVerification: bal.hasPendingVerification,
          hasCashAtCollector: bal.hasCashAtCollector,
          accountingStatus: d.accountingStatus,
          isLegacyArchive: d.isLegacyArchive,
          legacySourceData: d.legacySourceData,
          taxBasis: d.taxBasis,
          version: d.version,
          createdBy: d.createdBy,
          submittedBy: d.submittedBy,
        });
      }
    }

    return rows.sort((a, b) => (b.deliveryDate || '').localeCompare(a.deliveryDate || '') || b.docNumber.localeCompare(a.docNumber));
  }

  getSalesDocumentDetail(salesDocumentId: string): SalesDocumentDetail {
    const s = this.getSession();
    const d = this.salesDocs.find((x) => x.id === salesDocumentId);
    if (!d) throw new Error('Dokumen penjualan tidak ditemukan.');
    if (!s.allBranches && d.branchId !== s.branchId) {
      throw new Error('Akses ditolak: Anda tidak berhak melihat detail dokumen cabang lain.');
    }
    const cust = this.customers.find((c) => c.id === d.customerId);
    const stf = this.staff.find((st) => st.id === d.salesStaffId);
    const bal = this.computeDocBalance(d);

    return {
      id: d.id,
      companyId: d.companyId,
      branchId: d.branchId,
      docNumber: d.docNumber,
      sourceInvoiceNo: d.sourceInvoiceNo,
      docType: d.docType,
      customerId: d.customerId,
      custId: cust?.custId || '-',
      custName: cust?.name || '-',
      salesStaffId: d.salesStaffId,
      salesName: stf?.fullName || '-',
      invoiceDate: d.invoiceDate,
      deliveryDate: d.deliveryDate,
      dueDate: d.dueDate,
      plannedPaymentMethod: d.plannedPaymentMethod,
      taxBasis: d.taxBasis,
      taxCodeId: d.taxCodeId,
      subtotalAmount: d.subtotalAmount,
      taxAmount: d.taxAmount,
      roundingDiff: d.roundingDiff,
      totalAmount: d.totalAmount,
      creditNoteAmount: bal.creditNoteAmount,
      netBillAmount: bal.netBillAmount,
      paidAmount: bal.paidAmount,
      pendingAllocationAmount: bal.pendingAllocationAmount,
      outstandingAmount: bal.outstandingAmount,
      derivedPaymentMethod: bal.derivedPaymentMethod,
      derivedPaymentStatus: bal.derivedPaymentStatus,
      hasPendingVerification: bal.hasPendingVerification,
      hasCashAtCollector: bal.hasCashAtCollector,
      status: d.status,
      reconciliationStatus: d.reconciliationStatus,
      reconciledByName: d.reconciledByName,
      reconciledAt: d.reconciledAt,
      reconciliationNote: d.reconciliationNote,
      accountingStatus: d.accountingStatus,
      deliveryProofPath: d.deliveryProofPath,
      notes: d.notes,
      isLegacyArchive: d.isLegacyArchive,
      amendedFromId: d.amendedFromId,
      createdBy: d.createdBy,
      submittedBy: d.submittedBy,
      approvedBy: d.approvedBy,
      version: d.version,
      lines: this.salesLines
        .filter((l) => l.salesDocumentId === d.id)
        .sort((a, b) => a.lineNo - b.lineNo)
        .map((l) => ({
          id: l.id,
          lineNo: l.lineNo,
          productId: l.productId,
          sku: l.skuSnapshot,
          productName: l.nameSnapshot,
          unitCode: l.unitCode,
          quantity: l.quantity,
          netUnitPrice: l.netUnitPrice,
          lineTotalRaw: l.lineTotalRaw,
          lineTotal: l.lineTotal,
          roundingDiff: l.roundingDiff,
          rawSourceTotal: l.rawSourceTotal,
          hasPriceDiscrepancy: l.hasPriceDiscrepancy,
          notes: l.notes,
        })),
      allocations: this.getAllocations({ salesDocumentId: d.id }),
      appendNotes: this.appendNotes.filter((n) => n.salesDocumentId === d.id),
      auditTrail: this.auditEvents.filter((a) => a.entityId === d.id),
    };
  }

  getAllocatableReceipts(branchId?: string | null): AllocatableReceipt[] {
    const s = this.getSession();
    return this.receipts
      .filter((r) => (s.allBranches || r.branchId === s.branchId) && (!branchId || r.branchId === branchId))
      .map((r) => {
        const cust = this.customers.find((c) => c.id === r.customerId);
        const approvedUsed = this.allocations
          .filter((a) => a.receiptId === r.id && a.status === 'approved')
          .reduce((acc, a) => acc.plus(toDec(a.allocatedAmount)), new Decimal(0));
        const proposedUsed = this.allocations
          .filter((a) => a.receiptId === r.id && a.status === 'proposed')
          .reduce((acc, a) => acc.plus(toDec(a.allocatedAmount)), new Decimal(0));
        const avail = Decimal.max(
          0,
          toDec(r.verifiedAmount).minus(approvedUsed).minus(toDec(r.refundedAmount))
        );
        return {
          receiptId: r.id,
          companyId: r.companyId,
          branchId: r.branchId,
          receiptNumber: r.receiptNumber,
          receiptChannel: r.receiptChannel,
          customerId: r.customerId,
          custId: cust?.custId ?? null,
          customerName: cust?.name ?? null,
          isUnknownIdentity: r.isUnknownIdentity,
          senderNameRaw: r.senderNameRaw,
          customerPaidAt: r.customerPaidAt,
          bankValueDate: r.bankValueDate,
          verifiedAt: r.verifiedAt,
          customerGrossAmount: r.customerGrossAmount,
          verifiedAmount: r.verifiedAmount,
          allocatedAmount: approvedUsed.toFixed(2),
          pendingProposedAmount: proposedUsed.toFixed(2),
          refundedAmount: r.refundedAmount,
          availableToAllocate: avail.toFixed(2),
          optionalInvoiceRef: r.optionalInvoiceRef,
          status: r.status,
          depositStatus: r.depositStatus,
          collectorName: r.collectorName,
          evidencePath: r.evidencePath,
          version: r.version,
        };
      });
  }

  getAllocations(filter?: { salesDocumentId?: string; status?: string }): PaymentAllocationItem[] {
    const s = this.getSession();
    return this.allocations
      .filter((a) => {
        if (!s.allBranches && a.branchId !== s.branchId) return false;
        if (filter?.salesDocumentId && a.salesDocumentId !== filter.salesDocumentId) return false;
        if (filter?.status && a.status !== filter.status) return false;
        return true;
      })
      .map((a) => {
        const r = this.receipts.find((rc) => rc.id === a.receiptId);
        const sd = this.salesDocs.find((d) => d.id === a.salesDocumentId);
        const cust = this.customers.find((c) => c.id === sd?.customerId);
        return {
          id: a.id,
          receiptId: a.receiptId,
          receiptNumber: r?.receiptNumber || '-',
          receiptChannel: r?.receiptChannel || 'bank_transfer',
          customerPaidAt: r?.customerPaidAt || '-',
          depositStatus: r?.depositStatus || 'not_applicable',
          salesDocumentId: a.salesDocumentId,
          docNumber: sd?.docNumber || '-',
          customerId: sd?.customerId || '',
          custName: cust?.name || '-',
          allocatedAmount: a.allocatedAmount,
          status: a.status,
          notes: a.notes,
          createdBy: a.createdBy,
          createdByName: a.createdByName,
          approvedBy: a.approvedBy,
          approvedByName: a.approvedByName,
          approvedAt: a.approvedAt,
          version: a.version,
        };
      });
  }

  getCustomerReceivable(asOfDate?: string, branchId?: string | null): CustomerReceivableRow[] {
    const s = this.getSession();
    const asOf = asOfDate || todayISOJakarta();
    return this.customers
      .filter((c) => (s.allBranches || c.branchId === s.branchId) && (!branchId || c.branchId === branchId))
      .map((c) => {
        let billed = new Decimal(0);
        let paid = new Decimal(0);
        let out = new Decimal(0);
        let a0 = new Decimal(0);
        let a31 = new Decimal(0);
        let a61 = new Decimal(0);
        let a90 = new Decimal(0);

        const custDocs = this.salesDocs.filter(
          (d) =>
            d.customerId === c.id &&
            d.docType === 'sales_invoice' &&
            ['approved', 'released'].includes(d.status) &&
            !d.isLegacyArchive &&
            (d.deliveryDate || d.invoiceDate) <= asOf
        );

        for (const d of custDocs) {
          const bal = this.computeDocBalance(d, asOf);
          billed = billed.plus(toDec(bal.netBillAmount));
          paid = paid.plus(toDec(bal.paidAmount));
          const rem = toDec(bal.outstandingAmount);
          out = out.plus(rem);
          if (rem.gt(0)) {
            const overdue = Math.max(0, daysBetweenISO(d.dueDate || d.deliveryDate || d.invoiceDate, asOf));
            if (overdue <= 30) a0 = a0.plus(rem);
            else if (overdue <= 60) a31 = a31.plus(rem);
            else if (overdue <= 90) a61 = a61.plus(rem);
            else a90 = a90.plus(rem);
          }
        }

        return {
          customerUuid: c.id,
          custId: c.custId,
          custName: c.name,
          totalBilled: billed.toFixed(2),
          totalPaid: paid.toFixed(2),
          totalOutstanding: out.toFixed(2),
          aging0To30: a0.toFixed(2),
          aging31To60: a31.toFixed(2),
          aging61To90: a61.toFixed(2),
          agingOver90: a90.toFixed(2),
          titipanBalance: this.getCustomerDepositBalance(c.id, asOf),
        };
      });
  }

  getReconciliationQueue(): ReconciliationQueueItem[] {
    const s = this.getSession();
    return this.salesDocs
      .filter((d) => d.docType === 'sales_invoice' && !d.isLegacyArchive && (s.allBranches || d.branchId === s.branchId))
      .map((d) => {
        const cust = this.customers.find((c) => c.id === d.customerId);
        const bal = this.computeDocBalance(d);
        let stage = d.reviewStage;
        let hint = 'Reviewer Almira';
        let summary = 'Siap ditinjau atau dicocokkan dengan penerimaan terverifikasi.';

        if (d.status === 'submitted') {
          stage = 'waiting_finance_verification';
          hint = 'Reviewer Penjualan (Almira)';
          summary = 'Nota menunggu persetujuan & konfirmasi tanggal pengiriman.';
        } else if (bal.hasPendingVerification) {
          stage = 'allocation_pending_review';
          hint = 'Checker / Reviewer Rekonsiliasi';
          summary = 'Ada usulan alokasi pembayaran yang menunggu persetujuan.';
        } else if (d.reconciliationStatus === 'discrepancy') {
          stage = 'discrepancy';
          hint = 'Admin Penjualan / Keuangan';
          summary = d.reconciliationNote || 'Terdapat selisih nominal atau bukti yang perlu ditindaklanjuti.';
        } else if (d.reconciliationStatus === 'reviewed') {
          stage = 'completed';
          hint = 'Selesai';
          summary = d.reconciliationNote || 'Rekonsiliasi telah diselesaikan.';
        } else if (d.reconciliationStatus === 'matched') {
          stage = 'matched';
          hint = 'Selesai / Siap Tutup Review';
          summary = d.reconciliationNote || 'Bukti, identitas, dan alokasi/kredit telah diperiksa.';
        }

        return {
          salesDocumentId: d.id,
          docNumber: d.docNumber,
          sourceInvoiceNo: d.sourceInvoiceNo,
          deliveryDate: d.deliveryDate,
          custId: cust?.custId || '-',
          custName: cust?.name || '-',
          netBillAmount: bal.netBillAmount,
          paidAmount: bal.paidAmount,
          outstandingAmount: bal.outstandingAmount,
          derivedPaymentStatus: bal.derivedPaymentStatus,
          hasPendingVerification: bal.hasPendingVerification,
          hasCashAtCollector: bal.hasCashAtCollector,
          reconciliationStatus: d.reconciliationStatus,
          reviewStage: stage,
          reasonCode: d.reviewReasonCode,
          notes: d.reconciliationNote,
          reconciledByName: d.reconciledByName,
          reconciledAt: d.reconciledAt,
          actionOwnerHint: hint,
          problemSummary: summary,
        };
      });
  }

  getProductsWithRoleGuard(): MasterProduct[] {
    const showHpp = this.canViewHpp();
    const s = this.getSession();
    return this.products.map((p) => {
      if (!showHpp) return { ...p };
      const val = this.inventoryVals.find((v) => v.branchId === s.branchId && v.productId === p.id);
      return {
        ...p,
        qtyOnHand: val?.qtyOnHand ?? '0',
        avgUnitCost: val?.avgUnitCost ?? '0',
      };
    });
  }

  // --- MUTATION RPC EQUIVALENTS ---
  draftSale(params: {
    idempotencyKey: string;
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
  }) {
    if (this.idempotencyStore.has(`draft_sale:${params.idempotencyKey}`)) {
      return this.idempotencyStore.get(`draft_sale:${params.idempotencyKey}`) as { salesDocumentId: string; docNumber: string };
    }
    const actor = this.assertAccess(params.branchId, ['sales_admin', 'reconciliation_reviewer', 'system_admin'], 'membuat draft penjualan');
    if (!params.lines.length) throw new Error('Nota wajib memiliki minimal 1 baris produk.');

    const docId = makeUuid('doc', this.docSeq + 1);
    const docNo = this.nextSeq('SLS');
    let subtotal = new Decimal(0);
    let totalRoundDiff = new Decimal(0);
    const createdLines: InternalSaleLine[] = [];

    params.lines.forEach((ln, idx) => {
      const prod = this.products.find((p) => p.id === ln.productId);
      if (!prod) throw new Error(`Produk baris ${idx + 1} tidak ditemukan.`);
      const qty = toDec(ln.quantity);
      const price = toDec(ln.netUnitPrice);
      if (qty.lte(0) || price.lt(0)) throw new Error(`Kuantitas harus > 0 dan harga >= 0 pada baris ${idx + 1}.`);
      const raw = mulDec(qty, price);
      const rounded = roundHalfUp(raw, 0);
      const diff = rounded.minus(raw);
      subtotal = subtotal.plus(rounded);
      totalRoundDiff = totalRoundDiff.plus(diff);

      createdLines.push({
        id: makeUuid('ln', this.salesLines.length + idx + 1),
        salesDocumentId: docId,
        lineNo: idx + 1,
        productId: prod.id,
        skuSnapshot: prod.sku,
        nameSnapshot: prod.name,
        unitCode: ln.unitCode || prod.baseUnit,
        quantity: qty.toString(),
        netUnitPrice: price.toString(),
        lineTotalRaw: raw.toFixed(6),
        lineTotal: rounded.toFixed(2),
        roundingDiff: diff.toFixed(6),
        rawSourceTotal: null,
        hasPriceDiscrepancy: false,
        notes: ln.notes || null,
      });
    });

    const taxRate = params.taxCodeId
      ? toDec(this.taxCodes.find((t) => t.id === params.taxCodeId)?.rate || '0')
      : new Decimal(0);
    let taxAmt = new Decimal(0);
    let docTotal = subtotal;

    if (params.taxBasis === 'tax_exclusive' && taxRate.gt(0)) {
      taxAmt = roundHalfUp(subtotal.times(taxRate), 0);
      docTotal = subtotal.plus(taxAmt);
    } else if (params.taxBasis === 'tax_inclusive' && taxRate.gt(0)) {
      docTotal = subtotal;
      taxAmt = roundHalfUp(docTotal.minus(docTotal.div(new Decimal(1).plus(taxRate))), 0);
      subtotal = docTotal.minus(taxAmt);
    }

    const doc: InternalSaleDoc = {
      id: docId,
      companyId: this.companyId,
      branchId: params.branchId,
      docNumber: docNo,
      sourceInvoiceNo: params.sourceInvoiceNo,
      docType: 'sales_invoice',
      customerId: params.customerId,
      salesStaffId: params.salesStaffId,
      invoiceDate: params.invoiceDate,
      deliveryDate: params.deliveryDate,
      dueDate: params.dueDate,
      plannedPaymentMethod: params.plannedPaymentMethod,
      taxBasis: params.taxBasis,
      taxCodeId: params.taxCodeId,
      subtotalAmount: subtotal.toFixed(2),
      taxAmount: taxAmt.toFixed(2),
      roundingDiff: totalRoundDiff.toFixed(2),
      totalAmount: docTotal.toFixed(2),
      status: params.deliveryDate ? 'draft' : 'pending_delivery',
      reconciliationStatus: 'unreviewed',
      reconciledBy: null,
      reconciledByName: null,
      reconciledAt: null,
      reconciliationNote: null,
      reviewStage: 'waiting_finance_verification',
      reviewReasonCode: null,
      accountingStatus: 'not_ready',
      deliveryProofPath: null,
      notes: params.notes,
      isLegacyArchive: false,
      legacySourceData: {},
      amendedFromId: null,
      createdBy: actor.userId,
      submittedBy: null,
      approvedBy: null,
      version: 1,
      createdAt: new Date().toISOString(),
    };

    this.salesDocs.unshift(doc);
    this.salesLines.push(...createdLines);
    this.auditEvents.unshift({
      id: makeUuid('aud', this.auditEvents.length + 1),
      entityType: 'sales_document',
      entityId: docId,
      eventAction: 'sales.draft',
      actorName: actor.fullName,
      reason: 'Draft penjualan disimpan',
      createdAt: new Date().toISOString(),
    });

    const res = { salesDocumentId: docId, docNumber: docNo };
    this.idempotencyStore.set(`draft_sale:${params.idempotencyKey}`, res);
    return res;
  }

  submitSale(idempotencyKey: string, salesDocumentId: string, expectedVersion: number) {
    if (this.idempotencyStore.has(`submit_sale:${idempotencyKey}`)) {
      return this.idempotencyStore.get(`submit_sale:${idempotencyKey}`);
    }
    const doc = this.salesDocs.find((d) => d.id === salesDocumentId);
    if (!doc) throw new Error('Nota tidak ditemukan.');
    const actor = this.assertAccess(doc.branchId, ['sales_admin', 'reconciliation_reviewer'], 'mengajukan penjualan');
    if (doc.version !== expectedVersion) throw new Error('Konflik versi dokumen. Muat ulang data.');
    if (!['draft', 'pending_delivery'].includes(doc.status)) {
      throw new Error('Hanya draft yang dapat diajukan.');
    }
    if (!doc.deliveryDate) {
      throw new Error('Tanggal pengiriman wajib diisi sebelum pengajuan (draft tanpa tanggal kirim tidak dapat diakui).');
    }

    doc.status = 'submitted';
    doc.submittedBy = actor.userId;
    doc.version += 1;
    this.auditEvents.unshift({
      id: makeUuid('aud', this.auditEvents.length + 1),
      entityType: 'sales_document',
      entityId: doc.id,
      eventAction: 'sales.submit',
      actorName: actor.fullName,
      reason: 'Diajukan untuk persetujuan dan rilis',
      createdAt: new Date().toISOString(),
    });
    const res = { salesDocumentId: doc.id, status: doc.status, version: doc.version };
    this.idempotencyStore.set(`submit_sale:${idempotencyKey}`, res);
    return res;
  }

  approveAndReleaseSale(params: {
    idempotencyKey: string;
    salesDocumentId: string;
    expectedVersion: number;
    confirmedDeliveryDate?: string;
    approvalNote?: string;
  }) {
    if (this.idempotencyStore.has(`release:${params.idempotencyKey}`)) {
      return this.idempotencyStore.get(`release:${params.idempotencyKey}`);
    }
    const doc = this.salesDocs.find((d) => d.id === params.salesDocumentId);
    if (!doc) throw new Error('Nota tidak ditemukan.');
    const actor = this.assertAccess(doc.branchId, ['reconciliation_reviewer', 'accounting_approver'], 'menyetujui & merilis penjualan');

    if (doc.createdBy === actor.userId || doc.submittedBy === actor.userId) {
      throw new Error('Pelanggaran pemisahan tugas (maker-checker): pembuat/pengaju nota tidak boleh menyetujui dokumennya sendiri.');
    }
    if (doc.version !== params.expectedVersion) throw new Error('Konflik versi dokumen.');
    if (doc.status !== 'submitted') throw new Error('Hanya nota berstatus Diajukan yang dapat dirilis.');

    const effDelivery = params.confirmedDeliveryDate || doc.deliveryDate;
    if (!effDelivery) throw new Error('Tanggal penyerahan barang wajib dikonfirmasi.');

    const lines = this.salesLines.filter((l) => l.salesDocumentId === doc.id);
    const missingHpp: string[] = [];
    let totalCogs = new Decimal(0);
    const invUpdates: Array<{ val: InternalInventoryVal; newQty: Decimal }> = [];

    for (const ln of lines) {
      if (ln.hasPriceDiscrepancy) {
        throw new Error(`Baris ${ln.skuSnapshot} memiliki selisih nilai sumber yang belum diselesaikan.`);
      }
      const prod = this.products.find((p) => p.id === ln.productId);
      if (prod?.isStocked) {
        const val = this.inventoryVals.find((v) => v.branchId === doc.branchId && v.productId === prod.id);
        if (!val || toDec(val.avgUnitCost).lte(0) || toDec(val.qtyOnHand).lt(toDec(ln.quantity))) {
          missingHpp.push(prod.sku);
        } else {
          const lineCogs = roundHalfUp(mulDec(ln.quantity, val.avgUnitCost), 0);
          totalCogs = totalCogs.plus(lineCogs);
          invUpdates.push({ val, newQty: subDec(val.qtyOnHand, ln.quantity) });
        }
      }
    }

    if (missingHpp.length > 0) {
      const msg = `Penjualan ditahan: opening stock / HPP belum tersedia untuk SKU (${missingHpp.join(', ')}). Sistem melarang HPP nol atau stok negatif.`;
      this.discrepancyCases.unshift({
        id: makeUuid('case', this.discrepancyCases.length + 1),
        caseNumber: this.nextSeq('CASE'),
        caseType: 'missing_hpp_cost',
        sourceType: 'sales_document',
        sourceId: doc.id,
        expectedAmount: doc.totalAmount,
        actualAmount: '0.00',
        discrepancyAmount: '0.00',
        status: 'open',
        resolutionNote: msg,
        createdAt: new Date().toISOString(),
      });
      throw new Error(msg);
    }

    for (const u of invUpdates) {
      u.val.qtyOnHand = u.newQty.toString();
    }

    doc.status = 'released';
    doc.deliveryDate = effDelivery;
    doc.approvedBy = actor.userId;
    doc.accountingStatus = 'queued';
    doc.reviewStage = 'ready_to_match';
    doc.version += 1;

    const revEvtId = makeUuid('evt', this.accountingEvents.length + 1);
    const cogsEvtId = makeUuid('evt', this.accountingEvents.length + 2);
    this.accountingEvents.unshift(
      {
        id: cogsEvtId,
        eventType: 'sales_cogs_recognized',
        sourceType: 'sales_document',
        sourceId: doc.id,
        sourceVersion: doc.version,
        effectiveDate: effDelivery,
        processingStatus: 'waiting_accounting_module',
        dependencyIds: [revEvtId],
        payloadSnapshot: { doc_number: doc.docNumber, cogs_amount: totalCogs.toFixed(2) },
        createdAt: new Date().toISOString(),
      },
      {
        id: revEvtId,
        eventType: 'sales_revenue_recognized',
        sourceType: 'sales_document',
        sourceId: doc.id,
        sourceVersion: doc.version,
        effectiveDate: effDelivery,
        processingStatus: 'waiting_accounting_module',
        dependencyIds: [],
        payloadSnapshot: { doc_number: doc.docNumber, total_amount: doc.totalAmount, cogs_amount: totalCogs.toFixed(2) },
        createdAt: new Date().toISOString(),
      }
    );

    this.auditEvents.unshift({
      id: makeUuid('aud', this.auditEvents.length + 1),
      entityType: 'sales_document',
      entityId: doc.id,
      eventAction: 'sales.approve_and_release',
      actorName: actor.fullName,
      reason: params.approvalNote || 'Penjualan disetujui dan dirilis',
      createdAt: new Date().toISOString(),
    });

    const res = { salesDocumentId: doc.id, status: doc.status, revenueEventId: revEvtId, cogsEventId: cogsEvtId };
    this.idempotencyStore.set(`release:${params.idempotencyKey}`, res);
    return res;
  }

  proposePaymentAllocation(params: {
    idempotencyKey: string;
    branchId: string;
    items: Array<{ receiptId: string; salesDocumentId: string; allocatedAmount: string; notes?: string }>;
  }) {
    if (this.idempotencyStore.has(`prop_alloc:${params.idempotencyKey}`)) {
      return this.idempotencyStore.get(`prop_alloc:${params.idempotencyKey}`) as { allocationIds: string[] };
    }
    const actor = this.assertAccess(
      params.branchId,
      ['sales_admin', 'reconciliation_reviewer', 'finance_maker', 'finance_checker'],
      'mengusulkan alokasi pembayaran'
    );
    if (!params.items.length) throw new Error('Isi minimal satu nilai alokasi positif.');

    // Validasi kumulatif sebelum menulis (atomic all-or-nothing)
    const rUsedDelta = new Map<string, Decimal>();
    const sUsedDelta = new Map<string, Decimal>();

    for (const item of params.items) {
      const amt = toDec(item.allocatedAmount);
      if (amt.lte(0)) throw new Error('Nominal alokasi harus lebih dari 0.');

      const r = this.receipts.find((rc) => rc.id === item.receiptId);
      const sd = this.salesDocs.find((d) => d.id === item.salesDocumentId);
      if (!r || !sd) throw new Error('Penerimaan atau nota penjualan tidak ditemukan.');
      if (r.status !== 'verified') throw new Error(`Penerimaan ${r.receiptNumber} belum terverifikasi di App 1.`);
      if (r.isUnknownIdentity || !r.customerId) {
        throw new Error(`Penerimaan ${r.receiptNumber} belum memiliki identitas pelanggan sah dari App 1.`);
      }
      if (!['approved', 'released'].includes(sd.status) || sd.isLegacyArchive) {
        throw new Error(`Nota ${sd.docNumber} belum disetujui/dirilis atau merupakan arsip non-posting.`);
      }
      if (r.customerId !== sd.customerId) {
        throw new Error(`Pelanggan penerimaan ${r.receiptNumber} berbeda dengan nota ${sd.docNumber}.`);
      }

      const rAlreadyUsed = this.allocations
        .filter((a) => a.receiptId === r.id && ['approved', 'proposed'].includes(a.status))
        .reduce((acc, a) => acc.plus(toDec(a.allocatedAmount)), new Decimal(0))
        .plus(rUsedDelta.get(r.id) || new Decimal(0));

      if (toDec(r.verifiedAmount).minus(toDec(r.refundedAmount)).minus(rAlreadyUsed).lt(amt)) {
        throw new Error(`Saldo tersedia penerimaan ${r.receiptNumber} tidak mencukupi.`);
      }
      rUsedDelta.set(r.id, (rUsedDelta.get(r.id) || new Decimal(0)).plus(amt));

      const bal = this.computeDocBalance(sd);
      const sPending = toDec(bal.pendingAllocationAmount).plus(sUsedDelta.get(sd.id) || new Decimal(0));
      if (toDec(bal.outstandingAmount).minus(sPending).lt(amt)) {
        throw new Error(`Nominal alokasi melebihi sisa piutang nota ${sd.docNumber}.`);
      }
      sUsedDelta.set(sd.id, (sUsedDelta.get(sd.id) || new Decimal(0)).plus(amt));
    }

    const createdIds: string[] = [];
    for (const item of params.items) {
      const id = makeUuid('alc', this.allocations.length + 1);
      this.allocations.unshift({
        id,
        companyId: this.companyId,
        branchId: params.branchId,
        receiptId: item.receiptId,
        salesDocumentId: item.salesDocumentId,
        allocatedAmount: roundHalfUp(toDec(item.allocatedAmount), 0).toFixed(2),
        status: 'proposed',
        notes: item.notes || null,
        createdBy: actor.userId,
        createdByName: actor.fullName,
        approvedBy: null,
        approvedByName: null,
        approvedAt: null,
        version: 1,
      });
      createdIds.push(id);
    }

    const res = { allocationIds: createdIds };
    this.idempotencyStore.set(`prop_alloc:${params.idempotencyKey}`, res);
    return res;
  }

  approvePaymentAllocation(idempotencyKey: string, allocationIds: string[], notes?: string) {
    if (this.idempotencyStore.has(`appr_alloc:${idempotencyKey}`)) {
      return this.idempotencyStore.get(`appr_alloc:${idempotencyKey}`);
    }
    const targets = this.allocations.filter((a) => allocationIds.includes(a.id));
    if (!targets.length) throw new Error('Tidak ada usulan alokasi yang dipilih.');

    for (const a of targets) {
      const actor = this.assertAccess(a.branchId, ['reconciliation_reviewer', 'finance_checker'], 'menyetujui alokasi pembayaran');
      if (a.createdBy === actor.userId) {
        throw new Error('Pelanggaran maker-checker: pengusul alokasi tidak boleh menyetujui alokasinya sendiri.');
      }
      if (a.status !== 'proposed') {
        throw new Error(`Alokasi ${a.id} sudah diproses (${a.status}).`);
      }
      const r = this.receipts.find((rc) => rc.id === a.receiptId)!;
      const sd = this.salesDocs.find((d) => d.id === a.salesDocumentId)!;

      const rApproved = this.allocations
        .filter((x) => x.receiptId === r.id && x.status === 'approved')
        .reduce((acc, x) => acc.plus(toDec(x.allocatedAmount)), new Decimal(0));
      if (toDec(r.verifiedAmount).minus(toDec(r.refundedAmount)).minus(rApproved).lt(toDec(a.allocatedAmount))) {
        throw new Error(`Over-allocation dicegah: saldo penerimaan ${r.receiptNumber} sudah terpakai.`);
      }

      const bal = this.computeDocBalance(sd);
      if (toDec(bal.outstandingAmount).lt(toDec(a.allocatedAmount))) {
        throw new Error(`Over-allocation dicegah: sisa tagihan nota ${sd.docNumber} tidak mencukupi.`);
      }

      a.status = 'approved';
      a.approvedBy = actor.userId;
      a.approvedByName = actor.fullName;
      a.approvedAt = new Date().toISOString();
      if (notes) a.notes = notes;
      a.version += 1;

      const effDate = [sd.deliveryDate || sd.invoiceDate, r.bankValueDate || r.customerPaidAt].sort().reverse()[0];
      this.accountingEvents.unshift({
        id: makeUuid('evt', this.accountingEvents.length + 1),
        eventType: 'payment_allocated_to_sale',
        sourceType: 'payment_allocation',
        sourceId: a.id,
        sourceVersion: a.version,
        effectiveDate: effDate,
        processingStatus: 'waiting_accounting_module',
        dependencyIds: [],
        payloadSnapshot: {
          receipt_number: r.receiptNumber,
          doc_number: sd.docNumber,
          allocated_amount: a.allocatedAmount,
        },
        createdAt: new Date().toISOString(),
      });
    }

    const res = { approvedIds: allocationIds, status: 'approved' };
    this.idempotencyStore.set(`appr_alloc:${idempotencyKey}`, res);
    return res;
  }

  reversePaymentAllocation(idempotencyKey: string, allocationId: string, expectedVersion: number, reason: string) {
    if (this.idempotencyStore.has(`rev_alloc:${idempotencyKey}`)) {
      return this.idempotencyStore.get(`rev_alloc:${idempotencyKey}`);
    }
    if (!reason || reason.trim().length < 5) throw new Error('Alasan pelepasan alokasi wajib diisi.');
    const a = this.allocations.find((x) => x.id === allocationId);
    if (!a) throw new Error('Alokasi tidak ditemukan.');
    const actor = this.assertAccess(a.branchId, ['reconciliation_reviewer', 'accounting_approver'], 'melepas alokasi pembayaran');
    if (a.approvedBy === actor.userId) {
      throw new Error('Pelanggaran maker-checker: penyetuju alokasi tidak boleh melepas alokasinya sendiri.');
    }
    if (a.version !== expectedVersion) throw new Error('Konflik versi alokasi.');
    if (a.status !== 'approved') throw new Error('Hanya alokasi disetujui yang dapat dilepas.');

    const effDate = (a.approvedAt || todayISOJakarta()).slice(0, 10);
    const closed = this.closedPeriods.find((p) => effDate >= p.startDate && effDate <= p.endDate);
    if (closed) {
      throw new Error(`Periode ${closed.periodCode} sudah ditutup. Gunakan prosedur jurnal koreksi di App 3.`);
    }

    a.status = 'reversed';
    a.notes = reason;
    a.version += 1;

    this.accountingEvents.unshift({
      id: makeUuid('evt', this.accountingEvents.length + 1),
      eventType: 'payment_allocation_reversed',
      sourceType: 'payment_allocation',
      sourceId: a.id,
      sourceVersion: a.version,
      effectiveDate: todayISOJakarta(),
      processingStatus: 'waiting_accounting_module',
      dependencyIds: [],
      payloadSnapshot: { reversed_amount: a.allocatedAmount, reason },
      createdAt: new Date().toISOString(),
    });

    const res = { allocationId: a.id, status: 'reversed', version: a.version };
    this.idempotencyStore.set(`rev_alloc:${idempotencyKey}`, res);
    return res;
  }

  saveReconciliationReview(params: {
    idempotencyKey: string;
    salesDocumentId: string;
    reconciliationStatus: ReconciliationStatus;
    reviewStage: ReconciliationReviewStage;
    reasonCode: string | null;
    notes: string;
  }) {
    if (this.idempotencyStore.has(`recon:${params.idempotencyKey}`)) {
      return this.idempotencyStore.get(`recon:${params.idempotencyKey}`);
    }
    const doc = this.salesDocs.find((d) => d.id === params.salesDocumentId);
    if (!doc) throw new Error('Nota tidak ditemukan.');
    const actor = this.assertAccess(doc.branchId, ['reconciliation_reviewer', 'finance_checker', 'accounting_approver'], 'menyimpan review rekonsiliasi');

    doc.reconciliationStatus = params.reconciliationStatus;
    doc.reviewStage = params.reviewStage;
    doc.reviewReasonCode = params.reasonCode;
    doc.reconciliationNote = params.notes;
    doc.reconciledBy = actor.userId;
    doc.reconciledByName = actor.fullName;
    doc.reconciledAt = new Date().toISOString();
    doc.version += 1;

    this.auditEvents.unshift({
      id: makeUuid('aud', this.auditEvents.length + 1),
      entityType: 'sales_document',
      entityId: doc.id,
      eventAction: 'reconciliation.save_review',
      actorName: actor.fullName,
      reason: params.notes,
      createdAt: new Date().toISOString(),
    });

    const res = { salesDocumentId: doc.id, reconciliationStatus: doc.reconciliationStatus };
    this.idempotencyStore.set(`recon:${params.idempotencyKey}`, res);
    return res;
  }

  issueSalesCreditNote(params: {
    idempotencyKey: string;
    originalSalesDocumentId: string;
    issueDate: string;
    reason: string;
    lines: SalesLineInput[];
  }) {
    if (this.idempotencyStore.has(`cn:${params.idempotencyKey}`)) {
      return this.idempotencyStore.get(`cn:${params.idempotencyKey}`);
    }
    if (!params.reason || params.reason.trim().length < 5) throw new Error('Alasan nota kredit wajib diisi.');
    const orig = this.salesDocs.find((d) => d.id === params.originalSalesDocumentId);
    if (!orig) throw new Error('Nota asal tidak ditemukan.');
    const actor = this.assertAccess(orig.branchId, ['reconciliation_reviewer', 'accounting_approver'], 'menerbitkan nota kredit');
    if (!['approved', 'released'].includes(orig.status)) {
      throw new Error('Nota kredit hanya dapat diterbitkan untuk nota yang telah disetujui/dirilis.');
    }

    const cnId = makeUuid('doc', this.docSeq + 1);
    const cnNo = this.nextSeq('CN-SLS');
    let cnTotal = new Decimal(0);
    const cnLines: InternalSaleLine[] = [];

    params.lines.forEach((ln, idx) => {
      const prod = this.products.find((p) => p.id === ln.productId);
      if (!prod) throw new Error('Produk nota kredit tidak ditemukan.');
      const raw = mulDec(ln.quantity, ln.netUnitPrice);
      const rounded = roundHalfUp(raw, 0);
      cnTotal = cnTotal.plus(rounded);
      cnLines.push({
        id: makeUuid('ln', this.salesLines.length + idx + 1),
        salesDocumentId: cnId,
        lineNo: idx + 1,
        productId: prod.id,
        skuSnapshot: prod.sku,
        nameSnapshot: prod.name,
        unitCode: ln.unitCode || prod.baseUnit,
        quantity: ln.quantity,
        netUnitPrice: ln.netUnitPrice,
        lineTotalRaw: raw.toFixed(6),
        lineTotal: rounded.toFixed(2),
        roundingDiff: rounded.minus(raw).toFixed(6),
        rawSourceTotal: null,
        hasPriceDiscrepancy: false,
        notes: params.reason,
      });
    });

    this.salesDocs.unshift({
      id: cnId,
      companyId: this.companyId,
      branchId: orig.branchId,
      docNumber: cnNo,
      sourceInvoiceNo: orig.docNumber,
      docType: 'credit_note',
      customerId: orig.customerId,
      salesStaffId: orig.salesStaffId,
      invoiceDate: params.issueDate,
      deliveryDate: params.issueDate,
      dueDate: params.issueDate,
      plannedPaymentMethod: 'credit',
      taxBasis: orig.taxBasis,
      taxCodeId: orig.taxCodeId,
      subtotalAmount: cnTotal.toFixed(2),
      taxAmount: '0.00',
      roundingDiff: '0.00',
      totalAmount: cnTotal.toFixed(2),
      status: 'released',
      reconciliationStatus: 'reviewed',
      reconciledBy: actor.userId,
      reconciledByName: actor.fullName,
      reconciledAt: new Date().toISOString(),
      reconciliationNote: params.reason,
      reviewStage: 'completed',
      reviewReasonCode: 'CREDIT_NOTE',
      accountingStatus: 'queued',
      deliveryProofPath: null,
      notes: params.reason,
      isLegacyArchive: false,
      legacySourceData: {},
      amendedFromId: orig.id,
      createdBy: actor.userId,
      submittedBy: actor.userId,
      approvedBy: actor.userId,
      version: 1,
      createdAt: new Date().toISOString(),
    });
    this.salesLines.push(...cnLines);
    this.creditLinks.push({ creditNoteId: cnId, targetSaleId: orig.id });

    this.accountingEvents.unshift({
      id: makeUuid('evt', this.accountingEvents.length + 1),
      eventType: 'sales_credit_note_issued',
      sourceType: 'sales_document',
      sourceId: cnId,
      sourceVersion: 1,
      effectiveDate: params.issueDate,
      processingStatus: 'waiting_accounting_module',
      dependencyIds: [],
      payloadSnapshot: { credit_note_number: cnNo, original_doc: orig.docNumber, amount: cnTotal.toFixed(2) },
      createdAt: new Date().toISOString(),
    });

    const res = { creditNoteId: cnId, creditNoteNumber: cnNo, creditAmount: cnTotal.toFixed(2) };
    this.idempotencyStore.set(`cn:${params.idempotencyKey}`, res);
    return res;
  }

  appendNote(salesDocumentId: string, noteText: string) {
    const doc = this.salesDocs.find((d) => d.id === salesDocumentId);
    if (!doc) throw new Error('Nota tidak ditemukan.');
    const actor = this.assertAccess(doc.branchId, ['sales_admin', 'reconciliation_reviewer', 'finance_checker', 'accountant'], 'menambah catatan append-only');
    if (!noteText.trim()) throw new Error('Catatan tidak boleh kosong.');
    this.appendNotes.unshift({
      id: makeUuid('nt', this.appendNotes.length + 1),
      salesDocumentId,
      noteText: noteText.trim(),
      createdByName: actor.fullName,
      createdAt: new Date().toISOString(),
    });
  }

  commitSalesImport(params: {
    idempotencyKey: string;
    branchId: string;
    fileName: string;
    fileHash: string;
    sheetName: string;
    taxBasis: TaxBasis;
    groupingMode: 'row_per_doc' | 'by_source_invoice';
    cutoverMode: 'active' | 'legacy_archive' | 'opening_subledger';
    rows: ImportRowPreview[];
    allowDuplicateRows?: boolean;
  }) {
    if (this.idempotencyStore.has(`import:${params.idempotencyKey}`)) {
      return this.idempotencyStore.get(`import:${params.idempotencyKey}`) as {
        batchId: string;
        idempotentReimport: boolean;
        docsCreated: number;
        rowsCommitted: number;
      };
    }
    const actor = this.assertAccess(params.branchId, ['sales_admin', 'reconciliation_reviewer', 'system_admin'], 'commit impor penjualan');

    const alreadyCommittedSameHash = this.importBatches.some(
      (b) => b.fileHash === params.fileHash && b.status === 'committed'
    );
    if (alreadyCommittedSameHash && !params.allowDuplicateRows) {
      const batchId = makeUuid('imp', this.importBatches.length + 1);
      this.importBatches.unshift({
        id: batchId,
        fileName: params.fileName,
        fileHash: params.fileHash,
        sheetName: params.sheetName,
        taxBasis: params.taxBasis,
        groupingMode: params.groupingMode,
        cutoverMode: params.cutoverMode,
        totalRows: params.rows.length,
        acceptedRows: 0,
        reviewRows: 0,
        rejectedRows: 0,
        status: 'committed',
        createdAt: new Date().toISOString(),
        rows: params.rows,
      });
      const res = { batchId, idempotentReimport: true, docsCreated: 0, rowsCommitted: 0 };
      this.idempotencyStore.set(`import:${params.idempotencyKey}`, res);
      return res;
    }

    // Grouping atomik
    const groups = new Map<string, ImportRowPreview[]>();
    for (const r of params.rows) {
      const key =
        params.groupingMode === 'by_source_invoice' && r.sourceDocId
          ? `DOC:${r.sourceDocId}`
          : `ROW:${r.rowNo}`;
      const arr = groups.get(key) || [];
      arr.push(r);
      groups.set(key, arr);
    }

    let docsCreated = 0;
    let rowsCommitted = 0;
    let reviewCount = 0;
    let rejectedCount = 0;

    for (const [, grpRows] of groups.entries()) {
      const hasError = grpRows.some((r) => r.validationStatus === 'error');
      const hasUnresolved = grpRows.some((r) => !r.resolvedCustomerId || !r.resolvedProductId || !r.deliveryDateIso);
      const uniqueDates = new Set(grpRows.map((r) => r.deliveryDateIso));
      if (hasError) {
        rejectedCount += grpRows.length;
        continue;
      }
      if (hasUnresolved || uniqueDates.size > 1) {
        reviewCount += grpRows.length;
        continue;
      }

      const first = grpRows[0];
      const docId = makeUuid('doc', this.docSeq + 1);
      const docNo = this.nextSeq('SLS');
      let total = new Decimal(0);

      const newLines: InternalSaleLine[] = grpRows.map((r, idx) => {
        const prod = this.products.find((p) => p.id === r.resolvedProductId)!;
        const lineAmt = toDec(r.rawTotalSales);
        total = total.plus(lineAmt);
        return {
          id: makeUuid('ln', this.salesLines.length + idx + 1),
          salesDocumentId: docId,
          lineNo: idx + 1,
          productId: prod.id,
          skuSnapshot: prod.sku,
          nameSnapshot: prod.name,
          unitCode: r.unitCode || prod.baseUnit,
          quantity: r.quantity,
          netUnitPrice: r.netUnitPrice,
          lineTotalRaw: mulDec(r.quantity, r.netUnitPrice).toFixed(6),
          lineTotal: lineAmt.toFixed(2),
          roundingDiff: '0.000000',
          rawSourceTotal: r.hasPriceDiscrepancy ? r.rawTotalSales : null,
          hasPriceDiscrepancy: r.hasPriceDiscrepancy,
          notes: r.notes || null,
        };
      });

      this.salesDocs.unshift({
        id: docId,
        companyId: this.companyId,
        branchId: params.branchId,
        docNumber: docNo,
        sourceInvoiceNo: first.sourceDocId || null,
        docType: 'sales_invoice',
        customerId: first.resolvedCustomerId!,
        salesStaffId: first.resolvedSalesStaffId,
        invoiceDate: first.deliveryDateIso!,
        deliveryDate: first.deliveryDateIso!,
        dueDate: first.dueDateIso || first.deliveryDateIso!,
        plannedPaymentMethod: 'unknown',
        taxBasis: params.taxBasis,
        taxCodeId: null,
        subtotalAmount: total.toFixed(2),
        taxAmount: '0.00',
        roundingDiff: '0.00',
        totalAmount: total.toFixed(2),
        status: params.cutoverMode === 'legacy_archive' ? 'released' : 'draft',
        reconciliationStatus: grpRows.some((r) => r.hasPriceDiscrepancy) ? 'discrepancy' : 'unreviewed',
        reconciledBy: null,
        reconciledByName: null,
        reconciledAt: null,
        reconciliationNote: grpRows.some((r) => r.hasPriceDiscrepancy)
          ? 'Selisih nilai sumber vs QTY × NET PRICE saat impor'
          : null,
        reviewStage: grpRows.some((r) => r.hasPriceDiscrepancy) ? 'discrepancy' : 'waiting_finance_verification',
        reviewReasonCode: null,
        accountingStatus: 'not_ready',
        deliveryProofPath: null,
        notes: first.notes || null,
        isLegacyArchive: params.cutoverMode === 'legacy_archive',
        legacySourceData: {
          legacy_method: first.legacyMethodLabel,
          legacy_status: first.legacyStatusLabel,
          legacy_recon: first.legacyReconLabel,
          week_raw: first.weekRaw,
          month_raw: first.monthRaw,
        },
        amendedFromId: null,
        createdBy: actor.userId,
        submittedBy: null,
        approvedBy: null,
        version: 1,
        createdAt: new Date().toISOString(),
      });
      this.salesLines.push(...newLines);
      docsCreated += 1;
      rowsCommitted += grpRows.length;
    }

    const batchId = makeUuid('imp', this.importBatches.length + 1);
    this.importBatches.unshift({
      id: batchId,
      fileName: params.fileName,
      fileHash: params.fileHash,
      sheetName: params.sheetName,
      taxBasis: params.taxBasis,
      groupingMode: params.groupingMode,
      cutoverMode: params.cutoverMode,
      totalRows: params.rows.length,
      acceptedRows: rowsCommitted,
      reviewRows: reviewCount,
      rejectedRows: rejectedCount,
      status: 'committed',
      createdAt: new Date().toISOString(),
      rows: params.rows,
    });

    const res = { batchId, idempotentReimport: false, docsCreated, rowsCommitted };
    this.idempotencyStore.set(`import:${params.idempotencyKey}`, res);
    return res;
  }

  upsertCustomer(params: { custId: string; name: string; branchId: string; phone?: string; address?: string }) {
    this.assertAccess(params.branchId, ['sales_admin', 'reconciliation_reviewer', 'accountant', 'system_admin'], 'mengelola master pelanggan');
    const existing = this.customers.find((c) => c.custId === params.custId.trim());
    if (existing) {
      existing.name = params.name.trim();
      existing.phone = params.phone || existing.phone;
      existing.address = params.address || existing.address;
      return existing;
    }
    const created: MasterCustomer = {
      id: `cust-${this.customers.length + 1}`,
      companyId: this.companyId,
      branchId: params.branchId,
      custId: params.custId.trim(),
      name: params.name.trim(),
      defaultSalesId: null,
      phone: params.phone || null,
      address: params.address || null,
      isActive: true,
    };
    this.customers.push(created);
    return created;
  }

  upsertCustomerAlias(customerId: string, aliasName: string, bankHint?: string) {
    this.assertAccess(this.branches[0].id, ['sales_admin', 'reconciliation_reviewer', 'accountant', 'system_admin'], 'mengelola alias pelanggan');
    const created: CustomerAlias = {
      id: `al-${this.aliases.length + 1}`,
      companyId: this.companyId,
      customerId,
      aliasName: aliasName.trim(),
      sourceBankAccountHint: bankHint?.trim() || null,
    };
    this.aliases.push(created);
    return created;
  }

  upsertProduct(params: { sku: string; name: string; baseUnit: string; isStocked: boolean }) {
    this.assertAccess(this.branches[0].id, ['sales_admin', 'reconciliation_reviewer', 'accountant', 'system_admin'], 'mengelola master produk');
    const existing = this.products.find((p) => p.sku.toLowerCase() === params.sku.trim().toLowerCase());
    if (existing) {
      existing.name = params.name.trim();
      existing.baseUnit = params.baseUnit.trim() || 'PCS';
      existing.isStocked = params.isStocked;
      return existing;
    }
    const created: MasterProduct = {
      id: `prd-${this.products.length + 1}`,
      companyId: this.companyId,
      sku: params.sku.trim(),
      name: params.name.trim(),
      baseUnit: params.baseUnit.trim() || 'PCS',
      isStocked: params.isStocked,
      isActive: true,
    };
    this.products.push(created);
    return created;
  }
}

/**
 * Menjalankan seluruh 11 skenario UAT pada instance engine terisolasi dan mengembalikan expected vs actual.
 */
export function runDomainUatSuite(): UatTestResult[] {
  const results: UatTestResult[] = [];
  const eng = new FinOpsDomainEngine();

  // UAT-01: 3 produk dalam 1 nota -> 3 baris rekap, 1 outstanding dokumen
  {
    const rows = eng.getSalesRecap().filter((r) => r.docNumber === 'SLS-202611-0001');
    const uniqueOut = new Set(rows.map((r) => `${r.salesDocumentId}:${r.outstandingAmount}`));
    results.push({
      id: 'UAT-01',
      title: 'Input 3 produk dalam 1 nota menambah 3 baris rekap, tetapi 1 outstanding dokumen',
      expected: '3 baris rekap, 1 dokumen unik, total tagihan Rp 1.000.000',
      actual: `${rows.length} baris rekap, ${uniqueOut.size} dokumen unik, tagihan ${rows[0]?.netBillAmount}`,
      passed: rows.length === 3 && uniqueOut.size === 1 && rows[0]?.netBillAmount === '1000000.00',
    });
  }

  // UAT-02: Receipt transfer & tunai App 1 terlihat tanpa impor ulang
  {
    const rcpts = eng.getAllocatableReceipts();
    const hasTrf = rcpts.some((r) => r.receiptChannel === 'bank_transfer' && r.status === 'verified');
    const hasCash = rcpts.some((r) => r.receiptChannel === 'cash' && r.status === 'verified');
    results.push({
      id: 'UAT-02',
      title: 'Receipt transfer dan tunai dari App 1 terlihat tanpa impor ulang',
      expected: 'Tersedia minimal 1 transfer & 1 tunai terverifikasi dari v_app2_allocatable_receipts',
      actual: `Ditemukan ${rcpts.length} receipt (Transfer=${hasTrf}, Tunai=${hasCash})`,
      passed: hasTrf && hasCash,
    });
  }

  // UAT-03: 1 receipt Rp1.2jt -> Nota A Rp1jt + Nota B Rp200rb; cicilan tunai Rp300rb lunasi Nota B; over-allocation ditolak
  {
    eng.switchDemoUser('u-sales-admin');
    const docA = eng.salesDocs.find((d) => d.docNumber === 'SLS-202611-0001')!;
    const docB = eng.salesDocs.find((d) => d.docNumber === 'SLS-202611-0002')!;
    const rcv1 = makeUuid('rcv', 1); // 1.200.000
    const rcv2 = makeUuid('rcv', 2); // 300.000 tunai di penagih
    const prop1 = eng.proposePaymentAllocation({
      idempotencyKey: 'uat-prop-1',
      branchId: docA.branchId,
      items: [
        { receiptId: rcv1, salesDocumentId: docA.id, allocatedAmount: '1000000' },
        { receiptId: rcv1, salesDocumentId: docB.id, allocatedAmount: '200000' },
        { receiptId: rcv2, salesDocumentId: docB.id, allocatedAmount: '300000' },
      ],
    });
    eng.switchDemoUser('u-almira');
    eng.approvePaymentAllocation('uat-appr-1', prop1.allocationIds, 'UAT M:N');

    let overAllocRejected = false;
    try {
      eng.proposePaymentAllocation({
        idempotencyKey: 'uat-prop-over',
        branchId: docA.branchId,
        items: [{ receiptId: rcv1, salesDocumentId: docB.id, allocatedAmount: '100000' }],
      });
    } catch {
      overAllocRejected = true;
    }

    const rowB = eng.getSalesRecap().find((r) => r.salesDocumentId === docB.id)!;
    results.push({
      id: 'UAT-03',
      title: 'Alokasi M:N (Rp1.2jt ke Nota A & B + cicilan tunai Rp300rb) & pencegahan over-allocation',
      expected: 'Nota B Lunas (paid=500000.00, outstanding=0.00) & over-allocation ditolak',
      actual: `Nota B status=${rowB.statusPembayaran}, paid=${rowB.paidAmount}, overAllocRejected=${overAllocRejected}`,
      passed: rowB.statusPembayaran === 'paid' && rowB.outstandingAmount === '0.00' && overAllocRejected,
    });
  }

  // UAT-04: Kolom Lunas tidak bisa diedit manual / dipercaya dari CSV sumber
  {
    eng.switchDemoUser('u-sales-admin');
    const res = eng.commitSalesImport({
      idempotencyKey: 'uat-imp-legacy-lunas',
      branchId: eng.branches[0].id,
      fileName: 'uji_label_lunas.xlsx',
      fileHash: 'hash-uat-04',
      sheetName: 'Sheet1',
      taxBasis: 'non_tax',
      groupingMode: 'row_per_doc',
      cutoverMode: 'active',
      rows: [
        {
          rowNo: 2,
          rawCells: {},
          deliveryDateRaw: '2026-11-12',
          deliveryDateIso: '2026-11-12',
          weekRaw: '2026-W46',
          weekDerived: '2026-W46',
          monthRaw: '2026-11',
          monthDerived: '2026-11',
          custId: '00104',
          custName: 'Toko Sumber Makmur',
          productSku: 'BRS-05',
          productName: 'Beras Premium 5kg',
          unitCode: 'SAK',
          quantity: '2',
          netUnitPrice: '70000',
          rawTotalSales: '140000.00',
          computedTotalSales: '140000.00',
          hasPriceDiscrepancy: false,
          salesName: 'Budi Santoso',
          sourceDocId: '',
          sourceLineId: '',
          dueDateIso: '2026-12-12',
          legacyMethodLabel: 'Transfer',
          legacyStatusLabel: 'Lunas', // Klaim Lunas di file sumber tanpa receipt!
          legacyReconLabel: 'Cocok',
          notes: 'Uji tolak klaim lunas CSV',
          resolvedCustomerId: 'cust-1',
          suggestedCustomerMatch: null,
          resolvedProductId: 'prd-1',
          resolvedSalesStaffId: 'stf-1',
          validationStatus: 'valid',
          validationMessages: [],
          fingerprint: 'fp-uat-04',
        },
      ],
    });
    const importedRow = eng.getSalesRecap().find((r) => r.keterangan === 'Uji tolak klaim lunas CSV');
    results.push({
      id: 'UAT-04',
      title: 'Label "Lunas" dari file impor tidak dipercaya tanpa receipt/alokasi sah',
      expected: 'statusPembayaran tetap unpaid meskipun CSV menulis Lunas',
      actual: `docsCreated=${res.docsCreated}, statusPembayaran=${importedRow?.statusPembayaran}`,
      passed: importedRow?.statusPembayaran === 'unpaid',
    });
  }

  // UAT-05: Total penjualan tetap sama setelah join banyak pembayaran (anti double-join)
  {
    const rowsA = eng.getSalesRecap().filter((r) => r.docNumber === 'SLS-202611-0002');
    const sumLine = rowsA.reduce((acc, r) => acc.plus(toDec(r.lineTotal)), new Decimal(0));
    results.push({
      id: 'UAT-05',
      title: 'Total penjualan Nota B tetap Rp500.000 setelah dibayar oleh 2 receipt berbeda',
      expected: 'Total line_total = 500000.00 (tidak menjadi 1.000.000 karena double join)',
      actual: `Baris=${rowsA.length}, sum(lineTotal)=${sumLine.toFixed(2)}`,
      passed: rowsA.length === 1 && sumLine.toFixed(2) === '500000.00',
    });
  }

  // UAT-06: Status tunai Lunas + Uang Masih di Penagih dapat tampil bersamaan
  {
    const rowB = eng.getSalesRecap().find((r) => r.docNumber === 'SLS-202611-0002')!;
    results.push({
      id: 'UAT-06',
      title: 'Status tunai Lunas + Uang Masih di Penagih tampil bersamaan',
      expected: 'statusPembayaran=paid AND hasCashAtCollector=true',
      actual: `statusPembayaran=${rowB.statusPembayaran}, hasCashAtCollector=${rowB.hasCashAtCollector}`,
      passed: rowB.statusPembayaran === 'paid' && rowB.hasCashAtCollector === true,
    });
  }

  // UAT-07: Review "Cocok" untuk penjualan kredit tidak memaksa saldo piutang nol
  {
    eng.switchDemoUser('u-almira');
    const doc3 = eng.salesDocs.find((d) => d.docNumber === 'SLS-202611-0003')!;
    eng.saveReconciliationReview({
      idempotencyKey: 'uat-recon-credit',
      salesDocumentId: doc3.id,
      reconciliationStatus: 'matched',
      reviewStage: 'matched',
      reasonCode: 'VALID_CREDIT_TERM',
      notes: 'Penjualan kredit resmi 30 hari, piutang tetap terbuka.',
    });
    const row3 = eng.getSalesRecap().find((r) => r.salesDocumentId === doc3.id)!;
    results.push({
      id: 'UAT-07',
      title: 'Review "Cocok" untuk penjualan kredit tidak memaksa saldo piutang nol',
      expected: 'reconciliationStatus=matched AND outstandingAmount=850000.00',
      actual: `reconciliationStatus=${row3.reconciliationStatus}, outstanding=${row3.outstandingAmount}`,
      passed: row3.reconciliationStatus === 'matched' && row3.outstandingAmount === '850000.00',
    });
  }

  // UAT-08: Impor ulang file sama idempoten
  {
    eng.switchDemoUser('u-sales-admin');
    const reimportRes = eng.commitSalesImport({
      idempotencyKey: 'uat-reimport-2',
      branchId: eng.branches[0].id,
      fileName: 'uji_label_lunas.xlsx',
      fileHash: 'hash-uat-04', // Hash file sama!
      sheetName: 'Sheet1',
      taxBasis: 'non_tax',
      groupingMode: 'row_per_doc',
      cutoverMode: 'active',
      rows: [],
    });
    results.push({
      id: 'UAT-08',
      title: 'Impor ulang file dengan hash sama bersifat idempoten tanpa menggandakan penjualan',
      expected: 'idempotentReimport=true, docsCreated=0',
      actual: `idempotentReimport=${reimportRes.idempotentReimport}, docsCreated=${reimportRes.docsCreated}`,
      passed: reimportRes.idempotentReimport === true && reimportRes.docsCreated === 0,
    });
  }

  // UAT-09: Penjualan terkirim November dibayar Desember tetap di penjualan November; cut-off Nov menampilkan belum lunas
  {
    eng.switchDemoUser('u-sales-admin');
    const novSale = eng.draftSale({
      idempotencyKey: 'uat-nov-sale',
      branchId: eng.branches[0].id,
      customerId: 'cust-1',
      salesStaffId: 'stf-1',
      invoiceDate: '2026-11-20',
      deliveryDate: '2026-11-20',
      dueDate: '2026-12-20',
      plannedPaymentMethod: 'transfer',
      taxBasis: 'non_tax',
      taxCodeId: null,
      sourceInvoiceNo: 'INV-NOV-99',
      notes: 'Uji cut-off Nov vs Dec',
      lines: [{ productId: 'prd-1', unitCode: 'SAK', quantity: '3', netUnitPrice: '70000' }],
    });
    eng.submitSale('uat-nov-sub', novSale.salesDocumentId, 1);
    eng.switchDemoUser('u-almira');
    eng.approveAndReleaseSale({ idempotencyKey: 'uat-nov-rel', salesDocumentId: novSale.salesDocumentId, expectedVersion: 2 });

    // Buat receipt tanggal Desember
    const decRcvId = makeUuid('rcv', 99);
    eng.receipts.push({
      id: decRcvId,
      companyId: eng.companyId,
      branchId: eng.branches[0].id,
      receiptNumber: 'RCV-TRF-202612-0099',
      receiptChannel: 'bank_transfer',
      customerId: 'cust-1',
      isUnknownIdentity: false,
      senderNameRaw: 'SUMBER MAKMUR TB',
      customerPaidAt: '2026-12-05',
      bankValueDate: '2026-12-05',
      verifiedAt: '2026-12-05T10:00:00+07:00',
      customerGrossAmount: '210000.00',
      verifiedAmount: '210000.00',
      refundedAmount: '0.00',
      optionalInvoiceRef: 'INV-NOV-99',
      status: 'verified',
      depositStatus: 'not_applicable',
      collectorName: null,
      evidencePath: null,
      version: 1,
    });
    eng.switchDemoUser('u-sales-admin');
    const propDec = eng.proposePaymentAllocation({
      idempotencyKey: 'uat-dec-prop',
      branchId: eng.branches[0].id,
      items: [{ receiptId: decRcvId, salesDocumentId: novSale.salesDocumentId, allocatedAmount: '210000' }],
    });
    eng.switchDemoUser('u-almira');
    eng.approvePaymentAllocation('uat-dec-appr', propDec.allocationIds);

    const asOfNov = eng.getSalesRecap({ cutoffDate: '2026-11-30' }).find((r) => r.salesDocumentId === novSale.salesDocumentId)!;
    const asOfDec = eng.getSalesRecap({ cutoffDate: '2026-12-10' }).find((r) => r.salesDocumentId === novSale.salesDocumentId)!;
    results.push({
      id: 'UAT-09',
      title: 'Penjualan terkirim November dibayar Desember: cut-off 30/11 tetap terbuka & penjualan di bulan Nov',
      expected: 'isoMonth=2026-11; cut-off 30/11 unpaid (210000); cut-off 10/12 paid (0)',
      actual: `month=${asOfNov.isoMonth}, Nov=${asOfNov.statusPembayaran}(${asOfNov.outstandingAmount}), Dec=${asOfDec.statusPembayaran}(${asOfDec.outstandingAmount})`,
      passed:
        asOfNov.isoMonth === '2026-11' &&
        asOfNov.statusPembayaran === 'unpaid' &&
        asOfNov.outstandingAmount === '210000.00' &&
        asOfDec.statusPembayaran === 'paid' &&
        asOfDec.outstandingAmount === '0.00',
    });
  }

  // UAT-10: Keamanan cabang, role, maker-checker, HPP guard, & detail tebakan ditolak
  {
    eng.switchDemoUser('u-no-role');
    let noRoleBlocked = false;
    try {
      eng.draftSale({
        idempotencyKey: 'uat-sec-1',
        branchId: eng.branches[0].id,
        customerId: 'cust-1',
        salesStaffId: 'stf-1',
        invoiceDate: '2026-11-16',
        deliveryDate: '2026-11-16',
        dueDate: '2026-12-16',
        plannedPaymentMethod: 'credit',
        taxBasis: 'non_tax',
        taxCodeId: null,
        sourceInvoiceNo: null,
        notes: null,
        lines: [{ productId: 'prd-1', unitCode: 'SAK', quantity: '1', netUnitPrice: '70000' }],
      });
    } catch {
      noRoleBlocked = true;
    }

    eng.switchDemoUser('u-sales-admin');
    let crossBranchBlocked = false;
    try {
      eng.draftSale({
        idempotencyKey: 'uat-sec-2',
        branchId: eng.branches[1].id, // Cabang Bandung, user hanya Jakarta!
        customerId: 'cust-4',
        salesStaffId: 'stf-4',
        invoiceDate: '2026-11-16',
        deliveryDate: '2026-11-16',
        dueDate: '2026-12-16',
        plannedPaymentMethod: 'credit',
        taxBasis: 'non_tax',
        taxCodeId: null,
        sourceInvoiceNo: null,
        notes: null,
        lines: [{ productId: 'prd-1', unitCode: 'SAK', quantity: '1', netUnitPrice: '70000' }],
      });
    } catch {
      crossBranchBlocked = true;
    }

    const hppHiddenForSales = !eng.canViewHpp();

    let selfApproveBlocked = false;
    try {
      eng.approveAndReleaseSale({
        idempotencyKey: 'uat-sec-3',
        salesDocumentId: makeUuid('doc', 4), // dibuat oleh u-sales-admin
        expectedVersion: 2,
      });
    } catch {
      selfApproveBlocked = true;
    }

    results.push({
      id: 'UAT-10',
      title: 'Cabang tak berhak, user tanpa role, self-approval, & akses HPP oleh admin penjualan ditolak',
      expected: 'Semua 4 pelanggaran ditolak backend',
      actual: `noRole=${noRoleBlocked}, crossBranch=${crossBranchBlocked}, selfApprove=${selfApproveBlocked}, hppHidden=${hppHiddenForSales}`,
      passed: noRoleBlocked && crossBranchBlocked && selfApproveBlocked && hppHiddenForSales,
    });
  }

  // UAT-11: HPP kosong memblokir rilis penjualan (tidak pasang HPP 0)
  {
    eng.switchDemoUser('u-sales-admin');
    const noHppSale = eng.draftSale({
      idempotencyKey: 'uat-hpp-1',
      branchId: eng.branches[0].id,
      customerId: 'cust-1',
      salesStaffId: 'stf-1',
      invoiceDate: '2026-11-16',
      deliveryDate: '2026-11-16',
      dueDate: '2026-12-16',
      plannedPaymentMethod: 'credit',
      taxBasis: 'non_tax',
      taxCodeId: null,
      sourceInvoiceNo: null,
      notes: 'Uji HPP kosong',
      lines: [{ productId: 'prd-4', unitCode: 'CRT', quantity: '2', netUnitPrice: '100000' }],
    });
    eng.submitSale('uat-hpp-sub', noHppSale.salesDocumentId, 1);

    eng.switchDemoUser('u-almira');
    let hppBlocked = false;
    try {
      eng.approveAndReleaseSale({
        idempotencyKey: 'uat-hpp-rel',
        salesDocumentId: noHppSale.salesDocumentId,
        expectedVersion: 2,
      });
    } catch {
      hppBlocked = true;
    }

    results.push({
      id: 'UAT-11',
      title: 'HPP kosong ditahan saat rilis (tidak memasang HPP 0 atau inventaris negatif)',
      expected: 'approveAndReleaseSale menolak rilis & mencatat discrepancy case',
      actual: `hppBlocked=${hppBlocked}, discrepancyCases=${eng.discrepancyCases.length}`,
      passed: hppBlocked && eng.discrepancyCases.some((c) => c.caseType === 'missing_hpp_cost'),
    });
  }

  return results;
}
