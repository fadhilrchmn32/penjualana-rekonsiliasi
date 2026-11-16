export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type RoleCode =
  | 'finance_maker'
  | 'finance_checker'
  | 'sales_admin'
  | 'reconciliation_reviewer'
  | 'accountant'
  | 'accounting_approver'
  | 'owner_viewer'
  | 'system_admin'
  | 'collector_optional';

export type SalesDocumentStatus =
  | 'draft'
  | 'pending_delivery'
  | 'submitted'
  | 'approved'
  | 'released'
  | 'corrected'
  | 'voided';

export type PaymentStatus = 'unpaid' | 'partially_paid' | 'paid' | 'overpaid';

export type AccountingStatus =
  | 'not_ready'
  | 'queued'
  | 'draft_journal'
  | 'posted'
  | 'failed'
  | 'reversed';

export type ReconciliationStatus =
  | 'unreviewed'
  | 'matched'
  | 'needs_review'
  | 'discrepancy'
  | 'reviewed';

export type ReconciliationReviewStage =
  | 'waiting_finance_verification'
  | 'ready_to_match'
  | 'allocation_pending_review'
  | 'matched'
  | 'discrepancy'
  | 'completed';

export type TaxBasis = 'tax_exclusive' | 'tax_inclusive' | 'non_tax';

export type PlannedPaymentMethod = 'credit' | 'transfer' | 'cash' | 'mixed' | 'unknown';

type TableDef<R extends Record<string, unknown>> = {
  Row: R;
  Insert: Partial<R>;
  Update: Partial<R>;
  Relationships: [];
};

type ViewDef<R extends Record<string, unknown>> = {
  Row: R;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      companies: TableDef<{
        id: string;
        code: string;
        name: string;
        legal_name: string | null;
        tax_id: string | null;
        base_currency: string;
        timezone: string;
        is_active: boolean;
        version: number;
        created_at: string;
        updated_at: string;
      }>;
      branches: TableDef<{
        id: string;
        company_id: string;
        code: string;
        name: string;
        address: string | null;
        is_headquarters: boolean;
        is_active: boolean;
        version: number;
        created_at: string;
        updated_at: string;
      }>;
      profiles: TableDef<{
        id: string;
        email: string;
        full_name: string;
        phone: string | null;
        is_active: boolean;
        created_at: string;
        updated_at: string;
      }>;
      memberships: TableDef<{
        id: string;
        user_id: string;
        company_id: string;
        branch_id: string | null;
        all_branches: boolean;
        role_code: RoleCode;
        is_active: boolean;
        granted_by: string | null;
        created_at: string;
        updated_at: string;
      }>;
      app_settings: TableDef<{
        id: string;
        company_id: string;
        app1_url: string | null;
        app2_url: string | null;
        app3_url: string | null;
        reconciliation_label: string;
        rounding_mode: string;
        rounding_scale: number;
        auto_post_enabled: boolean;
        require_evidence_for_transfer: boolean;
        require_evidence_for_cash: boolean;
        updated_by: string | null;
        version: number;
        created_at: string;
        updated_at: string;
      }>;
      staff: TableDef<{
        id: string;
        company_id: string;
        branch_id: string;
        profile_id: string | null;
        staff_code: string;
        full_name: string;
        staff_role: 'sales' | 'driver' | 'collector' | 'finance' | 'admin';
        phone: string | null;
        is_active: boolean;
        version: number;
        created_at: string;
        updated_at: string;
      }>;
      customers: TableDef<{
        id: string;
        company_id: string;
        branch_id: string;
        cust_id: string;
        name: string;
        default_sales_id: string | null;
        phone: string | null;
        address: string | null;
        is_active: boolean;
        version: number;
        created_at: string;
        updated_at: string;
      }>;
      customer_aliases: TableDef<{
        id: string;
        company_id: string;
        customer_id: string;
        alias_name: string;
        source_bank_account_hint: string | null;
        created_by: string | null;
        created_at: string;
      }>;
      products: TableDef<{
        id: string;
        company_id: string;
        sku: string;
        name: string;
        base_unit: string;
        is_stocked: boolean;
        is_active: boolean;
        version: number;
        created_at: string;
        updated_at: string;
      }>;
      product_units: TableDef<{
        id: string;
        company_id: string;
        product_id: string;
        unit_code: string;
        conversion_factor: string;
      }>;
      tax_codes: TableDef<{
        id: string;
        company_id: string;
        code: string;
        name: string;
        rate: string;
        coa_code: string | null;
        is_active: boolean;
      }>;
      sales_documents: TableDef<{
        id: string;
        company_id: string;
        branch_id: string;
        doc_number: string;
        source_invoice_no: string | null;
        doc_type: 'sales_invoice' | 'credit_note' | 'debit_note';
        customer_id: string;
        sales_staff_id: string | null;
        invoice_date: string;
        delivery_date: string | null;
        due_date: string | null;
        currency: string;
        subtotal_amount: string;
        tax_amount: string;
        rounding_diff: string;
        total_amount: string;
        status: SalesDocumentStatus;
        payment_status: PaymentStatus;
        accounting_status: AccountingStatus;
        planned_payment_method: PlannedPaymentMethod;
        tax_basis: TaxBasis;
        tax_code_id: string | null;
        delivery_confirmed_at: string | null;
        delivery_confirmed_by: string | null;
        delivery_proof_path: string | null;
        submitted_by: string | null;
        submitted_at: string | null;
        released_by: string | null;
        released_at: string | null;
        reconciliation_status: ReconciliationStatus;
        reconciled_by: string | null;
        reconciled_at: string | null;
        reconciliation_note: string | null;
        reconciler_label: string;
        is_legacy_archive: boolean;
        legacy_source_data: Json;
        import_batch_id: string | null;
        import_row_id: string | null;
        source_version: number;
        notes: string | null;
        amended_from_id: string | null;
        created_by: string | null;
        updated_by: string | null;
        approved_by: string | null;
        reason: string | null;
        version: number;
        source_app: string;
        correlation_id: string;
        created_at: string;
        updated_at: string;
      }>;
      sales_lines: TableDef<{
        id: string;
        company_id: string;
        sales_document_id: string;
        line_no: number;
        product_id: string;
        product_sku_snapshot: string | null;
        product_name_snapshot: string | null;
        unit_code: string;
        quantity: string;
        net_unit_price: string;
        line_total_raw: string;
        line_total: string;
        rounding_diff: string;
        tax_code_id: string | null;
        tax_amount: string;
        raw_source_total: string | null;
        has_price_discrepancy: boolean;
        discrepancy_note: string | null;
        source_line_id: string | null;
        notes: string | null;
        legacy_source_data: Json;
      }>;
      sales_document_notes: TableDef<{
        id: string;
        company_id: string;
        branch_id: string;
        sales_document_id: string;
        note_text: string;
        created_by: string;
        created_at: string;
      }>;
      receipts: TableDef<{
        id: string;
        company_id: string;
        branch_id: string;
        receipt_number: string;
        receipt_channel: 'bank_transfer' | 'cash';
        currency: string;
        customer_gross_amount: string;
        bank_net_amount: string;
        bank_fee_amount: string;
        bank_fee_bearer: 'none' | 'company' | 'customer' | 'pending_review';
        verified_amount: string;
        customer_paid_at: string;
        bank_value_date: string | null;
        verified_at: string | null;
        accounting_date: string | null;
        is_unknown_identity: boolean;
        customer_id: string | null;
        sender_name_raw: string | null;
        fund_account_id: string | null;
        bank_reference: string | null;
        optional_invoice_ref: string | null;
        actual_collector_id: string | null;
        sales_owner_id: string | null;
        notes: string | null;
        status: 'draft' | 'submitted' | 'waiting_verification' | 'verified' | 'rejected' | 'reversal_requested' | 'reversed';
        deposit_status: 'not_applicable' | 'not_deposited' | 'partially_deposited' | 'deposited' | 'discrepancy';
        reconciliation_status: ReconciliationStatus;
        accounting_status: AccountingStatus;
        version: number;
        created_at: string;
      }>;
      payment_allocations: TableDef<{
        id: string;
        company_id: string;
        branch_id: string;
        receipt_id: string;
        sales_document_id: string;
        allocated_amount: string;
        status: 'proposed' | 'approved' | 'rejected' | 'reversed';
        notes: string | null;
        created_by: string;
        approved_by: string | null;
        approved_at: string | null;
        version: number;
        source_app: string;
        created_at: string;
      }>;
      reconciliation_reviews: TableDef<{
        id: string;
        company_id: string;
        branch_id: string | null;
        target_type: string;
        target_id: string;
        status: 'open' | 'in_review' | 'resolved' | 'rejected';
        review_stage: ReconciliationReviewStage;
        assigned_role: string;
        reviewer_label: string;
        reason_code: string | null;
        notes: string | null;
        structured_notes: Json;
        created_by: string;
        resolved_by: string | null;
        resolved_at: string | null;
        version: number;
        created_at: string;
      }>;
      discrepancy_cases: TableDef<{
        id: string;
        company_id: string;
        branch_id: string;
        case_number: string;
        case_type: string;
        source_type: string;
        source_id: string;
        expected_amount: string | null;
        actual_amount: string | null;
        discrepancy_amount: string;
        status: 'open' | 'investigating' | 'pending_approval' | 'resolved' | 'closed';
        proposed_resolution: string | null;
        resolution_note: string | null;
        created_by: string;
        resolved_by: string | null;
        resolved_at: string | null;
        version: number;
        created_at: string;
      }>;
      accounting_events: TableDef<{
        id: string;
        company_id: string;
        branch_id: string;
        event_type: string;
        source_type: string;
        source_id: string;
        source_version: number;
        effective_date: string;
        payload_snapshot: Json;
        mapping_version: string;
        dependency_ids: string[];
        processing_status: 'waiting_accounting_module' | 'queued' | 'draft_journal' | 'posted' | 'failed' | 'reversed';
        error_message: string | null;
        retry_count: number;
        created_at: string;
      }>;
      inventory_valuations: TableDef<{
        id: string;
        company_id: string;
        branch_id: string;
        product_id: string;
        qty_on_hand: string;
        avg_unit_cost: string;
        total_value: string;
        updated_at: string;
      }>;
      import_batches: TableDef<{
        id: string;
        company_id: string;
        branch_id: string | null;
        import_type: string;
        file_name: string;
        file_hash: string;
        sheet_name: string | null;
        mapping_version: string;
        date_format: string | null;
        decimal_format: string | null;
        tax_basis: string | null;
        grouping_mode: string | null;
        cutover_mode: 'active' | 'legacy_archive' | 'opening_subledger';
        total_rows: number;
        accepted_rows: number;
        rejected_rows: number;
        review_rows: number;
        status: 'staging' | 'committed' | 'failed';
        created_by: string;
        committed_by: string | null;
        committed_at: string | null;
        version: number;
        metadata: Json;
        created_at: string;
      }>;
      import_rows: TableDef<{
        id: string;
        company_id: string;
        batch_id: string;
        row_no: number;
        raw_data: Json;
        validation_status: 'valid' | 'warning' | 'error';
        validation_message: string | null;
        fingerprint: string | null;
        source_doc_id: string | null;
        source_line_id: string | null;
        delivery_date: string | null;
        resolved_customer_id: string | null;
        resolved_product_id: string | null;
        resolved_sales_staff_id: string | null;
        parsed_data: Json;
        legacy_source_data: Json;
        resolution_status: string;
        created_sales_document_id: string | null;
      }>;
      audit_events: TableDef<{
        id: string;
        company_id: string;
        branch_id: string | null;
        actor_id: string | null;
        event_action: string;
        entity_type: string;
        entity_id: string;
        before_state: Json | null;
        after_state: Json | null;
        reason: string | null;
        source_app: string;
        created_at: string;
      }>;
    };
    Views: {
      v_app2_allocatable_receipts: ViewDef<{
        receipt_id: string;
        company_id: string;
        branch_id: string;
        receipt_number: string;
        receipt_channel: 'bank_transfer' | 'cash';
        customer_id: string | null;
        cust_id: string | null;
        customer_name: string | null;
        is_unknown_identity: boolean;
        sender_name_raw: string | null;
        customer_paid_at: string;
        bank_value_date: string | null;
        verified_at: string | null;
        currency: string;
        customer_gross_amount: string;
        verified_amount: string;
        allocated_amount: string;
        refunded_amount: string;
        available_to_allocate: string;
        optional_invoice_ref: string | null;
        status: string;
        deposit_status: string;
        reconciliation_status: string;
        accounting_status: string;
        version: number;
      }>;
      v_app2_document_balances: ViewDef<{
        sales_document_id: string;
        company_id: string;
        branch_id: string;
        doc_number: string;
        source_invoice_no: string | null;
        doc_type: string;
        customer_id: string;
        sales_staff_id: string | null;
        invoice_date: string;
        delivery_date: string | null;
        due_date: string | null;
        status: SalesDocumentStatus;
        total_amount: string;
        credit_note_amount: string;
        net_bill_amount: string;
        paid_amount: string;
        pending_allocation_amount: string;
        outstanding_amount: string;
        derived_payment_status: PaymentStatus;
        derived_payment_method: 'Belum Ada' | 'Transfer' | 'Tunai' | 'Campuran';
        has_pending_verification: boolean;
        has_cash_at_collector: boolean;
        planned_payment_method: PlannedPaymentMethod;
        reconciliation_status: ReconciliationStatus;
        reconciler_label: string;
        reconciled_by: string | null;
        reconciled_at: string | null;
        reconciliation_note: string | null;
        accounting_status: AccountingStatus;
        is_legacy_archive: boolean;
        version: number;
      }>;
      v_app2_sales_recap: ViewDef<{
        sales_line_id: string;
        sales_document_id: string;
        company_id: string;
        branch_id: string;
        doc_number: string;
        source_invoice_no: string | null;
        doc_type: string;
        document_status: SalesDocumentStatus;
        delivery_date: string | null;
        iso_week: string | null;
        iso_month: string | null;
        invoice_date: string;
        due_date: string | null;
        customer_uuid: string;
        cust_id: string;
        cust_name: string;
        product_uuid: string;
        product_sku: string;
        product_name: string;
        line_no: number;
        unit_code: string;
        quantity: string;
        net_unit_price: string;
        line_total: string;
        raw_source_total: string | null;
        has_price_discrepancy: boolean;
        sales_staff_id: string | null;
        sales_name: string;
        metode_pembayaran: 'Belum Ada' | 'Transfer' | 'Tunai' | 'Campuran';
        status_pembayaran: PaymentStatus;
        planned_payment_method: PlannedPaymentMethod;
        keterangan: string;
        reconciliation_status: ReconciliationStatus;
        reconciler_label: string;
        reconciled_by_name: string | null;
        reconciled_at: string | null;
        reconciliation_note: string | null;
        document_total_amount: string;
        credit_note_amount: string;
        net_bill_amount: string;
        paid_amount: string;
        pending_allocation_amount: string;
        outstanding_amount: string;
        customer_deposit_balance: string;
        has_pending_verification: boolean;
        has_cash_at_collector: boolean;
        accounting_status: AccountingStatus;
        is_legacy_archive: boolean;
        legacy_source_data: Json;
        line_legacy_source_data: Json;
        tax_basis: TaxBasis;
        version: number;
        created_at: string;
      }>;
    };
    Functions: {
      draft_sale: { Args: Record<string, unknown>; Returns: Json };
      submit_sale: { Args: Record<string, unknown>; Returns: Json };
      approve_and_release_sale: { Args: Record<string, unknown>; Returns: Json };
      preview_sales_import: { Args: Record<string, unknown>; Returns: Json };
      commit_sales_import: { Args: Record<string, unknown>; Returns: Json };
      propose_payment_allocation: { Args: Record<string, unknown>; Returns: Json };
      approve_payment_allocation: { Args: Record<string, unknown>; Returns: Json };
      reverse_payment_allocation: { Args: Record<string, unknown>; Returns: Json };
      save_reconciliation_review: { Args: Record<string, unknown>; Returns: Json };
      issue_sales_credit_note: { Args: Record<string, unknown>; Returns: Json };
      get_sales_recap: { Args: Record<string, unknown>; Returns: Json };
      get_customer_receivable: { Args: Record<string, unknown>; Returns: Json };
      append_sales_note: { Args: Record<string, unknown>; Returns: Json };
      upsert_customer_master: { Args: Record<string, unknown>; Returns: Json };
      upsert_customer_alias: { Args: Record<string, unknown>; Returns: Json };
      upsert_product_master: { Args: Record<string, unknown>; Returns: Json };
    };
  };
}
