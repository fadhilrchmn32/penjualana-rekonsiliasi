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

export type AppRouteKey =
  | 'ringkasan'
  | 'rekap'
  | 'nota'
  | 'pencocokan'
  | 'almira'
  | 'piutang'
  | 'impor'
  | 'master'
  | 'setup_uat';

export interface AppUserSession {
  userId: string;
  email: string;
  fullName: string;
  companyId: string;
  companyName: string;
  branchId: string;
  branchName: string;
  roles: RoleCode[];
  allBranches: boolean;
}

export interface AppSettingsContext {
  app1Url: string | null;
  app2Url: string | null;
  app3Url: string | null;
  reconciliationLabel: string;
  roundingScale: number;
}

export interface BranchOption {
  id: string;
  code: string;
  name: string;
}

export interface MasterCustomer {
  id: string;
  companyId: string;
  branchId: string;
  custId: string;
  name: string;
  defaultSalesId: string | null;
  phone: string | null;
  address: string | null;
  isActive: boolean;
}

export interface CustomerAlias {
  id: string;
  companyId: string;
  customerId: string;
  aliasName: string;
  sourceBankAccountHint: string | null;
}

export interface MasterProduct {
  id: string;
  companyId: string;
  sku: string;
  name: string;
  baseUnit: string;
  isStocked: boolean;
  isActive: boolean;
  // Optional HPP view only populated for roles allowed to see COGS
  qtyOnHand?: string;
  avgUnitCost?: string;
}

export interface MasterStaff {
  id: string;
  companyId: string;
  branchId: string;
  staffCode: string;
  fullName: string;
  staffRole: 'sales' | 'driver' | 'collector' | 'finance' | 'admin';
  isActive: boolean;
}

export interface TaxCodeOption {
  id: string;
  code: string;
  name: string;
  rate: string;
}

export interface SalesRecapRow {
  salesLineId: string;
  salesDocumentId: string;
  branchId: string;
  docNumber: string;
  sourceInvoiceNo: string | null;
  docType: 'sales_invoice' | 'credit_note' | 'debit_note';
  documentStatus: SalesDocumentStatus;
  deliveryDate: string | null;
  isoWeek: string;
  isoMonth: string;
  invoiceDate: string;
  dueDate: string | null;
  customerUuid: string;
  custId: string;
  custName: string;
  productUuid: string;
  productSku: string;
  productName: string;
  lineNo: number;
  unitCode: string;
  quantity: string;
  netUnitPrice: string;
  lineTotal: string;
  rawSourceTotal: string | null;
  hasPriceDiscrepancy: boolean;
  salesStaffId: string | null;
  salesName: string;
  metodePembayaran: 'Belum Ada' | 'Transfer' | 'Tunai' | 'Campuran';
  statusPembayaran: PaymentStatus;
  plannedPaymentMethod: PlannedPaymentMethod;
  keterangan: string;
  reconciliationStatus: ReconciliationStatus;
  reconcilerLabel: string;
  reconciledByName: string | null;
  reconciledAt: string | null;
  reconciliationNote: string | null;
  documentTotalAmount: string;
  creditNoteAmount: string;
  netBillAmount: string;
  paidAmount: string;
  pendingAllocationAmount: string;
  outstandingAmount: string;
  customerDepositBalance: string;
  hasPendingVerification: boolean;
  hasCashAtCollector: boolean;
  accountingStatus: AccountingStatus;
  isLegacyArchive: boolean;
  legacySourceData: Record<string, unknown>;
  taxBasis: TaxBasis;
  version: number;
  createdBy: string | null;
  submittedBy: string | null;
}

export interface SalesLineInput {
  productId: string;
  unitCode: string;
  quantity: string;
  netUnitPrice: string;
  notes?: string;
}

export interface SalesDocumentDetail {
  id: string;
  companyId: string;
  branchId: string;
  docNumber: string;
  sourceInvoiceNo: string | null;
  docType: 'sales_invoice' | 'credit_note' | 'debit_note';
  customerId: string;
  custId: string;
  custName: string;
  salesStaffId: string | null;
  salesName: string;
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
  creditNoteAmount: string;
  netBillAmount: string;
  paidAmount: string;
  pendingAllocationAmount: string;
  outstandingAmount: string;
  derivedPaymentMethod: 'Belum Ada' | 'Transfer' | 'Tunai' | 'Campuran';
  derivedPaymentStatus: PaymentStatus;
  hasPendingVerification: boolean;
  hasCashAtCollector: boolean;
  status: SalesDocumentStatus;
  reconciliationStatus: ReconciliationStatus;
  reconciledByName: string | null;
  reconciledAt: string | null;
  reconciliationNote: string | null;
  accountingStatus: AccountingStatus;
  deliveryProofPath: string | null;
  notes: string | null;
  isLegacyArchive: boolean;
  amendedFromId: string | null;
  createdBy: string | null;
  submittedBy: string | null;
  approvedBy: string | null;
  version: number;
  lines: Array<{
    id: string;
    lineNo: number;
    productId: string;
    sku: string;
    productName: string;
    unitCode: string;
    quantity: string;
    netUnitPrice: string;
    lineTotalRaw: string;
    lineTotal: string;
    roundingDiff: string;
    rawSourceTotal: string | null;
    hasPriceDiscrepancy: boolean;
    notes: string | null;
  }>;
  allocations: PaymentAllocationItem[];
  appendNotes: Array<{
    id: string;
    noteText: string;
    createdByName: string;
    createdAt: string;
  }>;
  auditTrail: Array<{
    id: string;
    eventAction: string;
    actorName: string;
    reason: string | null;
    createdAt: string;
  }>;
}

export interface AllocatableReceipt {
  receiptId: string;
  companyId: string;
  branchId: string;
  receiptNumber: string;
  receiptChannel: 'bank_transfer' | 'cash';
  customerId: string | null;
  custId: string | null;
  customerName: string | null;
  isUnknownIdentity: boolean;
  senderNameRaw: string | null;
  customerPaidAt: string;
  bankValueDate: string | null;
  verifiedAt: string | null;
  customerGrossAmount: string;
  verifiedAmount: string;
  allocatedAmount: string;
  pendingProposedAmount: string;
  refundedAmount: string;
  availableToAllocate: string;
  optionalInvoiceRef: string | null;
  status: string;
  depositStatus: string;
  collectorName: string | null;
  evidencePath: string | null;
  version: number;
}

export interface PaymentAllocationItem {
  id: string;
  receiptId: string;
  receiptNumber: string;
  receiptChannel: 'bank_transfer' | 'cash';
  customerPaidAt: string;
  depositStatus: string;
  salesDocumentId: string;
  docNumber: string;
  customerId: string;
  custName: string;
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

export interface CustomerReceivableRow {
  customerUuid: string;
  custId: string;
  custName: string;
  totalBilled: string;
  totalPaid: string;
  totalOutstanding: string;
  aging0To30: string;
  aging31To60: string;
  aging61To90: string;
  agingOver90: string;
  titipanBalance: string;
}

export interface ReconciliationQueueItem {
  salesDocumentId: string;
  docNumber: string;
  sourceInvoiceNo: string | null;
  deliveryDate: string | null;
  custId: string;
  custName: string;
  netBillAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  derivedPaymentStatus: PaymentStatus;
  hasPendingVerification: boolean;
  hasCashAtCollector: boolean;
  reconciliationStatus: ReconciliationStatus;
  reviewStage: ReconciliationReviewStage;
  reasonCode: string | null;
  notes: string | null;
  reconciledByName: string | null;
  reconciledAt: string | null;
  actionOwnerHint: string;
  problemSummary: string;
}

export interface DiscrepancyCaseItem {
  id: string;
  caseNumber: string;
  caseType: string;
  sourceType: string;
  sourceId: string;
  expectedAmount: string | null;
  actualAmount: string | null;
  discrepancyAmount: string;
  status: string;
  resolutionNote: string | null;
  createdAt: string;
}

export interface AccountingEventItem {
  id: string;
  eventType: string;
  sourceType: string;
  sourceId: string;
  sourceVersion: number;
  effectiveDate: string;
  processingStatus: string;
  dependencyIds: string[];
  payloadSnapshot: Record<string, unknown>;
  createdAt: string;
}

export interface ImportRowPreview {
  rowNo: number;
  rawCells: Record<string, unknown>;
  deliveryDateRaw: string;
  deliveryDateIso: string | null;
  weekRaw: string;
  weekDerived: string;
  monthRaw: string;
  monthDerived: string;
  custId: string;
  custName: string;
  productSku: string;
  productName: string;
  unitCode: string;
  quantity: string;
  netUnitPrice: string;
  rawTotalSales: string;
  computedTotalSales: string;
  hasPriceDiscrepancy: boolean;
  salesName: string;
  sourceDocId: string;
  sourceLineId: string;
  dueDateIso: string | null;
  legacyMethodLabel: string;
  legacyStatusLabel: string;
  legacyReconLabel: string;
  notes: string;
  resolvedCustomerId: string | null;
  suggestedCustomerMatch: { customerId: string; custId: string; name: string; via: string } | null;
  resolvedProductId: string | null;
  resolvedSalesStaffId: string | null;
  validationStatus: 'valid' | 'warning' | 'error';
  validationMessages: string[];
  fingerprint: string;
  keepDuplicateConfirmed?: boolean;
}

export interface ImportBatchSummary {
  id: string;
  fileName: string;
  fileHash: string;
  sheetName: string | null;
  taxBasis: TaxBasis;
  groupingMode: 'row_per_doc' | 'by_source_invoice';
  cutoverMode: 'active' | 'legacy_archive' | 'opening_subledger';
  totalRows: number;
  acceptedRows: number;
  reviewRows: number;
  rejectedRows: number;
  status: 'staging' | 'committed' | 'failed';
  createdAt: string;
}

export interface DashboardSummary {
  salesByDeliveryAmount: string;
  salesDocCount: number;
  openReceivableAmount: string;
  openReceivableCount: number;
  waitingVerificationReceiptAmount: string;
  waitingVerificationReceiptCount: number;
  availableVerifiedReceiptAmount: string;
  availableVerifiedReceiptCount: number;
  needsReviewCount: number;
  openDiscrepancyCount: number;
  pendingAccountingEventsCount: number;
  pendingAllocationProposalCount: number;
}

export interface UatTestResult {
  id: string;
  title: string;
  expected: string;
  actual: string;
  passed: boolean;
}
