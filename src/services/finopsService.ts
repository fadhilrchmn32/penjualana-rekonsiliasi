import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase';
import { FinOpsDomainEngine, runDomainUatSuite } from '../engine/demoLedgerEngine';
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
  PlannedPaymentMethod,
  ReconciliationReviewStage,
  ReconciliationStatus,
  RoleCode,
  TaxBasis,
} from '../types/database.types';
import { computeISOWeek, computeMonthCode, todayISOJakarta } from '../lib/dates';
import { toDec } from '../lib/decimal';
import Decimal from 'decimal.js';

export type AppOperationMode = 'live_supabase' | 'demo_isolated' | 'setup_required';

function newIdemKey(prefix: string): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Singleton isolated demo engine (strictly synthetic, zero production DB access)
const demoEngine = new FinOpsDomainEngine();

export interface FinOpsGateway {
  mode: AppOperationMode;
  getSession(): Promise<AppUserSession | null>;
  getBranches(companyId: string): Promise<BranchOption[]>;
  getSettings(companyId: string): Promise<AppSettingsContext>;
  getDashboardSummary(companyId: string, branchId?: string | null): Promise<DashboardSummary>;
  getSalesRecap(params: {
    companyId: string;
    branchId?: string | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    cutoffDate?: string | null;
    includeArchive?: boolean;
  }): Promise<SalesRecapRow[]>;
  getSalesDocumentDetail(salesDocumentId: string): Promise<SalesDocumentDetail>;
  getAllocatableReceipts(companyId: string, branchId?: string | null): Promise<AllocatableReceipt[]>;
  getAllocations(companyId: string, status?: string): Promise<PaymentAllocationItem[]>;
  getCustomerReceivables(companyId: string, asOfDate?: string, branchId?: string | null): Promise<CustomerReceivableRow[]>;
  getReconciliationQueue(companyId: string): Promise<ReconciliationQueueItem[]>;
  getDiscrepancyCases(companyId: string): Promise<DiscrepancyCaseItem[]>;
  getAccountingEvents(companyId: string): Promise<AccountingEventItem[]>;
  getImportBatches(companyId: string): Promise<ImportBatchSummary[]>;
  getCustomers(companyId: string): Promise<MasterCustomer[]>;
  getAliases(companyId: string): Promise<CustomerAlias[]>;
  getProducts(companyId: string): Promise<MasterProduct[]>;
  getStaff(companyId: string): Promise<MasterStaff[]>;
  getTaxCodes(companyId: string): Promise<TaxCodeOption[]>;

  // Mutations (semua lewat RPC terotorisasi)
  draftSale(params: {
    companyId: string;
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
    deliveryProofPath?: string | null;
    lines: SalesLineInput[];
  }): Promise<{ salesDocumentId: string; docNumber: string }>;
  submitSale(salesDocumentId: string, expectedVersion: number): Promise<void>;
  approveAndReleaseSale(params: {
    salesDocumentId: string;
    expectedVersion: number;
    confirmedDeliveryDate?: string;
    approvalNote?: string;
  }): Promise<void>;
  proposePaymentAllocation(params: {
    companyId: string;
    branchId: string;
    items: Array<{ receiptId: string; salesDocumentId: string; allocatedAmount: string; notes?: string }>;
  }): Promise<void>;
  approvePaymentAllocation(allocationIds: string[], notes?: string): Promise<void>;
  reversePaymentAllocation(allocationId: string, expectedVersion: number, reason: string): Promise<void>;
  saveReconciliationReview(params: {
    companyId: string;
    branchId: string;
    salesDocumentId: string;
    reconciliationStatus: ReconciliationStatus;
    reviewStage: ReconciliationReviewStage;
    reasonCode: string | null;
    notes: string;
  }): Promise<void>;
  issueSalesCreditNote(params: {
    originalSalesDocumentId: string;
    issueDate: string;
    reason: string;
    lines: SalesLineInput[];
  }): Promise<void>;
  appendSalesNote(salesDocumentId: string, noteText: string): Promise<void>;
  commitSalesImport(params: {
    companyId: string;
    branchId: string;
    fileName: string;
    fileHash: string;
    sheetName: string;
    dateFormat: string;
    decimalFormat: string;
    taxBasis: TaxBasis;
    groupingMode: 'row_per_doc' | 'by_source_invoice';
    cutoverMode: 'active' | 'legacy_archive' | 'opening_subledger';
    rows: ImportRowPreview[];
    allowDuplicateRows?: boolean;
  }): Promise<{ batchId: string; idempotentReimport: boolean; docsCreated: number; rowsCommitted: number }>;
  upsertCustomer(params: {
    companyId: string;
    branchId: string;
    custId: string;
    name: string;
    phone?: string;
    address?: string;
  }): Promise<void>;
  upsertCustomerAlias(companyId: string, customerId: string, aliasName: string, bankHint?: string): Promise<void>;
  upsertProduct(params: {
    companyId: string;
    sku: string;
    name: string;
    baseUnit: string;
    isStocked: boolean;
  }): Promise<void>;
}

export function createDemoGateway(): FinOpsGateway & {
  switchDemoUser: (userId: string) => void;
  getDemoUsers: () => typeof demoEngine.demoUsers;
  canViewHpp: () => boolean;
  runUat: () => UatTestResult[];
} {
  return {
    mode: 'demo_isolated',
    switchDemoUser: (userId) => demoEngine.switchDemoUser(userId),
    getDemoUsers: () => demoEngine.demoUsers,
    canViewHpp: () => demoEngine.canViewHpp(),
    runUat: () => runDomainUatSuite(),
    async getSession() {
      return demoEngine.getSession();
    },
    async getBranches() {
      return [...demoEngine.branches];
    },
    async getSettings() {
      return { ...demoEngine.settings };
    },
    async getDashboardSummary(_, branchId) {
      return demoEngine.getDashboardSummary(branchId);
    },
    async getSalesRecap(params) {
      return demoEngine.getSalesRecap(params);
    },
    async getSalesDocumentDetail(salesDocumentId) {
      return demoEngine.getSalesDocumentDetail(salesDocumentId);
    },
    async getAllocatableReceipts(_, branchId) {
      return demoEngine.getAllocatableReceipts(branchId);
    },
    async getAllocations(_, status) {
      return demoEngine.getAllocations({ status });
    },
    async getCustomerReceivables(_, asOfDate, branchId) {
      return demoEngine.getCustomerReceivable(asOfDate, branchId);
    },
    async getReconciliationQueue() {
      return demoEngine.getReconciliationQueue();
    },
    async getDiscrepancyCases() {
      return [...demoEngine.discrepancyCases];
    },
    async getAccountingEvents() {
      return [...demoEngine.accountingEvents];
    },
    async getImportBatches() {
      return demoEngine.importBatches.map(({ rows: _rows, ...rest }) => rest);
    },
    async getCustomers() {
      return [...demoEngine.customers];
    },
    async getAliases() {
      return [...demoEngine.aliases];
    },
    async getProducts() {
      return demoEngine.getProductsWithRoleGuard();
    },
    async getStaff() {
      return [...demoEngine.staff];
    },
    async getTaxCodes() {
      return [...demoEngine.taxCodes];
    },
    async draftSale(params) {
      return demoEngine.draftSale({
        idempotencyKey: newIdemKey('draft'),
        ...params,
      });
    },
    async submitSale(salesDocumentId, expectedVersion) {
      demoEngine.submitSale(newIdemKey('sub'), salesDocumentId, expectedVersion);
    },
    async approveAndReleaseSale(params) {
      demoEngine.approveAndReleaseSale({ idempotencyKey: newIdemKey('rel'), ...params });
    },
    async proposePaymentAllocation(params) {
      demoEngine.proposePaymentAllocation({ idempotencyKey: newIdemKey('prop'), ...params });
    },
    async approvePaymentAllocation(allocationIds, notes) {
      demoEngine.approvePaymentAllocation(newIdemKey('appr'), allocationIds, notes);
    },
    async reversePaymentAllocation(allocationId, expectedVersion, reason) {
      demoEngine.reversePaymentAllocation(newIdemKey('rev'), allocationId, expectedVersion, reason);
    },
    async saveReconciliationReview(params) {
      demoEngine.saveReconciliationReview({ idempotencyKey: newIdemKey('rec'), ...params });
    },
    async issueSalesCreditNote(params) {
      demoEngine.issueSalesCreditNote({ idempotencyKey: newIdemKey('cn'), ...params });
    },
    async appendSalesNote(salesDocumentId, noteText) {
      demoEngine.appendNote(salesDocumentId, noteText);
    },
    async commitSalesImport(params) {
      return demoEngine.commitSalesImport({ idempotencyKey: newIdemKey('imp'), ...params });
    },
    async upsertCustomer(params) {
      demoEngine.upsertCustomer(params);
    },
    async upsertCustomerAlias(_, customerId, aliasName, bankHint) {
      demoEngine.upsertCustomerAlias(customerId, aliasName, bankHint);
    },
    async upsertProduct(params) {
      demoEngine.upsertProduct(params);
    },
  };
}

export function createLiveSupabaseGateway(): FinOpsGateway {
  const sb = getSupabaseClient();
  if (!sb) throw new Error('Supabase belum dikonfigurasi.');

  return {
    mode: 'live_supabase',
    async getSession() {
      const { data: authData } = await sb.auth.getUser();
      const user = authData?.user;
      if (!user) return null;

      const { data: profile } = await sb
        .from('profiles')
        .select('id, email, full_name')
        .eq('id', user.id)
        .single();

      const { data: memberships, error: mErr } = await sb
        .from('memberships')
        .select('company_id, branch_id, all_branches, role_code, companies(name), branches(name)')
        .eq('user_id', user.id)
        .eq('is_active', true);

      if (mErr || !memberships || memberships.length === 0) {
        return {
          userId: user.id,
          email: profile?.email || user.email || '',
          fullName: profile?.full_name || user.email || 'Pengguna',
          companyId: '',
          companyName: 'Belum Terdaftar pada Perusahaan',
          branchId: '',
          branchName: '-',
          roles: [],
          allBranches: false,
        };
      }

      const first = memberships[0] as unknown as {
        company_id: string;
        branch_id: string | null;
        all_branches: boolean;
        role_code: RoleCode;
        companies: { name: string } | null;
        branches: { name: string } | null;
      };
      const roles = Array.from(new Set(memberships.map((m) => (m as { role_code: RoleCode }).role_code)));
      let defaultBranchId = first.branch_id || '';
      let defaultBranchName = first.branches?.name || 'Semua Cabang';

      if (!defaultBranchId) {
        const { data: brs } = await sb
          .from('branches')
          .select('id, name')
          .eq('company_id', first.company_id)
          .eq('is_active', true)
          .limit(1);
        if (brs && brs[0]) {
          defaultBranchId = brs[0].id;
          defaultBranchName = brs[0].name;
        }
      }

      return {
        userId: user.id,
        email: profile?.email || user.email || '',
        fullName: profile?.full_name || user.email || '',
        companyId: first.company_id,
        companyName: first.companies?.name || 'Perusahaan',
        branchId: defaultBranchId,
        branchName: defaultBranchName,
        roles,
        allBranches: memberships.some((m) => (m as { all_branches: boolean }).all_branches),
      };
    },
    async getBranches(companyId) {
      const { data, error } = await sb
        .from('branches')
        .select('id, code, name')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .order('code');
      if (error) throw error;
      return data || [];
    },
    async getSettings(companyId) {
      const { data } = await sb
        .from('app_settings')
        .select('app1_url, app2_url, app3_url, reconciliation_label, rounding_scale')
        .eq('company_id', companyId)
        .maybeSingle();
      return {
        app1Url: data?.app1_url ?? null,
        app2Url: data?.app2_url ?? null,
        app3Url: data?.app3_url ?? null,
        reconciliationLabel: data?.reconciliation_label || 'REKONSILIASI (ALMIRA)',
        roundingScale: data?.rounding_scale ?? 0,
      };
    },
    async getDashboardSummary(companyId, branchId) {
      const recap = await this.getSalesRecap({ companyId, branchId });
      const uniqueDocs = new Map<string, SalesRecapRow>();
      for (const r of recap) uniqueDocs.set(r.salesDocumentId, r);
      const docs = Array.from(uniqueDocs.values()).filter((d) => ['approved', 'released'].includes(d.documentStatus));
      let salesAmt = new Decimal(0);
      let openAmt = new Decimal(0);
      let openCount = 0;
      let needsReview = 0;
      for (const d of docs) {
        salesAmt = salesAmt.plus(toDec(d.documentTotalAmount));
        if (toDec(d.outstandingAmount).gt(0)) {
          openAmt = openAmt.plus(toDec(d.outstandingAmount));
          openCount += 1;
        }
        if (['unreviewed', 'needs_review', 'discrepancy'].includes(d.reconciliationStatus)) {
          needsReview += 1;
        }
      }

      const receipts = await this.getAllocatableReceipts(companyId, branchId);
      const waitReceipts = receipts.filter((r) => r.status === 'waiting_verification');
      const availReceipts = receipts.filter(
        (r) => r.status === 'verified' && !r.isUnknownIdentity && toDec(r.availableToAllocate).gt(0)
      );
      const [cases, events, pendingAllocs] = await Promise.all([
        this.getDiscrepancyCases(companyId),
        this.getAccountingEvents(companyId),
        this.getAllocations(companyId, 'proposed'),
      ]);

      return {
        salesByDeliveryAmount: salesAmt.toFixed(2),
        salesDocCount: docs.length,
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
        openDiscrepancyCount: cases.filter((c) => c.status === 'open').length,
        pendingAccountingEventsCount: events.filter((e) =>
          ['waiting_accounting_module', 'queued', 'failed'].includes(e.processingStatus)
        ).length,
        pendingAllocationProposalCount: pendingAllocs.length,
      };
    },
    async getSalesRecap(params) {
      if (params.cutoffDate) {
        const { data, error } = await sb.rpc('get_sales_recap' as never, {
          p_company_id: params.companyId,
          p_branch_id: params.branchId || null,
          p_date_from: params.dateFrom || null,
          p_date_to: params.dateTo || null,
          p_cutoff_date: params.cutoffDate,
          p_include_archive: Boolean(params.includeArchive),
        } as never);
        if (error) throw error;
        const payload = (data as { rows?: Array<Record<string, unknown>> })?.rows || [];
        return payload.map((r) => ({
          salesLineId: String(r.sales_line_id),
          salesDocumentId: String(r.sales_document_id),
          branchId: params.branchId || '',
          docNumber: String(r.doc_number),
          sourceInvoiceNo: (r.source_invoice_no as string | null) ?? null,
          docType: 'sales_invoice',
          documentStatus: r.document_status as SalesRecapRow['documentStatus'],
          deliveryDate: (r.delivery_date as string | null) ?? null,
          isoWeek: String(r.iso_week || computeISOWeek(r.delivery_date as string | null)),
          isoMonth: String(r.iso_month || computeMonthCode(r.delivery_date as string | null)),
          invoiceDate: String(r.delivery_date || ''),
          dueDate: null,
          customerUuid: '',
          custId: String(r.cust_id),
          custName: String(r.cust_name),
          productUuid: '',
          productSku: String(r.product_sku),
          productName: String(r.product_name),
          lineNo: 1,
          unitCode: String(r.unit_code),
          quantity: String(r.quantity),
          netUnitPrice: String(r.net_unit_price),
          lineTotal: String(r.line_total),
          rawSourceTotal: null,
          hasPriceDiscrepancy: false,
          salesStaffId: null,
          salesName: String(r.sales_name || '-'),
          metodePembayaran: 'Belum Ada',
          statusPembayaran: r.status_pembayaran as SalesRecapRow['statusPembayaran'],
          plannedPaymentMethod: 'credit',
          keterangan: String(r.keterangan || ''),
          reconciliationStatus: r.reconciliation_status as SalesRecapRow['reconciliationStatus'],
          reconcilerLabel: String(r.reconciler_label || 'REKONSILIASI (ALMIRA)'),
          reconciledByName: null,
          reconciledAt: null,
          reconciliationNote: null,
          documentTotalAmount: String(r.document_total_amount),
          creditNoteAmount: '0.00',
          netBillAmount: String(r.document_total_amount),
          paidAmount: String(r.paid_amount),
          pendingAllocationAmount: '0.00',
          outstandingAmount: String(r.outstanding_amount),
          customerDepositBalance: '0.00',
          hasPendingVerification: false,
          hasCashAtCollector: false,
          accountingStatus: 'not_ready',
          isLegacyArchive: Boolean(r.is_legacy_archive),
          legacySourceData: {},
          taxBasis: 'non_tax',
          version: 1,
          createdBy: null,
          submittedBy: null,
        }));
      }

      let q = sb.from('v_app2_sales_recap').select('*').eq('company_id', params.companyId);
      if (params.branchId) q = q.eq('branch_id', params.branchId);
      if (!params.includeArchive) q = q.eq('is_legacy_archive', false);
      if (params.dateFrom) q = q.gte('delivery_date', params.dateFrom);
      if (params.dateTo) q = q.lte('delivery_date', params.dateTo);
      const { data, error } = await q.order('delivery_date', { ascending: false });
      if (error) throw error;
      return (data || []).map((r) => ({
        salesLineId: r.sales_line_id,
        salesDocumentId: r.sales_document_id,
        branchId: r.branch_id,
        docNumber: r.doc_number,
        sourceInvoiceNo: r.source_invoice_no,
        docType: r.doc_type as SalesRecapRow['docType'],
        documentStatus: r.document_status,
        deliveryDate: r.delivery_date,
        isoWeek: r.iso_week || '-',
        isoMonth: r.iso_month || '-',
        invoiceDate: r.invoice_date,
        dueDate: r.due_date,
        customerUuid: r.customer_uuid,
        custId: r.cust_id,
        custName: r.cust_name,
        productUuid: r.product_uuid,
        productSku: r.product_sku,
        productName: r.product_name,
        lineNo: r.line_no,
        unitCode: r.unit_code,
        quantity: String(r.quantity),
        netUnitPrice: String(r.net_unit_price),
        lineTotal: String(r.line_total),
        rawSourceTotal: r.raw_source_total ? String(r.raw_source_total) : null,
        hasPriceDiscrepancy: r.has_price_discrepancy,
        salesStaffId: r.sales_staff_id,
        salesName: r.sales_name,
        metodePembayaran: r.metode_pembayaran,
        statusPembayaran: r.status_pembayaran,
        plannedPaymentMethod: r.planned_payment_method,
        keterangan: r.keterangan || '',
        reconciliationStatus: r.reconciliation_status,
        reconcilerLabel: r.reconciler_label,
        reconciledByName: r.reconciled_by_name,
        reconciledAt: r.reconciled_at,
        reconciliationNote: r.reconciliation_note,
        documentTotalAmount: String(r.document_total_amount),
        creditNoteAmount: String(r.credit_note_amount),
        netBillAmount: String(r.net_bill_amount),
        paidAmount: String(r.paid_amount),
        pendingAllocationAmount: String(r.pending_allocation_amount),
        outstandingAmount: String(r.outstanding_amount),
        customerDepositBalance: String(r.customer_deposit_balance),
        hasPendingVerification: r.has_pending_verification,
        hasCashAtCollector: r.has_cash_at_collector,
        accountingStatus: r.accounting_status,
        isLegacyArchive: r.is_legacy_archive,
        legacySourceData: (r.legacy_source_data as Record<string, unknown>) || {},
        taxBasis: r.tax_basis,
        version: r.version,
        createdBy: null,
        submittedBy: null,
      }));
    },
    async getSalesDocumentDetail(salesDocumentId) {
      const [{ data: doc, error: dErr }, { data: bal }, { data: lines }, { data: notes }, { data: audits }] =
        await Promise.all([
          sb.from('sales_documents').select('*, customers(cust_id, name), staff(full_name)').eq('id', salesDocumentId).single(),
          sb.from('v_app2_document_balances').select('*').eq('sales_document_id', salesDocumentId).maybeSingle(),
          sb.from('sales_lines').select('*, products(sku, name)').eq('sales_document_id', salesDocumentId).order('line_no'),
          sb.from('sales_document_notes').select('*, profiles(full_name)').eq('sales_document_id', salesDocumentId).order('created_at', { ascending: false }),
          sb.from('audit_events').select('*, profiles(full_name)').eq('entity_id', salesDocumentId).order('created_at', { ascending: false }),
        ]);
      if (dErr || !doc) throw dErr || new Error('Dokumen tidak ditemukan atau akses ditolak RLS.');
      const allocs = await this.getAllocations(doc.company_id);
      const custObj = (doc as unknown as { customers?: { cust_id: string; name: string } }).customers;
      const stfObj = (doc as unknown as { staff?: { full_name: string } }).staff;
      return {
        id: doc.id,
        companyId: doc.company_id,
        branchId: doc.branch_id,
        docNumber: doc.doc_number,
        sourceInvoiceNo: doc.source_invoice_no,
        docType: doc.doc_type,
        customerId: doc.customer_id,
        custId: custObj?.cust_id || '-',
        custName: custObj?.name || '-',
        salesStaffId: doc.sales_staff_id,
        salesName: stfObj?.full_name || '-',
        invoiceDate: doc.invoice_date,
        deliveryDate: doc.delivery_date,
        dueDate: doc.due_date,
        plannedPaymentMethod: doc.planned_payment_method,
        taxBasis: doc.tax_basis,
        taxCodeId: doc.tax_code_id,
        subtotalAmount: String(doc.subtotal_amount),
        taxAmount: String(doc.tax_amount),
        roundingDiff: String(doc.rounding_diff),
        totalAmount: String(doc.total_amount),
        creditNoteAmount: String(bal?.credit_note_amount || '0.00'),
        netBillAmount: String(bal?.net_bill_amount || doc.total_amount),
        paidAmount: String(bal?.paid_amount || '0.00'),
        pendingAllocationAmount: String(bal?.pending_allocation_amount || '0.00'),
        outstandingAmount: String(bal?.outstanding_amount || doc.total_amount),
        derivedPaymentMethod: bal?.derived_payment_method || 'Belum Ada',
        derivedPaymentStatus: bal?.derived_payment_status || doc.payment_status,
        hasPendingVerification: Boolean(bal?.has_pending_verification),
        hasCashAtCollector: Boolean(bal?.has_cash_at_collector),
        status: doc.status,
        reconciliationStatus: doc.reconciliation_status,
        reconciledByName: null,
        reconciledAt: doc.reconciled_at,
        reconciliationNote: doc.reconciliation_note,
        accountingStatus: doc.accounting_status,
        deliveryProofPath: doc.delivery_proof_path,
        notes: doc.notes,
        isLegacyArchive: doc.is_legacy_archive,
        amendedFromId: doc.amended_from_id,
        createdBy: doc.created_by,
        submittedBy: doc.submitted_by,
        approvedBy: doc.approved_by,
        version: doc.version,
        lines: (lines || []).map((l) => {
          const pObj = (l as unknown as { products?: { sku: string; name: string } }).products;
          return {
            id: l.id,
            lineNo: l.line_no,
            productId: l.product_id,
            sku: l.product_sku_snapshot || pObj?.sku || '-',
            productName: l.product_name_snapshot || pObj?.name || '-',
            unitCode: l.unit_code,
            quantity: String(l.quantity),
            netUnitPrice: String(l.net_unit_price),
            lineTotalRaw: String(l.line_total_raw),
            lineTotal: String(l.line_total),
            roundingDiff: String(l.rounding_diff),
            rawSourceTotal: l.raw_source_total ? String(l.raw_source_total) : null,
            hasPriceDiscrepancy: l.has_price_discrepancy,
            notes: l.notes,
          };
        }),
        allocations: allocs.filter((a) => a.salesDocumentId === doc.id),
        appendNotes: (notes || []).map((n) => ({
          id: n.id,
          noteText: n.note_text,
          createdByName: (n as unknown as { profiles?: { full_name: string } }).profiles?.full_name || '-',
          createdAt: n.created_at,
        })),
        auditTrail: (audits || []).map((a) => ({
          id: a.id,
          eventAction: a.event_action,
          actorName: (a as unknown as { profiles?: { full_name: string } }).profiles?.full_name || '-',
          reason: a.reason,
          createdAt: a.created_at,
        })),
      };
    },
    async getAllocatableReceipts(companyId, branchId) {
      let q = sb.from('v_app2_allocatable_receipts').select('*').eq('company_id', companyId);
      if (branchId) q = q.eq('branch_id', branchId);
      const { data, error } = await q.order('customer_paid_at', { ascending: false });
      if (error) throw error;
      return (data || []).map((r) => ({
        receiptId: r.receipt_id,
        companyId: r.company_id,
        branchId: r.branch_id,
        receiptNumber: r.receipt_number,
        receiptChannel: r.receipt_channel,
        customerId: r.customer_id,
        custId: r.cust_id,
        customerName: r.customer_name,
        isUnknownIdentity: r.is_unknown_identity,
        senderNameRaw: r.sender_name_raw,
        customerPaidAt: r.customer_paid_at,
        bankValueDate: r.bank_value_date,
        verifiedAt: r.verified_at,
        customerGrossAmount: String(r.customer_gross_amount),
        verifiedAmount: String(r.verified_amount),
        allocatedAmount: String(r.allocated_amount),
        pendingProposedAmount: '0.00',
        refundedAmount: String(r.refunded_amount),
        availableToAllocate: String(r.available_to_allocate),
        optionalInvoiceRef: r.optional_invoice_ref,
        status: r.status,
        depositStatus: r.deposit_status,
        collectorName: null,
        evidencePath: null,
        version: r.version,
      }));
    },
    async getAllocations(companyId, status) {
      let q = sb
        .from('payment_allocations')
        .select('*, receipts(receipt_number, receipt_channel, customer_paid_at, deposit_status), sales_documents(doc_number, customer_id, customers(name))')
        .eq('company_id', companyId);
      if (status) q = q.eq('status', status as 'proposed' | 'approved' | 'rejected' | 'reversed');
      const { data, error } = await q.order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map((a) => {
        const rec = (a as unknown as { receipts?: { receipt_number: string; receipt_channel: 'bank_transfer' | 'cash'; customer_paid_at: string; deposit_status: string } }).receipts;
        const sd = (a as unknown as { sales_documents?: { doc_number: string; customer_id: string; customers?: { name: string } } }).sales_documents;
        return {
          id: a.id,
          receiptId: a.receipt_id,
          receiptNumber: rec?.receipt_number || '-',
          receiptChannel: rec?.receipt_channel || 'bank_transfer',
          customerPaidAt: rec?.customer_paid_at || '-',
          depositStatus: rec?.deposit_status || 'not_applicable',
          salesDocumentId: a.sales_document_id,
          docNumber: sd?.doc_number || '-',
          customerId: sd?.customer_id || '',
          custName: sd?.customers?.name || '-',
          allocatedAmount: String(a.allocated_amount),
          status: a.status,
          notes: a.notes,
          createdBy: a.created_by,
          createdByName: a.created_by,
          approvedBy: a.approved_by,
          approvedByName: a.approved_by,
          approvedAt: a.approved_at,
          version: a.version,
        };
      });
    },
    async getCustomerReceivables(companyId, asOfDate, branchId) {
      const { data, error } = await sb.rpc('get_customer_receivable' as never, {
        p_company_id: companyId,
        p_branch_id: branchId || null,
        p_customer_id: null,
        p_as_of_date: asOfDate || todayISOJakarta(),
      } as never);
      if (error) throw error;
      const list = (data as { customers?: Array<Record<string, unknown>> })?.customers || [];
      return list.map((c) => ({
        customerUuid: String(c.customer_uuid),
        custId: String(c.cust_id),
        custName: String(c.cust_name),
        totalBilled: String(c.total_billed),
        totalPaid: String(c.total_paid),
        totalOutstanding: String(c.total_outstanding),
        aging0To30: String(c.aging_0_30),
        aging31To60: String(c.aging_31_60),
        aging61To90: String(c.aging_61_90),
        agingOver90: String(c.aging_over_90),
        titipanBalance: String(c.titipan_balance),
      }));
    },
    async getReconciliationQueue(companyId) {
      const [{ data: docs, error }, { data: revs }] = await Promise.all([
        sb.from('v_app2_document_balances').select('*, customers:customer_id(cust_id, name)').eq('company_id', companyId).eq('is_legacy_archive', false),
        sb.from('reconciliation_reviews').select('*').eq('company_id', companyId),
      ]);
      if (error) throw error;
      return (docs || []).map((d) => {
        const rev = (revs || []).find((r) => r.target_id === d.sales_document_id);
        const cObj = (d as unknown as { customers?: { cust_id: string; name: string } }).customers;
        return {
          salesDocumentId: d.sales_document_id,
          docNumber: d.doc_number,
          sourceInvoiceNo: d.source_invoice_no,
          deliveryDate: d.delivery_date,
          custId: cObj?.cust_id || '-',
          custName: cObj?.name || '-',
          netBillAmount: String(d.net_bill_amount),
          paidAmount: String(d.paid_amount),
          outstandingAmount: String(d.outstanding_amount),
          derivedPaymentStatus: d.derived_payment_status,
          hasPendingVerification: d.has_pending_verification,
          hasCashAtCollector: d.has_cash_at_collector,
          reconciliationStatus: d.reconciliation_status,
          reviewStage: rev?.review_stage || 'ready_to_match',
          reasonCode: rev?.reason_code || null,
          notes: d.reconciliation_note || rev?.notes || null,
          reconciledByName: null,
          reconciledAt: d.reconciled_at,
          actionOwnerHint: 'Reviewer Rekonsiliasi',
          problemSummary: d.reconciliation_note || 'Siap ditinjau atau dicocokkan.',
        };
      });
    },
    async getDiscrepancyCases(companyId) {
      const { data, error } = await sb
        .from('discrepancy_cases')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map((c) => ({
        id: c.id,
        caseNumber: c.case_number,
        caseType: c.case_type,
        sourceType: c.source_type,
        sourceId: c.source_id,
        expectedAmount: c.expected_amount ? String(c.expected_amount) : null,
        actualAmount: c.actual_amount ? String(c.actual_amount) : null,
        discrepancyAmount: String(c.discrepancy_amount),
        status: c.status,
        resolutionNote: c.resolution_note,
        createdAt: c.created_at,
      }));
    },
    async getAccountingEvents(companyId) {
      const { data, error } = await sb
        .from('accounting_events')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []).map((e) => ({
        id: e.id,
        eventType: e.event_type,
        sourceType: e.source_type,
        sourceId: e.source_id,
        sourceVersion: e.source_version,
        effectiveDate: e.effective_date,
        processingStatus: e.processing_status,
        dependencyIds: e.dependency_ids || [],
        payloadSnapshot: (e.payload_snapshot as Record<string, unknown>) || {},
        createdAt: e.created_at,
      }));
    },
    async getImportBatches(companyId) {
      const { data, error } = await sb
        .from('import_batches')
        .select('*')
        .eq('company_id', companyId)
        .eq('import_type', 'sales_recap')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map((b) => ({
        id: b.id,
        fileName: b.file_name,
        fileHash: b.file_hash,
        sheetName: b.sheet_name,
        taxBasis: (b.tax_basis as TaxBasis) || 'non_tax',
        groupingMode: (b.grouping_mode as 'row_per_doc' | 'by_source_invoice') || 'row_per_doc',
        cutoverMode: b.cutover_mode,
        totalRows: b.total_rows,
        acceptedRows: b.accepted_rows,
        reviewRows: b.review_rows,
        rejectedRows: b.rejected_rows,
        status: b.status,
        createdAt: b.created_at,
      }));
    },
    async getCustomers(companyId) {
      const { data, error } = await sb.from('customers').select('*').eq('company_id', companyId).order('cust_id');
      if (error) throw error;
      return (data || []).map((c) => ({
        id: c.id,
        companyId: c.company_id,
        branchId: c.branch_id,
        custId: c.cust_id,
        name: c.name,
        defaultSalesId: c.default_sales_id,
        phone: c.phone,
        address: c.address,
        isActive: c.is_active,
      }));
    },
    async getAliases(companyId) {
      const { data, error } = await sb.from('customer_aliases').select('*').eq('company_id', companyId);
      if (error) throw error;
      return (data || []).map((a) => ({
        id: a.id,
        companyId: a.company_id,
        customerId: a.customer_id,
        aliasName: a.alias_name,
        sourceBankAccountHint: a.source_bank_account_hint,
      }));
    },
    async getProducts(companyId) {
      const { data, error } = await sb.from('products').select('*').eq('company_id', companyId).order('sku');
      if (error) throw error;
      const { data: vals } = await sb.from('inventory_valuations').select('product_id, qty_on_hand, avg_unit_cost').eq('company_id', companyId);
      return (data || []).map((p) => {
        const v = (vals || []).find((x) => x.product_id === p.id);
        return {
          id: p.id,
          companyId: p.company_id,
          sku: p.sku,
          name: p.name,
          baseUnit: p.base_unit,
          isStocked: p.is_stocked,
          isActive: p.is_active,
          qtyOnHand: v ? String(v.qty_on_hand) : undefined,
          avgUnitCost: v ? String(v.avg_unit_cost) : undefined,
        };
      });
    },
    async getStaff(companyId) {
      const { data, error } = await sb.from('staff').select('*').eq('company_id', companyId).order('staff_code');
      if (error) throw error;
      return (data || []).map((s) => ({
        id: s.id,
        companyId: s.company_id,
        branchId: s.branch_id,
        staffCode: s.staff_code,
        fullName: s.full_name,
        staffRole: s.staff_role,
        isActive: s.is_active,
      }));
    },
    async getTaxCodes(companyId) {
      const { data, error } = await sb.from('tax_codes').select('id, code, name, rate').eq('company_id', companyId).eq('is_active', true);
      if (error) throw error;
      return (data || []).map((t) => ({ id: t.id, code: t.code, name: t.name, rate: String(t.rate) }));
    },

    // --- RPC MUTATIONS ---
    async draftSale(params) {
      const { data, error } = await sb.rpc('draft_sale' as never, {
        p_idempotency_key: newIdemKey('draft'),
        p_company_id: params.companyId,
        p_branch_id: params.branchId,
        p_customer_id: params.customerId,
        p_sales_staff_id: params.salesStaffId,
        p_invoice_date: params.invoiceDate,
        p_delivery_date: params.deliveryDate,
        p_due_date: params.dueDate,
        p_planned_payment_method: params.plannedPaymentMethod,
        p_tax_basis: params.taxBasis,
        p_tax_code_id: params.taxCodeId,
        p_source_invoice_no: params.sourceInvoiceNo,
        p_notes: params.notes,
        p_delivery_proof_path: params.deliveryProofPath || null,
        p_lines: params.lines.map((l) => ({
          product_id: l.productId,
          unit_code: l.unitCode,
          quantity: l.quantity,
          net_unit_price: l.netUnitPrice,
          notes: l.notes || null,
        })),
      } as never);
      if (error) throw error;
      const r = data as { sales_document_id: string; doc_number: string };
      return { salesDocumentId: r.sales_document_id, docNumber: r.doc_number };
    },
    async submitSale(salesDocumentId, expectedVersion) {
      const { error } = await sb.rpc('submit_sale' as never, {
        p_idempotency_key: newIdemKey('sub'),
        p_sales_document_id: salesDocumentId,
        p_expected_version: expectedVersion,
      } as never);
      if (error) throw error;
    },
    async approveAndReleaseSale(params) {
      const { error } = await sb.rpc('approve_and_release_sale' as never, {
        p_idempotency_key: newIdemKey('rel'),
        p_sales_document_id: params.salesDocumentId,
        p_expected_version: params.expectedVersion,
        p_confirmed_delivery_date: params.confirmedDeliveryDate || null,
        p_approval_note: params.approvalNote || null,
      } as never);
      if (error) throw error;
    },
    async proposePaymentAllocation(params) {
      const { error } = await sb.rpc('propose_payment_allocation' as never, {
        p_idempotency_key: newIdemKey('prop'),
        p_company_id: params.companyId,
        p_branch_id: params.branchId,
        p_items: params.items.map((i) => ({
          receipt_id: i.receiptId,
          sales_document_id: i.salesDocumentId,
          allocated_amount: i.allocatedAmount,
          notes: i.notes || null,
        })),
      } as never);
      if (error) throw error;
    },
    async approvePaymentAllocation(allocationIds, notes) {
      const { error } = await sb.rpc('approve_payment_allocation' as never, {
        p_idempotency_key: newIdemKey('appr'),
        p_allocation_ids: allocationIds,
        p_notes: notes || null,
      } as never);
      if (error) throw error;
    },
    async reversePaymentAllocation(allocationId, expectedVersion, reason) {
      const { error } = await sb.rpc('reverse_payment_allocation' as never, {
        p_idempotency_key: newIdemKey('rev'),
        p_allocation_id: allocationId,
        p_expected_version: expectedVersion,
        p_reason: reason,
      } as never);
      if (error) throw error;
    },
    async saveReconciliationReview(params) {
      const { error } = await sb.rpc('save_reconciliation_review' as never, {
        p_idempotency_key: newIdemKey('rec'),
        p_company_id: params.companyId,
        p_branch_id: params.branchId,
        p_sales_document_id: params.salesDocumentId,
        p_reconciliation_status: params.reconciliationStatus,
        p_review_stage: params.reviewStage,
        p_reason_code: params.reasonCode,
        p_notes: params.notes,
      } as never);
      if (error) throw error;
    },
    async issueSalesCreditNote(params) {
      const { error } = await sb.rpc('issue_sales_credit_note' as never, {
        p_idempotency_key: newIdemKey('cn'),
        p_original_sales_document_id: params.originalSalesDocumentId,
        p_issue_date: params.issueDate,
        p_reason: params.reason,
        p_lines: params.lines.map((l) => ({
          product_id: l.productId,
          unit_code: l.unitCode,
          quantity: l.quantity,
          net_unit_price: l.netUnitPrice,
        })),
      } as never);
      if (error) throw error;
    },
    async appendSalesNote(salesDocumentId, noteText) {
      const { error } = await sb.rpc('append_sales_note' as never, {
        p_idempotency_key: newIdemKey('note'),
        p_sales_document_id: salesDocumentId,
        p_note_text: noteText,
      } as never);
      if (error) throw error;
    },
    async commitSalesImport(params) {
      const { data: previewData, error: pErr } = await sb.rpc('preview_sales_import' as never, {
        p_idempotency_key: newIdemKey('prev'),
        p_company_id: params.companyId,
        p_branch_id: params.branchId,
        p_file_name: params.fileName,
        p_file_hash: params.fileHash,
        p_sheet_name: params.sheetName,
        p_mapping_version: 'v1',
        p_date_format: params.dateFormat,
        p_decimal_format: params.decimalFormat,
        p_tax_basis: params.taxBasis,
        p_grouping_mode: params.groupingMode,
        p_cutover_mode: params.cutoverMode,
        p_rows: params.rows.map((r) => ({
          row_no: r.rowNo,
          raw_data: r.rawCells,
          cust_id: r.custId,
          cust_name: r.custName,
          product_sku: r.productSku,
          product_name: r.productName,
          unit_code: r.unitCode,
          quantity: r.quantity,
          net_unit_price: r.netUnitPrice,
          total_sales: r.rawTotalSales,
          sales_name: r.salesName,
          delivery_date_iso: r.deliveryDateIso,
          source_doc_id: r.sourceDocId,
          source_line_id: r.sourceLineId,
          client_validation_status: r.validationStatus,
          client_validation_message: r.validationMessages.join('; '),
          parsed_data: {
            product_sku: r.productSku,
            product_name: r.productName,
            unit_code: r.unitCode,
            quantity: r.quantity,
            net_unit_price: r.netUnitPrice,
            raw_total_sales: r.rawTotalSales,
            has_price_discrepancy: r.hasPriceDiscrepancy,
            notes: r.notes,
          },
          legacy_source_data: {
            legacy_method: r.legacyMethodLabel,
            legacy_status: r.legacyStatusLabel,
            legacy_recon: r.legacyReconLabel,
            week_raw: r.weekRaw,
            month_raw: r.monthRaw,
          },
        })),
      } as never);
      if (pErr) throw pErr;
      const batchId = (previewData as { batch_id: string }).batch_id;
      const { data: commitData, error: cErr } = await sb.rpc('commit_sales_import' as never, {
        p_idempotency_key: newIdemKey('comm'),
        p_batch_id: batchId,
        p_expected_version: 1,
        p_allow_duplicate_rows: Boolean(params.allowDuplicateRows),
      } as never);
      if (cErr) throw cErr;
      const res = commitData as {
        batch_id: string;
        idempotent_reimport?: boolean;
        docs_created?: number;
        rows_committed?: number;
      };
      return {
        batchId: res.batch_id,
        idempotentReimport: Boolean(res.idempotent_reimport),
        docsCreated: res.docs_created || 0,
        rowsCommitted: res.rows_committed || 0,
      };
    },
    async upsertCustomer(params) {
      const { error } = await sb.rpc('upsert_customer_master' as never, {
        p_idempotency_key: newIdemKey('cust'),
        p_company_id: params.companyId,
        p_branch_id: params.branchId,
        p_cust_id: params.custId,
        p_name: params.name,
        p_phone: params.phone || null,
        p_address: params.address || null,
      } as never);
      if (error) throw error;
    },
    async upsertCustomerAlias(companyId, customerId, aliasName, bankHint) {
      const { error } = await sb.rpc('upsert_customer_alias' as never, {
        p_idempotency_key: newIdemKey('alias'),
        p_company_id: companyId,
        p_customer_id: customerId,
        p_alias_name: aliasName,
        p_source_bank_account_hint: bankHint || null,
      } as never);
      if (error) throw error;
    },
    async upsertProduct(params) {
      const { error } = await sb.rpc('upsert_product_master' as never, {
        p_idempotency_key: newIdemKey('prd'),
        p_company_id: params.companyId,
        p_sku: params.sku,
        p_name: params.name,
        p_base_unit: params.baseUnit,
        p_is_stocked: params.isStocked,
      } as never);
      if (error) throw error;
    },
  };
}

export function getInitialOperationMode(): AppOperationMode {
  return isSupabaseConfigured ? 'live_supabase' : 'setup_required';
}
