-- ==============================================================================
-- FINOPS_SHARED_V1 — Migration 0002: Security Helpers, RLS Policies & Storage
-- Aturan Keamanan:
-- 1. Tolak anonymous sepenuhnya.
-- 2. Helper SECURITY DEFINER berada di schema private dengan search_path kosong.
-- 3. Tidak ada direct-write client untuk tabel keuangan/audit/approval/membership.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. PRIVATE SECURITY HELPERS
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.current_user_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT auth.uid();
$$;

CREATE OR REPLACE FUNCTION private.is_company_member(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND m.company_id = p_company_id
      AND m.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION private.has_branch_access(p_company_id UUID, p_branch_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND m.company_id = p_company_id
      AND m.is_active = true
      AND (m.all_branches = true OR m.branch_id = p_branch_id)
  );
$$;

CREATE OR REPLACE FUNCTION private.has_company_role(p_company_id UUID, p_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND m.company_id = p_company_id
      AND m.is_active = true
      AND m.role_code = ANY(p_roles)
  );
$$;

CREATE OR REPLACE FUNCTION private.has_branch_role(p_company_id UUID, p_branch_id UUID, p_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND m.company_id = p_company_id
      AND m.is_active = true
      AND m.role_code = ANY(p_roles)
      AND (m.all_branches = true OR m.branch_id = p_branch_id)
  );
$$;

CREATE OR REPLACE FUNCTION private.get_own_staff_id(p_company_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s.id
  FROM public.staff s
  WHERE s.company_id = p_company_id
    AND s.profile_id = auth.uid()
    AND s.is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.assert_maker_checker(p_maker_id UUID, p_actor_id UUID, p_context TEXT)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_maker_id IS NOT NULL AND p_maker_id = p_actor_id THEN
    RAISE EXCEPTION 'Pelanggaran pemisahan tugas (maker-checker): pembuat dokumen tidak boleh menyetujui/memverifikasi % buatannya sendiri.', p_context
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.next_document_number(
  p_company_id UUID,
  p_doc_type TEXT,
  p_prefix TEXT,
  p_date DATE
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ym TEXT;
  v_seq INTEGER;
BEGIN
  v_ym := to_char(COALESCE(p_date, CURRENT_DATE), 'YYYYMM');
  INSERT INTO public.document_sequences (company_id, doc_type, prefix, period_ym, last_number)
  VALUES (p_company_id, p_doc_type, p_prefix, v_ym, 1)
  ON CONFLICT (company_id, doc_type, period_ym)
  DO UPDATE SET last_number = public.document_sequences.last_number + 1, updated_at = now()
  RETURNING last_number INTO v_seq;

  RETURN p_prefix || '-' || v_ym || '-' || lpad(v_seq::TEXT, 4, '0');
END;
$$;

CREATE OR REPLACE FUNCTION private.write_audit_event(
  p_company_id UUID,
  p_branch_id UUID,
  p_actor_id UUID,
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id UUID,
  p_before JSONB,
  p_after JSONB,
  p_reason TEXT,
  p_correlation_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.audit_events (
    company_id, branch_id, actor_id, event_action, entity_type, entity_id,
    before_state, after_state, reason, source_app, correlation_id
  ) VALUES (
    p_company_id, p_branch_id, p_actor_id, p_action, p_entity_type, p_entity_id,
    p_before, p_after, p_reason, 'app1_collections_deposits', COALESCE(p_correlation_id, gen_random_uuid())
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.emit_accounting_event(
  p_company_id UUID,
  p_branch_id UUID,
  p_event_type TEXT,
  p_source_type TEXT,
  p_source_id UUID,
  p_source_version INTEGER,
  p_effective_date DATE,
  p_payload JSONB,
  p_dependency_ids UUID[],
  p_actor_id UUID,
  p_correlation_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.accounting_events (
    company_id, branch_id, event_type, source_type, source_id, source_version,
    effective_date, payload_snapshot, mapping_version, dependency_ids,
    processing_status, correlation_id, created_by
  ) VALUES (
    p_company_id, p_branch_id, p_event_type, p_source_type, p_source_id, p_source_version,
    p_effective_date, p_payload, 'v1', COALESCE(p_dependency_ids, '{}'::uuid[]),
    'waiting_accounting_module', COALESCE(p_correlation_id, gen_random_uuid()), p_actor_id
  )
  ON CONFLICT (company_id, event_type, source_id, source_version) DO UPDATE
    SET updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Revoke public/anon execution on private helpers
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_company_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_branch_access(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_company_role(UUID, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_branch_role(UUID, UUID, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION private.get_own_staff_id(UUID) TO authenticated;

-- ------------------------------------------------------------------------------
-- 2. ENABLE ROW LEVEL SECURITY & REVOKE DIRECT WRITES
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
  all_tables TEXT[] := ARRAY[
    'companies','branches','profiles','memberships','role_permissions','app_settings',
    'customers','customer_aliases','products','product_units','staff','suppliers','fund_accounts',
    'document_sequences','sales_documents','sales_lines','sales_adjustments','document_links',
    'receipts','receipt_evidence','bank_statement_batches','bank_statement_lines','bank_matches',
    'payment_allocations','allocation_approvals','customer_refunds','refund_lines','cash_transfers',
    'cash_custody_accounts','cash_deposits','cash_deposit_lines','custody_movements','custody_movement_sources',
    'reconciliation_reviews','discrepancy_cases','approvals','attachments','audit_events',
    'accounting_events','event_dependencies','idempotency_keys','import_batches','import_rows',
    'chart_of_accounts','account_mappings','fiscal_periods','journal_entries','journal_lines','journal_source_links',
    'purchase_documents','purchase_lines','goods_receipts','goods_receipt_lines','supplier_payments',
    'supplier_allocations','inventory_movements','inventory_valuations','expense_documents',
    'fixed_assets','depreciation_runs','loans','equity_transactions','tax_codes',
    'opening_balances','opening_subledger_items','report_snapshots','period_close_checks','bank_reconciliations'
  ];
BEGIN
  FOREACH t IN ARRAY all_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon;', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON TABLE public.%I FROM authenticated;', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated;', t);
  END LOOP;
END $$;

-- Profiles: user can read own profile or same-company members
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.memberships m1
      JOIN public.memberships m2 ON m1.company_id = m2.company_id
      WHERE m1.user_id = auth.uid() AND m2.user_id = profiles.id AND m1.is_active AND m2.is_active
    )
  );

CREATE POLICY role_permissions_select ON public.role_permissions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY companies_select ON public.companies
  FOR SELECT TO authenticated USING (private.is_company_member(id));

CREATE POLICY branches_select ON public.branches
  FOR SELECT TO authenticated USING (private.has_branch_access(company_id, id));

CREATE POLICY memberships_select ON public.memberships
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR private.has_company_role(company_id, ARRAY['system_admin', 'owner_viewer'])
  );

CREATE POLICY app_settings_select ON public.app_settings
  FOR SELECT TO authenticated USING (private.is_company_member(company_id));

CREATE POLICY staff_select ON public.staff
  FOR SELECT TO authenticated USING (private.has_branch_access(company_id, branch_id));

CREATE POLICY customers_select ON public.customers
  FOR SELECT TO authenticated USING (private.has_branch_access(company_id, branch_id));

CREATE POLICY customer_aliases_select ON public.customer_aliases
  FOR SELECT TO authenticated USING (private.is_company_member(company_id));

CREATE POLICY fund_accounts_select ON public.fund_accounts
  FOR SELECT TO authenticated
  USING (
    private.is_company_member(company_id)
    AND (branch_id IS NULL OR private.has_branch_access(company_id, branch_id))
  );

-- Receipts: collector_optional hanya boleh melihat miliknya sendiri
CREATE POLICY receipts_select ON public.receipts
  FOR SELECT TO authenticated
  USING (
    private.has_branch_access(company_id, branch_id)
    AND (
      private.has_company_role(company_id, ARRAY[
        'finance_maker','finance_checker','sales_admin','reconciliation_reviewer',
        'accountant','accounting_approver','owner_viewer','system_admin'
      ])
      OR (
        private.has_company_role(company_id, ARRAY['collector_optional'])
        AND (
          created_by = auth.uid()
          OR actual_collector_id = private.get_own_staff_id(company_id)
        )
      )
    )
  );

CREATE POLICY receipt_evidence_select ON public.receipt_evidence
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.receipts r
      WHERE r.id = receipt_evidence.receipt_id
    )
  );

-- Bank Statements & Matches: terbatas untuk finance, reconciliation, accounting, owner_viewer
CREATE POLICY bank_batches_select ON public.bank_statement_batches
  FOR SELECT TO authenticated
  USING (
    private.has_company_role(company_id, ARRAY[
      'finance_maker','finance_checker','reconciliation_reviewer','accountant','accounting_approver','owner_viewer','system_admin'
    ])
  );

CREATE POLICY bank_lines_select ON public.bank_statement_lines
  FOR SELECT TO authenticated
  USING (
    private.has_company_role(company_id, ARRAY[
      'finance_maker','finance_checker','reconciliation_reviewer','accountant','accounting_approver','owner_viewer','system_admin'
    ])
  );

CREATE POLICY bank_matches_select ON public.bank_matches
  FOR SELECT TO authenticated
  USING (
    private.has_company_role(company_id, ARRAY[
      'finance_maker','finance_checker','reconciliation_reviewer','accountant','accounting_approver','owner_viewer','system_admin'
    ])
  );

-- Custody & Deposits: collector hanya melihat custody miliknya
CREATE POLICY custody_accounts_select ON public.cash_custody_accounts
  FOR SELECT TO authenticated
  USING (
    private.has_branch_access(company_id, branch_id)
    AND (
      private.has_company_role(company_id, ARRAY[
        'finance_maker','finance_checker','reconciliation_reviewer','accountant','accounting_approver','owner_viewer','system_admin'
      ])
      OR (
        private.has_company_role(company_id, ARRAY['collector_optional'])
        AND collector_staff_id = private.get_own_staff_id(company_id)
      )
    )
  );

CREATE POLICY cash_deposits_select ON public.cash_deposits
  FOR SELECT TO authenticated
  USING (
    private.has_branch_access(company_id, branch_id)
    AND (
      private.has_company_role(company_id, ARRAY[
        'finance_maker','finance_checker','reconciliation_reviewer','accountant','accounting_approver','owner_viewer','system_admin'
      ])
      OR (
        private.has_company_role(company_id, ARRAY['collector_optional'])
        AND collector_staff_id = private.get_own_staff_id(company_id)
      )
    )
  );

CREATE POLICY cash_deposit_lines_select ON public.cash_deposit_lines
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cash_deposits d WHERE d.id = cash_deposit_lines.cash_deposit_id));

CREATE POLICY custody_movements_select ON public.custody_movements
  FOR SELECT TO authenticated
  USING (
    private.has_branch_access(company_id, branch_id)
    AND (
      private.has_company_role(company_id, ARRAY[
        'finance_maker','finance_checker','reconciliation_reviewer','accountant','accounting_approver','owner_viewer','system_admin'
      ])
      OR (
        private.has_company_role(company_id, ARRAY['collector_optional'])
        AND collector_staff_id = private.get_own_staff_id(company_id)
      )
    )
  );

CREATE POLICY custody_sources_select ON public.custody_movement_sources
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cash_custody_accounts c WHERE c.id = custody_movement_sources.custody_account_id));

CREATE POLICY cash_transfers_select ON public.cash_transfers
  FOR SELECT TO authenticated
  USING (private.has_branch_access(company_id, branch_id));

CREATE POLICY discrepancy_cases_select ON public.discrepancy_cases
  FOR SELECT TO authenticated
  USING (private.has_branch_access(company_id, branch_id));

CREATE POLICY approvals_select ON public.approvals
  FOR SELECT TO authenticated
  USING (private.is_company_member(company_id));

CREATE POLICY audit_events_select ON public.audit_events
  FOR SELECT TO authenticated
  USING (
    private.has_company_role(company_id, ARRAY[
      'finance_maker','finance_checker','reconciliation_reviewer','accountant','accounting_approver','owner_viewer','system_admin'
    ])
  );

CREATE POLICY accounting_events_select ON public.accounting_events
  FOR SELECT TO authenticated
  USING (private.has_branch_access(company_id, branch_id));

CREATE POLICY sales_documents_select ON public.sales_documents
  FOR SELECT TO authenticated
  USING (private.has_branch_access(company_id, branch_id));

CREATE POLICY payment_allocations_select ON public.payment_allocations
  FOR SELECT TO authenticated
  USING (private.has_branch_access(company_id, branch_id));

-- ------------------------------------------------------------------------------
-- 3. PRIVATE STORAGE BUCKET (finops-evidence)
-- ------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'finops-evidence',
  'finops-evidence',
  false,
  10485760, -- 10 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Path format: {company_id}/{doc_type}/{doc_id}/{filename}
CREATE POLICY finops_evidence_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'finops-evidence'
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    AND private.is_company_member(((storage.foldername(name))[1])::UUID)
  );

CREATE POLICY finops_evidence_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'finops-evidence'
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    AND private.has_company_role(
      ((storage.foldername(name))[1])::UUID,
      ARRAY['finance_maker','finance_checker','collector_optional','accountant']
    )
  );

INSERT INTO public.schema_migrations (version, description)
VALUES ('0002_finops_shared_v1_rls_security', 'Private SECURITY DEFINER helpers, forced RLS policies, no direct financial writes, and private evidence storage bucket')
ON CONFLICT (version) DO NOTHING;
