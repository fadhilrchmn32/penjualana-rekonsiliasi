-- ==============================================================================
-- FINOPS_SHARED_V1 — Migration 0001: Canonical Schema Foundation (All Domains)
-- Versi Kontrak: 1.0.0 | Tanggal Kontrak: 2026-11-16
-- Catatan: Additive-only migration. Jangan gunakan DROP/TRUNCATE.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS private;

-- ------------------------------------------------------------------------------
-- 0. METADATA & MIGRATION REGISTRY
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version TEXT PRIMARY KEY,
  contract_name TEXT NOT NULL DEFAULT 'FINOPS_SHARED_V1',
  description TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_metadata (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.app_metadata (key, value)
VALUES (
  'FINOPS_SHARED_V1',
  jsonb_build_object(
    'contract_name', 'FINOPS_SHARED_V1',
    'contract_version', '1.0.0',
    'contract_date', '2026-11-16',
    'default_currency', 'IDR',
    'default_timezone', 'Asia/Jakarta',
    'owner_app', 'app1_collections_deposits'
  )
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- ------------------------------------------------------------------------------
-- 1. AKSES & MASTER DATA
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  legal_name TEXT,
  tax_id TEXT,
  base_currency TEXT NOT NULL DEFAULT 'IDR',
  timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  is_active BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  is_headquarters BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, code),
  UNIQUE (company_id, id)
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY, -- matches auth.users(id)
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_code TEXT NOT NULL,
  permission_code TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (role_code, permission_code)
);

CREATE TABLE IF NOT EXISTS public.memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT,
  all_branches BOOLEAN NOT NULL DEFAULT false,
  role_code TEXT NOT NULL CHECK (
    role_code IN (
      'finance_maker',
      'finance_checker',
      'sales_admin',
      'reconciliation_reviewer',
      'accountant',
      'accounting_approver',
      'owner_viewer',
      'system_admin',
      'collector_optional'
    )
  ),
  is_active BOOLEAN NOT NULL DEFAULT true,
  granted_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_id, branch_id, role_code)
);

CREATE TABLE IF NOT EXISTS public.app_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE RESTRICT,
  app1_url TEXT,
  app2_url TEXT,
  app3_url TEXT,
  reconciliation_label TEXT NOT NULL DEFAULT 'REKONSILIASI (ALMIRA)',
  rounding_mode TEXT NOT NULL DEFAULT 'half_up',
  rounding_scale INTEGER NOT NULL DEFAULT 0,
  auto_post_enabled BOOLEAN NOT NULL DEFAULT false,
  require_evidence_for_transfer BOOLEAN NOT NULL DEFAULT true,
  require_evidence_for_cash BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID REFERENCES public.profiles(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  staff_code TEXT NOT NULL,
  full_name TEXT NOT NULL,
  staff_role TEXT NOT NULL CHECK (staff_role IN ('sales', 'driver', 'collector', 'finance', 'admin')),
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id),
  updated_by UUID REFERENCES public.profiles(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, staff_code),
  UNIQUE (company_id, id)
);

CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  cust_id TEXT NOT NULL, -- TEXT agar nol awal (leading zero) utuh
  name TEXT NOT NULL,
  default_sales_id UUID REFERENCES public.staff(id),
  phone TEXT,
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id),
  updated_by UUID REFERENCES public.profiles(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, cust_id),
  UNIQUE (company_id, id)
);

CREATE TABLE IF NOT EXISTS public.customer_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  alias_name TEXT NOT NULL,
  source_bank_account_hint TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, alias_name)
);

CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  base_unit TEXT NOT NULL DEFAULT 'PCS',
  is_stocked BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, sku)
);

CREATE TABLE IF NOT EXISTS public.product_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  unit_code TEXT NOT NULL,
  conversion_factor NUMERIC(20,6) NOT NULL DEFAULT 1,
  UNIQUE (product_id, unit_code)
);

CREATE TABLE IF NOT EXISTS public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  supplier_code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, supplier_code)
);

CREATE TABLE IF NOT EXISTS public.fund_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('bank', 'office_cash', 'petty_cash')),
  bank_name TEXT,
  account_number TEXT,
  account_holder TEXT,
  currency TEXT NOT NULL DEFAULT 'IDR',
  coa_account_code TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id),
  updated_by UUID REFERENCES public.profiles(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, code),
  UNIQUE (company_id, id)
);

CREATE TABLE IF NOT EXISTS public.document_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  prefix TEXT NOT NULL,
  period_ym TEXT NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, doc_type, period_ym)
);

-- ------------------------------------------------------------------------------
-- 2. PENJUALAN (Fondasi App 2 — Disiapkan Sesuai FINOPS_SHARED_V1)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  doc_number TEXT NOT NULL,
  source_invoice_no TEXT,
  doc_type TEXT NOT NULL DEFAULT 'sales_invoice' CHECK (doc_type IN ('sales_invoice', 'credit_note', 'debit_note')),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  sales_staff_id UUID REFERENCES public.staff(id) ON DELETE RESTRICT,
  invoice_date DATE NOT NULL,
  delivery_date DATE,
  due_date DATE,
  currency TEXT NOT NULL DEFAULT 'IDR',
  subtotal_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
  rounding_diff NUMERIC(20,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'released', 'corrected', 'voided')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partially_paid', 'paid', 'overpaid')),
  accounting_status TEXT NOT NULL DEFAULT 'not_ready' CHECK (accounting_status IN ('not_ready', 'queued', 'draft_journal', 'posted', 'failed', 'reversed')),
  created_by UUID REFERENCES public.profiles(id),
  updated_by UUID REFERENCES public.profiles(id),
  approved_by UUID REFERENCES public.profiles(id),
  reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  source_app TEXT NOT NULL DEFAULT 'app2_sales_reconciliation',
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, doc_number),
  UNIQUE (company_id, id)
);

CREATE TABLE IF NOT EXISTS public.sales_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  sales_document_id UUID NOT NULL REFERENCES public.sales_documents(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  unit_code TEXT NOT NULL,
  quantity NUMERIC(20,6) NOT NULL CHECK (quantity > 0),
  net_unit_price NUMERIC(20,6) NOT NULL CHECK (net_unit_price >= 0),
  line_total_raw NUMERIC(20,6) NOT NULL,
  line_total NUMERIC(20,2) NOT NULL,
  rounding_diff NUMERIC(20,6) NOT NULL DEFAULT 0,
  UNIQUE (sales_document_id, line_no)
);

CREATE TABLE IF NOT EXISTS public.sales_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  sales_document_id UUID NOT NULL REFERENCES public.sales_documents(id) ON DELETE RESTRICT,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('return_credit', 'price_adjustment', 'discount_post', 'other')),
  amount NUMERIC(20,2) NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected')),
  created_by UUID REFERENCES public.profiles(id),
  approved_by UUID REFERENCES public.profiles(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.document_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL,
  source_id UUID NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  link_type TEXT NOT NULL,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 3. PENERIMAAN & MUTASI BANK (Fokus Utama App 1)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  receipt_number TEXT NOT NULL,
  receipt_channel TEXT NOT NULL CHECK (receipt_channel IN ('bank_transfer', 'cash')),
  currency TEXT NOT NULL DEFAULT 'IDR',
  -- Nominal terpisah untuk transparansi biaya bank
  customer_gross_amount NUMERIC(20,2) NOT NULL CHECK (customer_gross_amount > 0),
  bank_net_amount NUMERIC(20,2) NOT NULL CHECK (bank_net_amount >= 0),
  bank_fee_amount NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (bank_fee_amount >= 0),
  bank_fee_bearer TEXT NOT NULL DEFAULT 'none' CHECK (bank_fee_bearer IN ('none', 'company', 'customer', 'pending_review')),
  verified_amount NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (verified_amount >= 0),
  -- Tanggal terpisah sesuai kontrak
  customer_paid_at DATE NOT NULL,
  bank_value_date DATE,
  verified_at TIMESTAMPTZ,
  accounting_date DATE,
  -- Identitas pelanggan (explicit unknown flag, bukan dummy master)
  is_unknown_identity BOOLEAN NOT NULL DEFAULT false,
  customer_id UUID REFERENCES public.customers(id) ON DELETE RESTRICT,
  sender_name_raw TEXT,
  -- Informasi kanal
  fund_account_id UUID REFERENCES public.fund_accounts(id) ON DELETE RESTRICT,
  bank_reference TEXT,
  optional_invoice_ref TEXT,
  receipt_book_no TEXT,
  -- Petugas untuk tunai: pembuat laporan != penagih riil != sales pemilik pelanggan
  actual_collector_id UUID REFERENCES public.staff(id) ON DELETE RESTRICT,
  sales_owner_id UUID REFERENCES public.staff(id) ON DELETE RESTRICT,
  location_note TEXT,
  notes TEXT,
  -- Verifikasi & duplikasi
  verification_method TEXT CHECK (verification_method IN ('bank_statement_match', 'manual_bank_check', 'cash_evidence_check')),
  verification_ref TEXT,
  verification_note TEXT,
  evidence_hash TEXT,
  duplicate_flag BOOLEAN NOT NULL DEFAULT false,
  duplicate_reason TEXT,
  -- 4 dimensi status terpisah
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'submitted', 'waiting_verification', 'verified', 'rejected', 'reversal_requested', 'reversed')
  ),
  deposit_status TEXT NOT NULL DEFAULT 'not_applicable' CHECK (
    deposit_status IN ('not_applicable', 'not_deposited', 'partially_deposited', 'deposited', 'discrepancy')
  ),
  reconciliation_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (
    reconciliation_status IN ('unreviewed', 'matched', 'needs_review', 'discrepancy', 'reviewed')
  ),
  accounting_status TEXT NOT NULL DEFAULT 'not_ready' CHECK (
    accounting_status IN ('not_ready', 'queued', 'draft_journal', 'posted', 'failed', 'reversed')
  ),
  -- Audit & Concurrency
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  updated_by UUID REFERENCES public.profiles(id),
  submitted_by UUID REFERENCES public.profiles(id),
  submitted_at TIMESTAMPTZ,
  verified_by UUID REFERENCES public.profiles(id),
  approved_by UUID REFERENCES public.profiles(id),
  rejected_by UUID REFERENCES public.profiles(id),
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  source_app TEXT NOT NULL DEFAULT 'app1_collections_deposits',
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, receipt_number),
  UNIQUE (company_id, id),
  CHECK (
    (is_unknown_identity = true AND customer_id IS NULL)
    OR (is_unknown_identity = false)
  )
);

CREATE INDEX IF NOT EXISTS idx_receipts_company_status ON public.receipts(company_id, status, customer_paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_collector ON public.receipts(company_id, actual_collector_id, status);
CREATE INDEX IF NOT EXISTS idx_receipts_dup_fingerprint ON public.receipts(company_id, fund_account_id, customer_gross_amount, customer_paid_at);

CREATE TABLE IF NOT EXISTS public.receipt_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  receipt_id UUID NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,
  storage_bucket TEXT NOT NULL DEFAULT 'finops-evidence',
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
  sha256_hash TEXT NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bank_statement_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT,
  fund_account_id UUID NOT NULL REFERENCES public.fund_accounts(id) ON DELETE RESTRICT,
  batch_number TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  date_format TEXT NOT NULL,
  decimal_format TEXT NOT NULL,
  opening_balance NUMERIC(20,2),
  closing_balance NUMERIC(20,2),
  total_rows INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'preview' CHECK (status IN ('preview', 'committed', 'cancelled')),
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  committed_by UUID REFERENCES public.profiles(id),
  committed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, batch_number)
);

CREATE TABLE IF NOT EXISTS public.bank_statement_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  batch_id UUID NOT NULL REFERENCES public.bank_statement_batches(id) ON DELETE CASCADE,
  fund_account_id UUID NOT NULL REFERENCES public.fund_accounts(id) ON DELETE RESTRICT,
  row_number INTEGER NOT NULL,
  raw_row JSONB NOT NULL,
  external_txn_id TEXT,
  fingerprint_hash TEXT NOT NULL,
  posting_date DATE NOT NULL,
  value_date DATE NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),
  amount NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  signed_amount NUMERIC(20,2) NOT NULL,
  running_balance NUMERIC(20,2),
  bank_reference TEXT,
  description TEXT NOT NULL,
  suggested_classification TEXT CHECK (
    suggested_classification IN ('customer_receipt', 'collector_direct_deposit', 'internal_cash_transfer', 'loan_or_equity', 'supplier_or_expense', 'bank_fee', 'refund', 'unclassified')
  ),
  is_duplicate_suspect BOOLEAN NOT NULL DEFAULT false,
  duplicate_note TEXT,
  match_status TEXT NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched', 'proposed', 'matched', 'reviewed_exception')),
  matched_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, fund_account_id, external_txn_id)
);

CREATE INDEX IF NOT EXISTS idx_bank_lines_match ON public.bank_statement_lines(company_id, fund_account_id, match_status, value_date DESC);

CREATE TABLE IF NOT EXISTS public.bank_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  match_group_id UUID NOT NULL,
  bank_statement_line_id UUID NOT NULL REFERENCES public.bank_statement_lines(id) ON DELETE RESTRICT,
  target_type TEXT NOT NULL CHECK (target_type IN ('receipt', 'cash_deposit', 'cash_transfer', 'customer_refund', 'supplier_payment', 'expense_document', 'loan', 'equity_transaction')),
  target_id UUID NOT NULL,
  matched_amount NUMERIC(20,2) NOT NULL CHECK (matched_amount > 0),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected', 'reversed')),
  notes TEXT,
  proposed_by UUID NOT NULL REFERENCES public.profiles(id),
  approved_by UUID REFERENCES public.profiles(id),
  approved_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mencegah satu baris mutasi bank dipakai ulang secara aktif saat sudah matched
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_matches_active_line_target
  ON public.bank_matches(bank_statement_line_id, target_type, target_id)
  WHERE status IN ('proposed', 'approved');

-- ------------------------------------------------------------------------------
-- 4. ALOKASI PEMBAYARAN (Fondasi App 2 — Dibaca App 1 untuk proteksi reversal)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  receipt_id UUID NOT NULL REFERENCES public.receipts(id) ON DELETE RESTRICT,
  sales_document_id UUID NOT NULL REFERENCES public.sales_documents(id) ON DELETE RESTRICT,
  allocated_amount NUMERIC(20,2) NOT NULL CHECK (allocated_amount > 0),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected', 'reversed')),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  approved_by UUID REFERENCES public.profiles(id),
  approved_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  source_app TEXT NOT NULL DEFAULT 'app2_sales_reconciliation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.allocation_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  payment_allocation_id UUID NOT NULL REFERENCES public.payment_allocations(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'reversed')),
  actor_id UUID NOT NULL REFERENCES public.profiles(id),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 5. REFUND & TRANSFER KAS INTERNAL
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  refund_number TEXT NOT NULL,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  fund_account_id UUID REFERENCES public.fund_accounts(id),
  refund_date DATE NOT NULL,
  total_amount NUMERIC(20,2) NOT NULL CHECK (total_amount > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'paid', 'rejected', 'reversed')),
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  approved_by UUID REFERENCES public.profiles(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, refund_number)
);

CREATE TABLE IF NOT EXISTS public.refund_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  customer_refund_id UUID NOT NULL REFERENCES public.customer_refunds(id) ON DELETE CASCADE,
  receipt_id UUID REFERENCES public.receipts(id) ON DELETE RESTRICT,
  amount NUMERIC(20,2) NOT NULL CHECK (amount > 0)
);

CREATE TABLE IF NOT EXISTS public.cash_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  transfer_number TEXT NOT NULL,
  transfer_date DATE NOT NULL,
  from_fund_account_id UUID NOT NULL REFERENCES public.fund_accounts(id) ON DELETE RESTRICT,
  to_fund_account_id UUID NOT NULL REFERENCES public.fund_accounts(id) ON DELETE RESTRICT,
  amount NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  bank_statement_line_id UUID REFERENCES public.bank_statement_lines(id) ON DELETE RESTRICT,
  reference_no TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'reversed')),
  accounting_status TEXT NOT NULL DEFAULT 'not_ready' CHECK (accounting_status IN ('not_ready', 'queued', 'draft_journal', 'posted', 'failed', 'reversed')),
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  approved_by UUID REFERENCES public.profiles(id),
  approved_at TIMESTAMPTZ,
  reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, transfer_number),
  CHECK (from_fund_account_id <> to_fund_account_id)
);

-- ------------------------------------------------------------------------------
-- 6. PENGUASAAN UANG DI PENAGIH & SETORAN
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cash_custody_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  collector_staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  currency TEXT NOT NULL DEFAULT 'IDR',
  verified_balance NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (verified_balance >= 0),
  unverified_reported_balance NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (unverified_reported_balance >= 0),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, collector_staff_id, currency)
);

CREATE TABLE IF NOT EXISTS public.cash_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  deposit_number TEXT NOT NULL,
  collector_staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  custody_account_id UUID NOT NULL REFERENCES public.cash_custody_accounts(id) ON DELETE RESTRICT,
  target_type TEXT NOT NULL CHECK (target_type IN ('office_cash', 'bank_direct')),
  target_fund_account_id UUID NOT NULL REFERENCES public.fund_accounts(id) ON DELETE RESTRICT,
  bank_statement_line_id UUID REFERENCES public.bank_statement_lines(id) ON DELETE RESTRICT,
  deposit_date DATE NOT NULL,
  declared_amount NUMERIC(20,2) NOT NULL CHECK (declared_amount > 0),
  received_amount NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (received_amount >= 0),
  shortage_amount NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (shortage_amount >= 0),
  excess_amount NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (excess_amount >= 0),
  is_planned_partial BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'submitted', 'partially_accepted', 'accepted', 'accepted_with_discrepancy', 'rejected', 'reversed')
  ),
  accounting_status TEXT NOT NULL DEFAULT 'not_ready' CHECK (
    accounting_status IN ('not_ready', 'queued', 'draft_journal', 'posted', 'failed', 'reversed')
  ),
  evidence_path TEXT,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  submitted_by UUID REFERENCES public.profiles(id),
  submitted_at TIMESTAMPTZ,
  received_by UUID REFERENCES public.profiles(id),
  approved_by UUID REFERENCES public.profiles(id),
  approved_at TIMESTAMPTZ,
  reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  source_app TEXT NOT NULL DEFAULT 'app1_collections_deposits',
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, deposit_number)
);

CREATE TABLE IF NOT EXISTS public.cash_deposit_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  cash_deposit_id UUID NOT NULL REFERENCES public.cash_deposits(id) ON DELETE CASCADE,
  source_receipt_id UUID NOT NULL REFERENCES public.receipts(id) ON DELETE RESTRICT,
  declared_amount NUMERIC(20,2) NOT NULL CHECK (declared_amount > 0),
  accepted_amount NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (accepted_amount >= 0),
  UNIQUE (cash_deposit_id, source_receipt_id)
);

CREATE TABLE IF NOT EXISTS public.custody_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  custody_account_id UUID NOT NULL REFERENCES public.cash_custody_accounts(id) ON DELETE RESTRICT,
  collector_staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL CHECK (
    movement_type IN ('cash_receipt_verified', 'deposit_to_office_cash', 'deposit_direct_to_bank', 'shortage_adjustment', 'reversal')
  ),
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  amount NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  balance_after NUMERIC(20,2) NOT NULL CHECK (balance_after >= 0),
  source_type TEXT NOT NULL,
  source_id UUID NOT NULL,
  effective_date DATE NOT NULL,
  actor_id UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.custody_movement_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  custody_account_id UUID NOT NULL REFERENCES public.cash_custody_accounts(id) ON DELETE RESTRICT,
  receipt_id UUID NOT NULL UNIQUE REFERENCES public.receipts(id) ON DELETE RESTRICT,
  verified_amount NUMERIC(20,2) NOT NULL CHECK (verified_amount > 0),
  deposited_amount NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (deposited_amount >= 0),
  remaining_amount NUMERIC(20,2) NOT NULL CHECK (remaining_amount >= 0),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 7. REVIEW, SELISIH, APPROVAL, LAMPIRAN & AUDIT APPEND-ONLY
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reconciliation_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES public.branches(id),
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'resolved', 'rejected')),
  assigned_role TEXT NOT NULL DEFAULT 'reconciliation_reviewer',
  reviewer_label TEXT NOT NULL DEFAULT 'REKONSILIASI (ALMIRA)',
  notes TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  resolved_by UUID REFERENCES public.profiles(id),
  resolved_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.discrepancy_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  case_number TEXT NOT NULL,
  case_type TEXT NOT NULL CHECK (
    case_type IN ('deposit_shortage', 'deposit_excess_unidentified', 'unknown_sender', 'unmatched_bank_line', 'bank_fee_review', 'duplicate_review', 'missing_evidence')
  ),
  source_type TEXT NOT NULL,
  source_id UUID NOT NULL,
  expected_amount NUMERIC(20,2),
  actual_amount NUMERIC(20,2),
  discrepancy_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'pending_approval', 'resolved', 'closed')),
  proposed_resolution TEXT,
  resolution_note TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  proposed_by UUID REFERENCES public.profiles(id),
  resolved_by UUID REFERENCES public.profiles(id),
  resolved_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, case_number)
);

CREATE TABLE IF NOT EXISTS public.approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES public.branches(id),
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  action TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'requested')),
  actor_id UUID NOT NULL REFERENCES public.profiles(id),
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  storage_bucket TEXT NOT NULL DEFAULT 'finops-evidence',
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  sha256_hash TEXT NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES public.branches(id),
  actor_id UUID REFERENCES public.profiles(id),
  event_action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  before_state JSONB,
  after_state JSONB,
  reason TEXT,
  source_app TEXT NOT NULL DEFAULT 'app1_collections_deposits',
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 8. INTEGRASI, OUTBOX AKUNTANSI, IDEMPOTENCY & STAGING IMPOR
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.accounting_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id UUID NOT NULL,
  source_version INTEGER NOT NULL,
  effective_date DATE NOT NULL,
  payload_snapshot JSONB NOT NULL,
  mapping_version TEXT NOT NULL DEFAULT 'v1',
  dependency_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  processing_status TEXT NOT NULL DEFAULT 'waiting_accounting_module' CHECK (
    processing_status IN ('waiting_accounting_module', 'queued', 'draft_journal', 'posted', 'failed', 'reversed')
  ),
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, event_type, source_id, source_version)
);

CREATE TABLE IF NOT EXISTS public.event_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  accounting_event_id UUID NOT NULL REFERENCES public.accounting_events(id) ON DELETE CASCADE,
  depends_on_type TEXT NOT NULL,
  depends_on_id UUID NOT NULL
);

CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL,
  rpc_name TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT,
  response_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (actor_id, rpc_name, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  import_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'staging' CHECK (status IN ('staging', 'committed', 'failed')),
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  batch_id UUID NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  row_no INTEGER NOT NULL,
  raw_data JSONB NOT NULL,
  validation_status TEXT NOT NULL DEFAULT 'valid' CHECK (validation_status IN ('valid', 'warning', 'error')),
  validation_message TEXT
);

-- ------------------------------------------------------------------------------
-- 9. AKUNTANSI (Fondasi App 3 — Disiapkan Sesuai FINOPS_SHARED_V1)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  account_group TEXT NOT NULL CHECK (account_group IN ('asset', 'liability', 'equity', 'revenue', 'cogs', 'expense')),
  normal_balance TEXT NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS public.account_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  mapping_version TEXT NOT NULL DEFAULT 'v1',
  event_type TEXT NOT NULL,
  role_key TEXT NOT NULL,
  coa_code TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (company_id, mapping_version, event_type, role_key)
);

CREATE TABLE IF NOT EXISTS public.fiscal_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  period_code TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'soft_closed', 'closed')),
  closed_by UUID REFERENCES public.profiles(id),
  closed_at TIMESTAMPTZ,
  UNIQUE (company_id, period_code)
);

CREATE TABLE IF NOT EXISTS public.journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  journal_number TEXT NOT NULL,
  accounting_date DATE NOT NULL,
  effective_date DATE NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'reversed')),
  total_debit NUMERIC(20,2) NOT NULL DEFAULT 0,
  total_credit NUMERIC(20,2) NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.profiles(id),
  approved_by UUID REFERENCES public.profiles(id),
  posted_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, journal_number),
  CHECK (total_debit = total_credit)
);

CREATE TABLE IF NOT EXISTS public.journal_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  journal_entry_id UUID NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  coa_code TEXT NOT NULL,
  debit NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  memo TEXT,
  UNIQUE (journal_entry_id, line_no)
);

CREATE TABLE IF NOT EXISTS public.journal_source_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  journal_entry_id UUID NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  accounting_event_id UUID NOT NULL REFERENCES public.accounting_events(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL,
  source_id UUID NOT NULL,
  UNIQUE (accounting_event_id, journal_entry_id)
);

-- ------------------------------------------------------------------------------
-- 10. PEMBELIAN, STOK, DOMAIN PENDUKUNG & KONTROL LAPORAN (Fondasi App 3)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  doc_number TEXT NOT NULL,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  invoice_date DATE NOT NULL,
  total_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, doc_number)
);

CREATE TABLE IF NOT EXISTS public.purchase_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  purchase_document_id UUID NOT NULL REFERENCES public.purchase_documents(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity NUMERIC(20,6) NOT NULL,
  unit_cost NUMERIC(20,6) NOT NULL,
  line_total NUMERIC(20,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.goods_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  grn_number TEXT NOT NULL,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  received_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, grn_number)
);

CREATE TABLE IF NOT EXISTS public.goods_receipt_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  goods_receipt_id UUID NOT NULL REFERENCES public.goods_receipts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity NUMERIC(20,6) NOT NULL,
  estimated_unit_cost NUMERIC(20,6) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  payment_number TEXT NOT NULL,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  fund_account_id UUID NOT NULL REFERENCES public.fund_accounts(id) ON DELETE RESTRICT,
  payment_date DATE NOT NULL,
  amount NUMERIC(20,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, payment_number)
);

CREATE TABLE IF NOT EXISTS public.supplier_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  supplier_payment_id UUID NOT NULL REFERENCES public.supplier_payments(id) ON DELETE RESTRICT,
  purchase_document_id UUID NOT NULL REFERENCES public.purchase_documents(id) ON DELETE RESTRICT,
  allocated_amount NUMERIC(20,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  movement_date DATE NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  quantity NUMERIC(20,6) NOT NULL,
  unit_cost NUMERIC(20,6) NOT NULL,
  source_type TEXT NOT NULL,
  source_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inventory_valuations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  qty_on_hand NUMERIC(20,6) NOT NULL DEFAULT 0,
  avg_unit_cost NUMERIC(20,6) NOT NULL DEFAULT 0,
  total_value NUMERIC(20,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, branch_id, product_id)
);

CREATE TABLE IF NOT EXISTS public.expense_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  doc_number TEXT NOT NULL,
  expense_date DATE NOT NULL,
  category_coa TEXT NOT NULL,
  amount NUMERIC(20,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, doc_number)
);

CREATE TABLE IF NOT EXISTS public.fixed_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  asset_code TEXT NOT NULL,
  name TEXT NOT NULL,
  acquisition_date DATE NOT NULL,
  cost NUMERIC(20,2) NOT NULL,
  useful_life_months INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  UNIQUE (company_id, asset_code)
);

CREATE TABLE IF NOT EXISTS public.depreciation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  period_code TEXT NOT NULL,
  total_depreciation NUMERIC(20,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  loan_number TEXT NOT NULL,
  lender_name TEXT NOT NULL,
  principal_amount NUMERIC(20,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  UNIQUE (company_id, loan_number)
);

CREATE TABLE IF NOT EXISTS public.equity_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  doc_number TEXT NOT NULL,
  txn_type TEXT NOT NULL CHECK (txn_type IN ('capital_injection', 'owner_draw', 'dividend')),
  txn_date DATE NOT NULL,
  amount NUMERIC(20,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  UNIQUE (company_id, doc_number)
);

CREATE TABLE IF NOT EXISTS public.tax_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  rate NUMERIC(10,6) NOT NULL DEFAULT 0,
  coa_code TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS public.opening_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  as_of_date DATE NOT NULL,
  coa_code TEXT NOT NULL,
  debit NUMERIC(20,2) NOT NULL DEFAULT 0,
  credit NUMERIC(20,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft'
);

CREATE TABLE IF NOT EXISTS public.opening_subledger_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  subledger_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  amount NUMERIC(20,2) NOT NULL,
  as_of_date DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS public.report_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  report_code TEXT NOT NULL,
  period_code TEXT NOT NULL,
  payload JSONB NOT NULL,
  generated_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.period_close_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  fiscal_period_id UUID NOT NULL REFERENCES public.fiscal_periods(id) ON DELETE CASCADE,
  check_code TEXT NOT NULL,
  status TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bank_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  fund_account_id UUID NOT NULL REFERENCES public.fund_accounts(id) ON DELETE RESTRICT,
  period_end DATE NOT NULL,
  statement_closing_balance NUMERIC(20,2) NOT NULL,
  book_closing_balance NUMERIC(20,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  approved_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default role permissions matrix
INSERT INTO public.role_permissions (role_code, permission_code, description) VALUES
  ('finance_maker', 'receipt.create_draft', 'Membuat draft penerimaan transfer & tunai'),
  ('finance_maker', 'receipt.submit', 'Mengajukan verifikasi penerimaan'),
  ('finance_maker', 'receipt.propose_identity', 'Mengusulkan identitas pengirim dana belum teridentifikasi'),
  ('finance_maker', 'receipt.request_reversal', 'Mengajukan pembatalan penerimaan'),
  ('finance_maker', 'deposit.create', 'Membuat draft setoran penagih'),
  ('finance_maker', 'deposit.submit', 'Mengajukan setoran ke checker'),
  ('finance_maker', 'bank.import', 'Impor mutasi bank CSV/XLSX'),
  ('finance_maker', 'bank.propose_match', 'Mengusulkan pencocokan mutasi bank'),
  ('finance_maker', 'transfer.create', 'Membuat transfer kas internal'),
  ('finance_checker', 'receipt.verify', 'Memverifikasi penerimaan transfer & tunai'),
  ('finance_checker', 'receipt.reject', 'Menolak penerimaan dengan alasan'),
  ('finance_checker', 'receipt.approve_identity', 'Mengesahkan identitas penerimaan belum teridentifikasi'),
  ('finance_checker', 'receipt.approve_reversal', 'Menyetujui pembatalan penerimaan setelah cek dependensi'),
  ('finance_checker', 'deposit.accept', 'Menerima dan menghitung setoran penagih'),
  ('finance_checker', 'bank.approve_match', 'Menyetujui pencocokan mutasi bank'),
  ('finance_checker', 'transfer.approve', 'Menyetujui transfer kas internal'),
  ('finance_checker', 'discrepancy.resolve', 'Menyelesaikan kasus selisih operasional'),
  ('collector_optional', 'receipt.create_own_cash', 'Melaporkan penerimaan tunai milik sendiri'),
  ('collector_optional', 'custody.view_own', 'Melihat saldo custody milik sendiri'),
  ('sales_admin', 'sales.read_allocatable', 'Melihat antrian dana terverifikasi siap dialokasikan'),
  ('reconciliation_reviewer', 'reconciliation.review', 'Meninjau selisih dan status rekonsiliasi'),
  ('accountant', 'accounting.view_events', 'Melihat outbox event akuntansi'),
  ('accountant', 'master.manage', 'Mengelola master rekening dan petugas'),
  ('accounting_approver', 'accounting.approve_journal', 'Menyetujui jurnal dan kebijakan pembukuan'),
  ('owner_viewer', 'dashboard.view_readonly', 'Melihat ringkasan dan audit tanpa mutasi'),
  ('system_admin', 'settings.manage', 'Mengelola pengaturan aplikasi, cabang, pengguna, dan URL')
ON CONFLICT (role_code, permission_code) DO NOTHING;

INSERT INTO public.schema_migrations (version, description)
VALUES ('0001_finops_shared_v1_foundation', 'Canonical multi-domain tables and role permissions matrix for FINOPS_SHARED_V1')
ON CONFLICT (version) DO NOTHING;
