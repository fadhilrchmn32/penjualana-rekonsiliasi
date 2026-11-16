-- ==============================================================================
-- FINOPS_SHARED_V1 — Migration 0005: App 2 (Penjualan & Rekonsiliasi) Additive Schema & RLS
-- Versi Kontrak: 1.0.0 | Tanggal: 2026-11-16
-- Prinsip: Additive-only terhadap fondasi App 1 (0001-0004). Tidak menyentuh/fork tabel penerimaan.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. KOLOM TAMBAHAN PADA sales_documents & sales_lines (Additive-Only)
-- ------------------------------------------------------------------------------
ALTER TABLE public.sales_documents
  ADD COLUMN IF NOT EXISTS planned_payment_method TEXT NOT NULL DEFAULT 'credit'
    CHECK (planned_payment_method IN ('credit', 'transfer', 'cash', 'mixed', 'unknown')),
  ADD COLUMN IF NOT EXISTS tax_basis TEXT NOT NULL DEFAULT 'non_tax'
    CHECK (tax_basis IN ('tax_exclusive', 'tax_inclusive', 'non_tax')),
  ADD COLUMN IF NOT EXISTS tax_code_id UUID REFERENCES public.tax_codes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS delivery_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_confirmed_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS delivery_proof_path TEXT,
  ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS released_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciliation_status TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK (reconciliation_status IN ('unreviewed', 'matched', 'needs_review', 'discrepancy', 'reviewed')),
  ADD COLUMN IF NOT EXISTS reconciled_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciliation_note TEXT,
  ADD COLUMN IF NOT EXISTS reconciler_label TEXT NOT NULL DEFAULT 'REKONSILIASI (ALMIRA)',
  ADD COLUMN IF NOT EXISTS is_legacy_archive BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS legacy_source_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES public.import_batches(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS import_row_id UUID REFERENCES public.import_rows(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS amended_from_id UUID REFERENCES public.sales_documents(id) ON DELETE RESTRICT;

-- Tambah status 'pending_delivery' pada check constraint status sales_documents secara aman
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sales_documents'::regclass
      AND conname = 'sales_documents_status_check'
  ) THEN
    ALTER TABLE public.sales_documents DROP CONSTRAINT sales_documents_status_check;
  END IF;
  ALTER TABLE public.sales_documents
    ADD CONSTRAINT sales_documents_status_check
    CHECK (status IN ('draft', 'pending_delivery', 'submitted', 'approved', 'released', 'corrected', 'voided'));
END $$;

CREATE INDEX IF NOT EXISTS idx_sales_docs_delivery
  ON public.sales_documents(company_id, branch_id, delivery_date DESC, status);
CREATE INDEX IF NOT EXISTS idx_sales_docs_customer
  ON public.sales_documents(company_id, customer_id, status, payment_status);
CREATE INDEX IF NOT EXISTS idx_sales_docs_source_inv
  ON public.sales_documents(company_id, source_invoice_no) WHERE source_invoice_no IS NOT NULL;

ALTER TABLE public.sales_lines
  ADD COLUMN IF NOT EXISTS product_sku_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS product_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS tax_code_id UUID REFERENCES public.tax_codes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS raw_source_total NUMERIC(20,2),
  ADD COLUMN IF NOT EXISTS has_price_discrepancy BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS discrepancy_note TEXT,
  ADD COLUMN IF NOT EXISTS source_line_id TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS legacy_source_data JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_sales_lines_doc
  ON public.sales_lines(sales_document_id, line_no);

-- ------------------------------------------------------------------------------
-- 2. APPEND-ONLY NOTES UNTUK KOREKSI NON-FINANSIAL DOKUMEN TERSETUJUI
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_document_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  sales_document_id UUID NOT NULL REFERENCES public.sales_documents(id) ON DELETE RESTRICT,
  note_text TEXT NOT NULL CHECK (length(trim(note_text)) > 0),
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 3. KOLOM TAMBAHAN PADA import_batches, import_rows, reconciliation_reviews & discrepancy_cases
-- ------------------------------------------------------------------------------
ALTER TABLE public.import_batches
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS sheet_name TEXT,
  ADD COLUMN IF NOT EXISTS mapping_version TEXT NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS date_format TEXT,
  ADD COLUMN IF NOT EXISTS decimal_format TEXT,
  ADD COLUMN IF NOT EXISTS tax_basis TEXT,
  ADD COLUMN IF NOT EXISTS grouping_mode TEXT,
  ADD COLUMN IF NOT EXISTS cutover_mode TEXT NOT NULL DEFAULT 'active'
    CHECK (cutover_mode IN ('active', 'legacy_archive', 'opening_subledger')),
  ADD COLUMN IF NOT EXISTS total_rows INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accepted_rows INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejected_rows INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS review_rows INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS committed_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS committed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.import_rows
  ADD COLUMN IF NOT EXISTS fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS source_doc_id TEXT,
  ADD COLUMN IF NOT EXISTS source_line_id TEXT,
  ADD COLUMN IF NOT EXISTS delivery_date DATE,
  ADD COLUMN IF NOT EXISTS resolved_customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_sales_staff_id UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parsed_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS legacy_source_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS resolution_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (resolution_status IN ('pending', 'accepted', 'needs_review', 'rejected', 'duplicate_kept', 'skipped_reimport')),
  ADD COLUMN IF NOT EXISTS created_sales_document_id UUID REFERENCES public.sales_documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_import_rows_batch ON public.import_rows(batch_id, row_no);
CREATE INDEX IF NOT EXISTS idx_import_rows_fp ON public.import_rows(company_id, fingerprint) WHERE fingerprint IS NOT NULL;

ALTER TABLE public.reconciliation_reviews
  ADD COLUMN IF NOT EXISTS review_stage TEXT NOT NULL DEFAULT 'waiting_finance_verification'
    CHECK (review_stage IN ('waiting_finance_verification', 'ready_to_match', 'allocation_pending_review', 'matched', 'discrepancy', 'completed')),
  ADD COLUMN IF NOT EXISTS reason_code TEXT,
  ADD COLUMN IF NOT EXISTS structured_notes JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_review_target
  ON public.reconciliation_reviews(company_id, target_type, target_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.discrepancy_cases'::regclass
      AND conname = 'discrepancy_cases_case_type_check'
  ) THEN
    ALTER TABLE public.discrepancy_cases DROP CONSTRAINT discrepancy_cases_case_type_check;
  END IF;
  ALTER TABLE public.discrepancy_cases
    ADD CONSTRAINT discrepancy_cases_case_type_check
    CHECK (case_type IN (
      'deposit_shortage', 'deposit_excess_unidentified', 'unknown_sender', 'unmatched_bank_line',
      'bank_fee_review', 'duplicate_review', 'missing_evidence',
      'sales_price_mismatch', 'delivery_date_conflict', 'missing_hpp_cost',
      'unknown_customer_import', 'unknown_sku_import', 'payment_dispute',
      'post_sale_discount', 'wrong_account_payment', 'customer_deduction'
    ));
END $$;

-- ------------------------------------------------------------------------------
-- 4. PERMISSIONS TAMBAHAN APP 2
-- ------------------------------------------------------------------------------
INSERT INTO public.role_permissions (role_code, permission_code, description) VALUES
  ('sales_admin', 'sales.create_draft', 'Membuat dan mengedit draft nota penjualan'),
  ('sales_admin', 'sales.submit', 'Mengajukan nota penjualan untuk persetujuan'),
  ('sales_admin', 'sales.import', 'Mengimpor rekap CSV/XLSX penjualan ke staging'),
  ('sales_admin', 'allocation.propose', 'Mengusulkan alokasi pembayaran many-to-many'),
  ('sales_admin', 'master.manage_sales', 'Mengelola master pelanggan, alias, produk, satuan'),
  ('reconciliation_reviewer', 'sales.approve_release', 'Menyetujui penjualan dan konfirmasi penyerahan barang'),
  ('reconciliation_reviewer', 'allocation.approve', 'Menyetujui alokasi pembayaran ke nota pelanggan'),
  ('reconciliation_reviewer', 'allocation.reverse', 'Melepas alokasi pembayaran dengan alasan resmi'),
  ('reconciliation_reviewer', 'sales.credit_note', 'Menerbitkan nota kredit / koreksi penjualan disetujui'),
  ('accountant', 'cogs.view', 'Melihat HPP dan valuasi persediaan'),
  ('accounting_approver', 'cogs.view', 'Melihat HPP dan valuasi persediaan'),
  ('owner_viewer', 'cogs.view', 'Melihat HPP dan laporan laba kotor'),
  ('system_admin', 'cogs.view', 'Melihat struktur valuasi persediaan untuk dukungan teknis')
ON CONFLICT (role_code, permission_code) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 5. COMPATIBILITY FIX: RLS SELECT POLICIES YANG BELUM ADA DI 0002
--    (Memastikan tabel App 2 dapat dibaca aman sesuai RLS tanpa bypass)
-- ------------------------------------------------------------------------------
ALTER TABLE public.sales_document_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_document_notes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sales_document_notes FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.sales_document_notes FROM authenticated;
GRANT SELECT ON TABLE public.sales_document_notes TO authenticated;

CREATE POLICY products_select ON public.products
  FOR SELECT TO authenticated USING (private.is_company_member(company_id));

CREATE POLICY product_units_select ON public.product_units
  FOR SELECT TO authenticated USING (private.is_company_member(company_id));

CREATE POLICY tax_codes_select ON public.tax_codes
  FOR SELECT TO authenticated USING (private.is_company_member(company_id));

CREATE POLICY sales_lines_select ON public.sales_lines
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sales_documents sd WHERE sd.id = sales_lines.sales_document_id));

CREATE POLICY sales_adjustments_select ON public.sales_adjustments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sales_documents sd WHERE sd.id = sales_adjustments.sales_document_id));

CREATE POLICY document_links_select ON public.document_links
  FOR SELECT TO authenticated USING (private.is_company_member(company_id));

CREATE POLICY sales_document_notes_select ON public.sales_document_notes
  FOR SELECT TO authenticated USING (private.has_branch_access(company_id, branch_id));

CREATE POLICY allocation_approvals_select ON public.allocation_approvals
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.payment_allocations pa WHERE pa.id = allocation_approvals.payment_allocation_id));

CREATE POLICY reconciliation_reviews_select ON public.reconciliation_reviews
  FOR SELECT TO authenticated
  USING (
    private.is_company_member(company_id)
    AND (branch_id IS NULL OR private.has_branch_access(company_id, branch_id))
  );

CREATE POLICY import_batches_select ON public.import_batches
  FOR SELECT TO authenticated
  USING (
    private.has_company_role(company_id, ARRAY['sales_admin','reconciliation_reviewer','accountant','owner_viewer','system_admin'])
    AND (branch_id IS NULL OR private.has_branch_access(company_id, branch_id))
  );

CREATE POLICY import_rows_select ON public.import_rows
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.import_batches ib WHERE ib.id = import_rows.batch_id));

CREATE POLICY customer_refunds_select ON public.customer_refunds
  FOR SELECT TO authenticated USING (private.has_branch_access(company_id, branch_id));

CREATE POLICY refund_lines_select ON public.refund_lines
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.customer_refunds cr WHERE cr.id = refund_lines.customer_refund_id));

CREATE POLICY attachments_select ON public.attachments
  FOR SELECT TO authenticated USING (private.is_company_member(company_id));

CREATE POLICY fiscal_periods_select ON public.fiscal_periods
  FOR SELECT TO authenticated USING (private.is_company_member(company_id));

CREATE POLICY opening_subledger_items_select ON public.opening_subledger_items
  FOR SELECT TO authenticated USING (private.is_company_member(company_id));

-- Pembatasan akses HPP & Harga Beli: sales_admin dan collector_optional TIDAK boleh membaca biaya/HPP
CREATE POLICY inventory_valuations_select ON public.inventory_valuations
  FOR SELECT TO authenticated
  USING (
    private.has_branch_access(company_id, branch_id)
    AND private.has_company_role(company_id, ARRAY['accountant','accounting_approver','owner_viewer','system_admin','reconciliation_reviewer'])
  );

CREATE POLICY inventory_movements_select ON public.inventory_movements
  FOR SELECT TO authenticated
  USING (
    private.has_branch_access(company_id, branch_id)
    AND private.has_company_role(company_id, ARRAY['accountant','accounting_approver','owner_viewer','system_admin','reconciliation_reviewer'])
  );

-- Update storage insert policy agar sales_admin & reconciliation_reviewer dapat mengunggah bukti pengiriman
DROP POLICY IF EXISTS finops_evidence_insert ON storage.objects;
CREATE POLICY finops_evidence_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'finops-evidence'
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    AND private.has_company_role(
      ((storage.foldername(name))[1])::UUID,
      ARRAY['finance_maker','finance_checker','collector_optional','accountant','sales_admin','reconciliation_reviewer']
    )
  );

-- Tambahkan tabel App 2 ke publikasi Realtime untuk sinyal invalidasi cache
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sales_documents;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sales_lines;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_allocations;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.reconciliation_reviews;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.import_batches;
  END IF;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

INSERT INTO public.schema_migrations (version, description)
VALUES ('0005_finops_app2_schema_and_rls', 'Additive App 2 sales/reconciliation/import columns, append-only notes, HPP-restricted RLS policies, and Realtime additions')
ON CONFLICT (version) DO NOTHING;
