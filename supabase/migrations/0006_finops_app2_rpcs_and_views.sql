-- ==============================================================================
-- FINOPS_SHARED_V1 — Migration 0006: App 2 Server Read Models & Transactional RPCs
-- Seluruh mutasi memakai SECURITY DEFINER, search_path = '', auth.uid(),
-- pemeriksaan membership/branch/role, maker-checker, idempotency_key,
-- optimistic locking, deterministic FOR UPDATE locks, dan atomic accounting_events.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. SERVER READ MODELS (MENGHINDARI DOUBLE JOIN & MENGHITUNG CUT-OFF)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_app2_document_balances
WITH (security_invoker = true) AS
WITH alloc_agg AS (
  SELECT
    pa.sales_document_id,
    COALESCE(SUM(pa.allocated_amount) FILTER (WHERE pa.status = 'approved'), 0)::NUMERIC(20,2) AS approved_allocated_amount,
    COALESCE(SUM(pa.allocated_amount) FILTER (WHERE pa.status = 'proposed'), 0)::NUMERIC(20,2) AS proposed_allocated_amount,
    BOOL_OR(pa.status = 'approved' AND r.receipt_channel = 'bank_transfer') AS has_transfer,
    BOOL_OR(pa.status = 'approved' AND r.receipt_channel = 'cash') AS has_cash,
    BOOL_OR(pa.status = 'proposed' OR (pa.status = 'approved' AND r.status = 'waiting_verification')) AS has_pending_verification,
    BOOL_OR(pa.status = 'approved' AND r.receipt_channel = 'cash' AND r.deposit_status IN ('not_deposited', 'partially_deposited', 'discrepancy')) AS has_cash_at_collector
  FROM public.payment_allocations pa
  JOIN public.receipts r ON r.id = pa.receipt_id
  GROUP BY pa.sales_document_id
),
credit_agg AS (
  SELECT
    dl.target_id AS sales_document_id,
    COALESCE(SUM(cn.total_amount), 0)::NUMERIC(20,2) AS credit_note_amount
  FROM public.document_links dl
  JOIN public.sales_documents cn ON cn.id = dl.source_id
  WHERE dl.link_type = 'credit_note_for'
    AND cn.doc_type = 'credit_note'
    AND cn.status IN ('approved', 'released')
  GROUP BY dl.target_id
)
SELECT
  sd.id AS sales_document_id,
  sd.company_id,
  sd.branch_id,
  sd.doc_number,
  sd.source_invoice_no,
  sd.doc_type,
  sd.customer_id,
  sd.sales_staff_id,
  sd.invoice_date,
  sd.delivery_date,
  sd.due_date,
  sd.status,
  sd.total_amount,
  COALESCE(ca.credit_note_amount, 0)::NUMERIC(20,2) AS credit_note_amount,
  GREATEST(0, sd.total_amount - COALESCE(ca.credit_note_amount, 0))::NUMERIC(20,2) AS net_bill_amount,
  COALESCE(aa.approved_allocated_amount, 0)::NUMERIC(20,2) AS paid_amount,
  COALESCE(aa.proposed_allocated_amount, 0)::NUMERIC(20,2) AS pending_allocation_amount,
  GREATEST(0, (sd.total_amount - COALESCE(ca.credit_note_amount, 0)) - COALESCE(aa.approved_allocated_amount, 0))::NUMERIC(20,2) AS outstanding_amount,
  CASE
    WHEN sd.is_legacy_archive THEN 'unpaid'
    WHEN COALESCE(aa.approved_allocated_amount, 0) <= 0 THEN 'unpaid'
    WHEN COALESCE(aa.approved_allocated_amount, 0) < GREATEST(0, sd.total_amount - COALESCE(ca.credit_note_amount, 0)) THEN 'partially_paid'
    WHEN COALESCE(aa.approved_allocated_amount, 0) = GREATEST(0, sd.total_amount - COALESCE(ca.credit_note_amount, 0)) THEN 'paid'
    ELSE 'overpaid'
  END AS derived_payment_status,
  CASE
    WHEN COALESCE(aa.has_transfer, false) AND COALESCE(aa.has_cash, false) THEN 'Campuran'
    WHEN COALESCE(aa.has_transfer, false) THEN 'Transfer'
    WHEN COALESCE(aa.has_cash, false) THEN 'Tunai'
    ELSE 'Belum Ada'
  END AS derived_payment_method,
  COALESCE(aa.has_pending_verification, false) AS has_pending_verification,
  COALESCE(aa.has_cash_at_collector, false) AS has_cash_at_collector,
  sd.planned_payment_method,
  sd.reconciliation_status,
  sd.reconciler_label,
  sd.reconciled_by,
  sd.reconciled_at,
  sd.reconciliation_note,
  sd.accounting_status,
  sd.is_legacy_archive,
  sd.version
FROM public.sales_documents sd
LEFT JOIN alloc_agg aa ON aa.sales_document_id = sd.id
LEFT JOIN credit_agg ca ON ca.sales_document_id = sd.id;

REVOKE ALL ON public.v_app2_document_balances FROM PUBLIC, anon;
GRANT SELECT ON public.v_app2_document_balances TO authenticated;

CREATE OR REPLACE VIEW public.v_app2_sales_recap
WITH (security_invoker = true) AS
WITH cust_deposit AS (
  SELECT
    r.customer_id,
    r.company_id,
    COALESCE(SUM(
      r.verified_amount
      - COALESCE(pa.allocated, 0)
      - COALESCE(rf.refunded, 0)
    ), 0)::NUMERIC(20,2) AS deposit_balance
  FROM public.receipts r
  LEFT JOIN (
    SELECT receipt_id, SUM(allocated_amount) AS allocated
    FROM public.payment_allocations WHERE status = 'approved' GROUP BY receipt_id
  ) pa ON pa.receipt_id = r.id
  LEFT JOIN (
    SELECT rl.receipt_id, SUM(rl.amount) AS refunded
    FROM public.refund_lines rl
    JOIN public.customer_refunds cr ON cr.id = rl.customer_refund_id
    WHERE cr.status IN ('approved', 'paid') GROUP BY rl.receipt_id
  ) rf ON rf.receipt_id = r.id
  WHERE r.status = 'verified' AND r.is_unknown_identity = false AND r.customer_id IS NOT NULL
  GROUP BY r.customer_id, r.company_id
)
SELECT
  sl.id AS sales_line_id,
  sd.id AS sales_document_id,
  sd.company_id,
  sd.branch_id,
  sd.doc_number,
  sd.source_invoice_no,
  sd.doc_type,
  sd.status AS document_status,
  sd.delivery_date,
  CASE WHEN sd.delivery_date IS NOT NULL THEN to_char(sd.delivery_date, 'IYYY-"W"IW') ELSE NULL END AS iso_week,
  CASE WHEN sd.delivery_date IS NOT NULL THEN to_char(sd.delivery_date, 'YYYY-MM') ELSE NULL END AS iso_month,
  sd.invoice_date,
  sd.due_date,
  c.id AS customer_uuid,
  c.cust_id,
  c.name AS cust_name,
  p.id AS product_uuid,
  COALESCE(sl.product_sku_snapshot, p.sku) AS product_sku,
  COALESCE(sl.product_name_snapshot, p.name) AS product_name,
  sl.line_no,
  sl.unit_code,
  sl.quantity,
  sl.net_unit_price,
  sl.line_total,
  sl.raw_source_total,
  sl.has_price_discrepancy,
  st.id AS sales_staff_id,
  COALESCE(st.full_name, '-') AS sales_name,
  db.derived_payment_method AS metode_pembayaran,
  db.derived_payment_status AS status_pembayaran,
  sd.planned_payment_method,
  COALESCE(sl.notes, sd.notes, '') AS keterangan,
  sd.reconciliation_status,
  sd.reconciler_label,
  prof_rec.full_name AS reconciled_by_name,
  sd.reconciled_at,
  sd.reconciliation_note,
  db.total_amount AS document_total_amount,
  db.credit_note_amount,
  db.net_bill_amount,
  db.paid_amount,
  db.pending_allocation_amount,
  db.outstanding_amount,
  COALESCE(cd.deposit_balance, 0)::NUMERIC(20,2) AS customer_deposit_balance,
  db.has_pending_verification,
  db.has_cash_at_collector,
  sd.accounting_status,
  sd.is_legacy_archive,
  sd.legacy_source_data,
  sl.legacy_source_data AS line_legacy_source_data,
  sd.tax_basis,
  sd.version,
  sd.created_at
FROM public.sales_lines sl
JOIN public.sales_documents sd ON sd.id = sl.sales_document_id
JOIN public.v_app2_document_balances db ON db.sales_document_id = sd.id
JOIN public.customers c ON c.id = sd.customer_id
JOIN public.products p ON p.id = sl.product_id
LEFT JOIN public.staff st ON st.id = sd.sales_staff_id
LEFT JOIN public.profiles prof_rec ON prof_rec.id = sd.reconciled_by
LEFT JOIN cust_deposit cd ON cd.customer_id = sd.customer_id AND cd.company_id = sd.company_id;

REVOKE ALL ON public.v_app2_sales_recap FROM PUBLIC, anon;
GRANT SELECT ON public.v_app2_sales_recap TO authenticated;

-- ------------------------------------------------------------------------------
-- 2. PRIVATE ROUNDING & VALIDATION HELPERS
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.round_half_up(p_val NUMERIC, p_scale INTEGER DEFAULT 0)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ROUND(p_val, COALESCE(p_scale, 0));
$$;

-- ------------------------------------------------------------------------------
-- 3. RPC: draft_sale
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.draft_sale(
  p_idempotency_key TEXT,
  p_company_id UUID,
  p_branch_id UUID,
  p_customer_id UUID,
  p_sales_staff_id UUID,
  p_invoice_date DATE,
  p_delivery_date DATE,
  p_due_date DATE,
  p_planned_payment_method TEXT DEFAULT 'credit',
  p_tax_basis TEXT DEFAULT 'non_tax',
  p_tax_code_id UUID DEFAULT NULL,
  p_source_invoice_no TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_delivery_proof_path TEXT DEFAULT NULL,
  p_lines JSONB DEFAULT '[]'::jsonb,
  p_sales_document_id UUID DEFAULT NULL,
  p_expected_version INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_doc_id UUID;
  v_doc_no TEXT;
  v_existing public.sales_documents%ROWTYPE;
  v_line JSONB;
  v_line_no INTEGER := 0;
  v_prod public.products%ROWTYPE;
  v_qty NUMERIC(20,6);
  v_price NUMERIC(20,6);
  v_raw NUMERIC(20,6);
  v_line_total NUMERIC(20,2);
  v_line_round_diff NUMERIC(20,6);
  v_subtotal NUMERIC(20,2) := 0;
  v_total_round_diff NUMERIC(20,2) := 0;
  v_tax_rate NUMERIC(10,6) := 0;
  v_tax_total NUMERIC(20,2) := 0;
  v_doc_total NUMERIC(20,2) := 0;
  v_scale INTEGER := 0;
  v_status TEXT;
  v_new_version INTEGER := 1;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'draft_sale', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF NOT private.has_branch_role(p_company_id, p_branch_id, ARRAY['sales_admin','reconciliation_reviewer','system_admin']) THEN
    RAISE EXCEPTION 'Izin cabang atau peran ditolak untuk mencatat penjualan.' USING ERRCODE = '42501';
  END IF;

  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Nota penjualan minimal harus memiliki 1 baris produk.' USING ERRCODE = '22023';
  END IF;

  -- Verifikasi pelanggan milik company & branch yang sama
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id AND company_id = p_company_id) THEN
    RAISE EXCEPTION 'Pelanggan tidak valid untuk badan usaha ini.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(rounding_scale, 0) INTO v_scale FROM public.app_settings WHERE company_id = p_company_id;
  IF p_tax_code_id IS NOT NULL AND p_tax_basis <> 'non_tax' THEN
    SELECT COALESCE(rate, 0) INTO v_tax_rate FROM public.tax_codes WHERE id = p_tax_code_id AND company_id = p_company_id;
  END IF;

  v_status := CASE WHEN p_delivery_date IS NULL THEN 'pending_delivery' ELSE 'draft' END;

  IF p_sales_document_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.sales_documents WHERE id = p_sales_document_id FOR UPDATE;
    IF NOT FOUND OR v_existing.company_id <> p_company_id THEN
      RAISE EXCEPTION 'Dokumen penjualan tidak ditemukan.' USING ERRCODE = 'P0002';
    END IF;
    IF v_existing.status NOT IN ('draft', 'pending_delivery') THEN
      RAISE EXCEPTION 'Dokumen yang sudah diajukan/disetujui tidak boleh diedit langsung. Gunakan nota kredit/koreksi.' USING ERRCODE = '22023';
    END IF;
    IF p_expected_version IS NOT NULL AND v_existing.version <> p_expected_version THEN
      RAISE EXCEPTION 'Konflik versi dokumen (expected %, aktual %).', p_expected_version, v_existing.version USING ERRCODE = '40001';
    END IF;
    v_doc_id := v_existing.id;
    v_doc_no := v_existing.doc_number;
    v_new_version := v_existing.version + 1;
    DELETE FROM public.sales_lines WHERE sales_document_id = v_doc_id;
  ELSE
    v_doc_no := private.next_document_number(p_company_id, 'sales_invoice', 'SLS', COALESCE(p_delivery_date, p_invoice_date, CURRENT_DATE));
    INSERT INTO public.sales_documents (
      company_id, branch_id, doc_number, source_invoice_no, doc_type,
      customer_id, sales_staff_id, invoice_date, delivery_date, due_date,
      planned_payment_method, tax_basis, tax_code_id, delivery_proof_path, notes,
      status, created_by, updated_by, source_app
    ) VALUES (
      p_company_id, p_branch_id, v_doc_no, p_source_invoice_no, 'sales_invoice',
      p_customer_id, p_sales_staff_id, p_invoice_date, p_delivery_date, p_due_date,
      COALESCE(p_planned_payment_method, 'credit'), COALESCE(p_tax_basis, 'non_tax'), p_tax_code_id,
      p_delivery_proof_path, p_notes, v_status, v_actor_id, v_actor_id, 'app2_sales_reconciliation'
    )
    RETURNING id INTO v_doc_id;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_no := v_line_no + 1;
    SELECT * INTO v_prod FROM public.products WHERE id = (v_line->>'product_id')::UUID AND company_id = p_company_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Produk baris ke-% tidak valid.', v_line_no USING ERRCODE = '22023'; END IF;

    v_qty := (v_line->>'quantity')::NUMERIC(20,6);
    v_price := (v_line->>'net_unit_price')::NUMERIC(20,6);
    IF v_qty <= 0 OR v_price < 0 THEN
      RAISE EXCEPTION 'Kuantitas harus > 0 dan harga >= 0 pada baris ke-%.' , v_line_no USING ERRCODE = '22023';
    END IF;

    v_raw := v_qty * v_price;
    v_line_total := private.round_half_up(v_raw, v_scale);
    v_line_round_diff := v_line_total - v_raw;

    INSERT INTO public.sales_lines (
      company_id, sales_document_id, line_no, product_id,
      product_sku_snapshot, product_name_snapshot,
      unit_code, quantity, net_unit_price, line_total_raw, line_total, rounding_diff,
      notes, source_line_id
    ) VALUES (
      p_company_id, v_doc_id, v_line_no, v_prod.id,
      v_prod.sku, v_prod.name,
      COALESCE(NULLIF(v_line->>'unit_code', ''), v_prod.base_unit),
      v_qty, v_price, v_raw, v_line_total, v_line_round_diff,
      v_line->>'notes', v_line->>'source_line_id'
    );

    v_subtotal := v_subtotal + v_line_total;
    v_total_round_diff := v_total_round_diff + v_line_round_diff::NUMERIC(20,2);
  END LOOP;

  IF p_tax_basis = 'tax_exclusive' AND v_tax_rate > 0 THEN
    v_tax_total := private.round_half_up(v_subtotal * v_tax_rate, v_scale);
    v_doc_total := v_subtotal + v_tax_total;
  ELSIF p_tax_basis = 'tax_inclusive' AND v_tax_rate > 0 THEN
    v_doc_total := v_subtotal;
    v_tax_total := private.round_half_up(v_doc_total - (v_doc_total / (1 + v_tax_rate)), v_scale);
    v_subtotal := v_doc_total - v_tax_total;
  ELSE
    v_tax_total := 0;
    v_doc_total := v_subtotal;
  END IF;

  UPDATE public.sales_documents
  SET customer_id = p_customer_id,
      sales_staff_id = p_sales_staff_id,
      invoice_date = p_invoice_date,
      delivery_date = p_delivery_date,
      due_date = p_due_date,
      planned_payment_method = COALESCE(p_planned_payment_method, 'credit'),
      tax_basis = COALESCE(p_tax_basis, 'non_tax'),
      tax_code_id = p_tax_code_id,
      source_invoice_no = p_source_invoice_no,
      delivery_proof_path = COALESCE(p_delivery_proof_path, delivery_proof_path),
      notes = p_notes,
      subtotal_amount = v_subtotal,
      tax_amount = v_tax_total,
      rounding_diff = v_total_round_diff,
      total_amount = v_doc_total,
      status = v_status,
      updated_by = v_actor_id,
      version = v_new_version,
      updated_at = now()
  WHERE id = v_doc_id;

  PERFORM private.write_audit_event(
    p_company_id, p_branch_id, v_actor_id, 'sales.draft', 'sales_document', v_doc_id,
    NULL, jsonb_build_object('doc_number', v_doc_no, 'total_amount', v_doc_total, 'lines', v_line_no),
    'Draft nota penjualan disimpan'
  );

  v_result := jsonb_build_object(
    'sales_document_id', v_doc_id,
    'doc_number', v_doc_no,
    'status', v_status,
    'total_amount', v_doc_total,
    'version', v_new_version
  );
  PERFORM private.save_idempotency(p_company_id, v_actor_id, 'draft_sale', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. RPC: submit_sale
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_sale(
  p_idempotency_key TEXT,
  p_sales_document_id UUID,
  p_expected_version INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_sd public.sales_documents%ROWTYPE;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'submit_sale', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_sd FROM public.sales_documents WHERE id = p_sales_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nota penjualan tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT private.has_branch_role(v_sd.company_id, v_sd.branch_id, ARRAY['sales_admin','reconciliation_reviewer']) THEN
    RAISE EXCEPTION 'Izin ditolak.' USING ERRCODE = '42501';
  END IF;

  IF v_sd.version <> p_expected_version THEN
    RAISE EXCEPTION 'Konflik versi dokumen.' USING ERRCODE = '40001';
  END IF;

  IF v_sd.status NOT IN ('draft', 'pending_delivery') THEN
    RAISE EXCEPTION 'Hanya draft yang dapat diajukan persetujuan.' USING ERRCODE = '22023';
  END IF;

  IF v_sd.delivery_date IS NULL THEN
    RAISE EXCEPTION 'Tanggal pengiriman wajib diisi sebelum pengajuan persetujuan penjualan.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.sales_documents
  SET status = 'submitted',
      submitted_by = v_actor_id,
      submitted_at = now(),
      updated_by = v_actor_id,
      version = version + 1,
      updated_at = now()
  WHERE id = v_sd.id;

  PERFORM private.write_audit_event(
    v_sd.company_id, v_sd.branch_id, v_actor_id, 'sales.submit', 'sales_document', v_sd.id,
    jsonb_build_object('status', v_sd.status), jsonb_build_object('status', 'submitted'),
    'Nota diajukan untuk persetujuan dan konfirmasi penyerahan'
  );

  v_result := jsonb_build_object('sales_document_id', v_sd.id, 'status', 'submitted', 'version', v_sd.version + 1);
  PERFORM private.save_idempotency(v_sd.company_id, v_actor_id, 'submit_sale', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. RPC: approve_and_release_sale (Cek HPP/Stok + Maker-Checker + Event Akuntansi Atomik)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_and_release_sale(
  p_idempotency_key TEXT,
  p_sales_document_id UUID,
  p_expected_version INTEGER,
  p_confirmed_delivery_date DATE DEFAULT NULL,
  p_approval_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_sd public.sales_documents%ROWTYPE;
  v_eff_delivery DATE;
  v_line RECORD;
  v_val public.inventory_valuations%ROWTYPE;
  v_total_cogs NUMERIC(20,2) := 0;
  v_line_cogs NUMERIC(20,2);
  v_rev_event_id UUID;
  v_cogs_event_id UUID;
  v_missing_hpp TEXT[] := '{}'::text[];
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'approve_and_release_sale', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_sd FROM public.sales_documents WHERE id = p_sales_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nota penjualan tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT private.has_branch_role(v_sd.company_id, v_sd.branch_id, ARRAY['reconciliation_reviewer','accounting_approver']) THEN
    RAISE EXCEPTION 'Hanya reviewer/approver berwenang yang dapat menyetujui dan merilis penjualan.' USING ERRCODE = '42501';
  END IF;

  PERFORM private.assert_maker_checker(v_sd.created_by, v_actor_id, 'nota penjualan');
  IF v_sd.submitted_by IS NOT NULL THEN
    PERFORM private.assert_maker_checker(v_sd.submitted_by, v_actor_id, 'pengajuan penjualan');
  END IF;

  IF v_sd.version <> p_expected_version THEN RAISE EXCEPTION 'Konflik versi dokumen.' USING ERRCODE = '40001'; END IF;
  IF v_sd.status <> 'submitted' THEN RAISE EXCEPTION 'Hanya nota berstatus diajukan yang dapat dirilis.' USING ERRCODE = '22023'; END IF;

  v_eff_delivery := COALESCE(p_confirmed_delivery_date, v_sd.delivery_date);
  IF v_eff_delivery IS NULL THEN
    RAISE EXCEPTION 'Tanggal penyerahan barang wajib dikonfirmasi sebelum pengakuan penjualan.' USING ERRCODE = '22023';
  END IF;

  -- Cek ketersediaan stok & HPP pada mesin bersama (jangan pasang HPP nol atau stok negatif!)
  FOR v_line IN
    SELECT sl.*, p.is_stocked, p.sku, p.name AS product_name
    FROM public.sales_lines sl
    JOIN public.products p ON p.id = sl.product_id
    WHERE sl.sales_document_id = v_sd.id
    ORDER BY sl.line_no
  LOOP
    IF v_line.has_price_discrepancy THEN
      RAISE EXCEPTION 'Baris produk % masih memiliki selisih nilai sumber vs formula yang belum diselesaikan.', v_line.sku USING ERRCODE = '22023';
    END IF;

    IF v_line.is_stocked THEN
      SELECT * INTO v_val
      FROM public.inventory_valuations
      WHERE company_id = v_sd.company_id AND branch_id = v_sd.branch_id AND product_id = v_line.product_id
      FOR UPDATE;

      IF NOT FOUND OR v_val.avg_unit_cost <= 0 OR v_val.qty_on_hand < v_line.quantity THEN
        v_missing_hpp := array_append(v_missing_hpp, v_line.sku || ' (stok/HPP belum tersedia)');
      ELSE
        v_line_cogs := private.round_half_up(v_line.quantity * v_val.avg_unit_cost, 0);
        v_total_cogs := v_total_cogs + v_line_cogs;

        UPDATE public.inventory_valuations
        SET qty_on_hand = qty_on_hand - v_line.quantity,
            total_value = GREATEST(0, total_value - v_line_cogs),
            updated_at = now()
        WHERE id = v_val.id;

        INSERT INTO public.inventory_movements (
          company_id, branch_id, product_id, movement_date, direction, quantity, unit_cost, source_type, source_id
        ) VALUES (
          v_sd.company_id, v_sd.branch_id, v_line.product_id, v_eff_delivery, 'out',
          v_line.quantity, v_val.avg_unit_cost, 'sales_document', v_sd.id
        );
      END IF;
    END IF;
  END LOOP;

  IF array_length(v_missing_hpp, 1) > 0 THEN
    -- Catat kasus pengecualian agar hambatan terlihat jelas dan transaksi tidak dirilis parsial
    INSERT INTO public.discrepancy_cases (
      company_id, branch_id, case_number, case_type, source_type, source_id,
      expected_amount, actual_amount, discrepancy_amount, status, resolution_note, created_by
    ) VALUES (
      v_sd.company_id, v_sd.branch_id,
      private.next_document_number(v_sd.company_id, 'discrepancy_case', 'CASE', CURRENT_DATE),
      'missing_hpp_cost', 'sales_document', v_sd.id,
      v_sd.total_amount, 0, 0, 'open',
      'Opening stock atau HPP belum tersedia untuk SKU: ' || array_to_string(v_missing_hpp, ', '),
      v_actor_id
    ) ON CONFLICT DO NOTHING;

    RAISE EXCEPTION 'Penjualan tidak dapat dirilis karena stok/HPP belum tersedia untuk SKU: %. Catat stok awal/pembelian di App 3 terlebih dahulu.', array_to_string(v_missing_hpp, ', ')
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.sales_documents
  SET status = 'released',
      delivery_date = v_eff_delivery,
      delivery_confirmed_at = now(),
      delivery_confirmed_by = v_actor_id,
      approved_by = v_actor_id,
      released_by = v_actor_id,
      released_at = now(),
      accounting_status = 'queued',
      source_version = source_version + 1,
      updated_by = v_actor_id,
      version = version + 1,
      updated_at = now()
  WHERE id = v_sd.id;

  -- Emit event Revenue dan event COGS terhubung (group atomik untuk App 3)
  v_rev_event_id := private.emit_accounting_event(
    v_sd.company_id, v_sd.branch_id, 'sales_revenue_recognized', 'sales_document', v_sd.id, v_sd.source_version + 1,
    v_eff_delivery,
    jsonb_build_object(
      'doc_number', v_sd.doc_number,
      'customer_id', v_sd.customer_id,
      'subtotal_amount', v_sd.subtotal_amount,
      'tax_amount', v_sd.tax_amount,
      'rounding_diff', v_sd.rounding_diff,
      'total_amount', v_sd.total_amount,
      'cogs_amount', v_total_cogs
    ),
    ARRAY[]::UUID[], v_actor_id, v_sd.correlation_id
  );

  v_cogs_event_id := private.emit_accounting_event(
    v_sd.company_id, v_sd.branch_id, 'sales_cogs_recognized', 'sales_document', v_sd.id, v_sd.source_version + 1,
    v_eff_delivery,
    jsonb_build_object(
      'doc_number', v_sd.doc_number,
      'cogs_amount', v_total_cogs,
      'paired_revenue_event_id', v_rev_event_id
    ),
    ARRAY[v_rev_event_id], v_actor_id, v_sd.correlation_id
  );

  INSERT INTO public.event_dependencies (company_id, accounting_event_id, depends_on_type, depends_on_id)
  VALUES (v_sd.company_id, v_cogs_event_id, 'accounting_event', v_rev_event_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.approvals (company_id, branch_id, target_type, target_id, action, decision, actor_id, reason)
  VALUES (v_sd.company_id, v_sd.branch_id, 'sales_document', v_sd.id, 'approve_and_release_sale', 'approved', v_actor_id, p_approval_note);

  PERFORM private.write_audit_event(
    v_sd.company_id, v_sd.branch_id, v_actor_id, 'sales.approve_and_release', 'sales_document', v_sd.id,
    jsonb_build_object('status', v_sd.status),
    jsonb_build_object('status', 'released', 'delivery_date', v_eff_delivery, 'revenue_event', v_rev_event_id, 'cogs_event', v_cogs_event_id),
    COALESCE(p_approval_note, 'Penjualan disetujui dan diserahkan')
  );

  v_result := jsonb_build_object(
    'sales_document_id', v_sd.id,
    'status', 'released',
    'delivery_date', v_eff_delivery,
    'revenue_event_id', v_rev_event_id,
    'cogs_event_id', v_cogs_event_id,
    'version', v_sd.version + 1
  );
  PERFORM private.save_idempotency(v_sd.company_id, v_actor_id, 'approve_and_release_sale', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. RPC: propose_payment_allocation & approve_payment_allocation & reverse_payment_allocation
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.propose_payment_allocation(
  p_idempotency_key TEXT,
  p_company_id UUID,
  p_branch_id UUID,
  p_items JSONB, -- [{receipt_id, sales_document_id, allocated_amount, notes}]
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_item JSONB;
  v_r public.receipts%ROWTYPE;
  v_sd public.sales_documents%ROWTYPE;
  v_amt NUMERIC(20,2);
  v_r_used NUMERIC(20,2);
  v_r_refunded NUMERIC(20,2);
  v_sd_paid NUMERIC(20,2);
  v_sd_cn NUMERIC(20,2);
  v_alloc_id UUID;
  v_ids UUID[] := '{}'::uuid[];
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'propose_payment_allocation', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF NOT private.has_branch_role(p_company_id, p_branch_id, ARRAY['sales_admin','reconciliation_reviewer','finance_maker','finance_checker']) THEN
    RAISE EXCEPTION 'Izin ditolak mengusulkan alokasi pembayaran.' USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Daftar alokasi tidak boleh kosong.' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_amt := (v_item->>'allocated_amount')::NUMERIC(20,2);
    IF v_amt IS NULL OR v_amt <= 0 THEN
      RAISE EXCEPTION 'Nominal alokasi harus lebih dari 0.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_r FROM public.receipts WHERE id = (v_item->>'receipt_id')::UUID FOR UPDATE;
    IF NOT FOUND OR v_r.company_id <> p_company_id THEN
      RAISE EXCEPTION 'Penerimaan tidak ditemukan.' USING ERRCODE = 'P0002';
    END IF;
    IF v_r.status <> 'verified' THEN
      RAISE EXCEPTION 'Hanya penerimaan terverifikasi yang dapat dialokasikan (status %: %).', v_r.receipt_number, v_r.status USING ERRCODE = '22023';
    END IF;
    IF v_r.is_unknown_identity OR v_r.customer_id IS NULL THEN
      RAISE EXCEPTION 'Penerimaan % belum memiliki identitas pelanggan sah dari App 1.', v_r.receipt_number USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_sd FROM public.sales_documents WHERE id = (v_item->>'sales_document_id')::UUID FOR UPDATE;
    IF NOT FOUND OR v_sd.company_id <> p_company_id OR v_sd.branch_id <> p_branch_id THEN
      RAISE EXCEPTION 'Nota penjualan tidak ditemukan pada cabang ini.' USING ERRCODE = 'P0002';
    END IF;
    IF v_sd.status NOT IN ('approved', 'released') OR v_sd.is_legacy_archive THEN
      RAISE EXCEPTION 'Nota % belum disetujui/dirilis atau merupakan arsip non-posting.', v_sd.doc_number USING ERRCODE = '22023';
    END IF;
    IF v_sd.customer_id <> v_r.customer_id THEN
      RAISE EXCEPTION 'Pelanggan penerimaan dan nota % tidak sama. Lintas pelanggan dilarang.', v_sd.doc_number USING ERRCODE = '22023';
    END IF;
    IF v_sd.currency <> v_r.currency THEN
      RAISE EXCEPTION 'Mata uang tidak sama.' USING ERRCODE = '22023';
    END IF;

    -- Hitung saldo tersedia termasuk usulan aktif agar tidak melebihi saldo
    SELECT COALESCE(SUM(allocated_amount), 0) INTO v_r_used
    FROM public.payment_allocations WHERE receipt_id = v_r.id AND status IN ('approved', 'proposed');

    SELECT COALESCE(SUM(rl.amount), 0) INTO v_r_refunded
    FROM public.refund_lines rl
    JOIN public.customer_refunds cr ON cr.id = rl.customer_refund_id
    WHERE rl.receipt_id = v_r.id AND cr.status IN ('submitted', 'approved', 'paid');

    IF (v_r.verified_amount - v_r_used - v_r_refunded) < v_amt THEN
      RAISE EXCEPTION 'Saldo tersedia penerimaan % tidak mencukupi untuk alokasi ini.', v_r.receipt_number USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(SUM(allocated_amount), 0) INTO v_sd_paid
    FROM public.payment_allocations WHERE sales_document_id = v_sd.id AND status IN ('approved', 'proposed');

    SELECT COALESCE(SUM(cn.total_amount), 0) INTO v_sd_cn
    FROM public.document_links dl JOIN public.sales_documents cn ON cn.id = dl.source_id
    WHERE dl.target_id = v_sd.id AND dl.link_type = 'credit_note_for' AND cn.status IN ('approved', 'released');

    IF ((v_sd.total_amount - v_sd_cn) - v_sd_paid) < v_amt THEN
      RAISE EXCEPTION 'Nominal alokasi melebihi sisa tagihan nota %.', v_sd.doc_number USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.payment_allocations (
      company_id, branch_id, receipt_id, sales_document_id, allocated_amount,
      status, notes, created_by, source_app
    ) VALUES (
      p_company_id, p_branch_id, v_r.id, v_sd.id, v_amt,
      'proposed', COALESCE(v_item->>'notes', p_notes), v_actor_id, 'app2_sales_reconciliation'
    )
    RETURNING id INTO v_alloc_id;

    v_ids := array_append(v_ids, v_alloc_id);
  END LOOP;

  v_result := jsonb_build_object('allocation_ids', v_ids, 'status', 'proposed');
  PERFORM private.save_idempotency(p_company_id, v_actor_id, 'propose_payment_allocation', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_payment_allocation(
  p_idempotency_key TEXT,
  p_allocation_ids UUID[],
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_pa public.payment_allocations%ROWTYPE;
  v_r public.receipts%ROWTYPE;
  v_sd public.sales_documents%ROWTYPE;
  v_r_used NUMERIC(20,2);
  v_r_refunded NUMERIC(20,2);
  v_sd_paid NUMERIC(20,2);
  v_sd_cn NUMERIC(20,2);
  v_new_pay_status TEXT;
  v_eff_date DATE;
  v_approved_ids UUID[] := '{}'::uuid[];
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'approve_payment_allocation', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  -- Lock deterministik: payment_allocations -> receipts -> sales_documents berurutan per UUID
  FOR v_pa IN
    SELECT * FROM public.payment_allocations
    WHERE id = ANY(p_allocation_ids)
    ORDER BY receipt_id, sales_document_id, id
    FOR UPDATE
  LOOP
    IF NOT private.has_branch_role(v_pa.company_id, v_pa.branch_id, ARRAY['reconciliation_reviewer','finance_checker']) THEN
      RAISE EXCEPTION 'Hanya reviewer rekonsiliasi yang dapat menyetujui alokasi pembayaran.' USING ERRCODE = '42501';
    END IF;

    PERFORM private.assert_maker_checker(v_pa.created_by, v_actor_id, 'usulan alokasi pembayaran');

    IF v_pa.status <> 'proposed' THEN
      RAISE EXCEPTION 'Alokasi % sudah diproses (status: %).', v_pa.id, v_pa.status USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_r FROM public.receipts WHERE id = v_pa.receipt_id FOR UPDATE;
    SELECT * INTO v_sd FROM public.sales_documents WHERE id = v_pa.sales_document_id FOR UPDATE;

    SELECT COALESCE(SUM(allocated_amount), 0) INTO v_r_used
    FROM public.payment_allocations WHERE receipt_id = v_r.id AND status = 'approved';

    SELECT COALESCE(SUM(rl.amount), 0) INTO v_r_refunded
    FROM public.refund_lines rl JOIN public.customer_refunds cr ON cr.id = rl.customer_refund_id
    WHERE rl.receipt_id = v_r.id AND cr.status IN ('approved', 'paid');

    IF (v_r.verified_amount - v_r_used - v_r_refunded) < v_pa.allocated_amount THEN
      RAISE EXCEPTION 'Saldo tersedia penerimaan % tidak mencukupi (konkurensi/over-allocation dicegah).', v_r.receipt_number USING ERRCODE = '40001';
    END IF;

    SELECT COALESCE(SUM(allocated_amount), 0) INTO v_sd_paid
    FROM public.payment_allocations WHERE sales_document_id = v_sd.id AND status = 'approved';

    SELECT COALESCE(SUM(cn.total_amount), 0) INTO v_sd_cn
    FROM public.document_links dl JOIN public.sales_documents cn ON cn.id = dl.source_id
    WHERE dl.target_id = v_sd.id AND dl.link_type = 'credit_note_for' AND cn.status IN ('approved', 'released');

    IF ((v_sd.total_amount - v_sd_cn) - v_sd_paid) < v_pa.allocated_amount THEN
      RAISE EXCEPTION 'Alokasi melebihi sisa piutang nota %.', v_sd.doc_number USING ERRCODE = '40001';
    END IF;

    UPDATE public.payment_allocations
    SET status = 'approved',
        approved_by = v_actor_id,
        approved_at = now(),
        notes = COALESCE(p_notes, notes),
        version = version + 1
    WHERE id = v_pa.id;

    INSERT INTO public.allocation_approvals (company_id, payment_allocation_id, decision, actor_id, reason)
    VALUES (v_pa.company_id, v_pa.id, 'approved', v_actor_id, p_notes);

    -- Perbarui payment_status nota secara server-side
    v_sd_paid := v_sd_paid + v_pa.allocated_amount;
    v_new_pay_status := CASE
      WHEN v_sd_paid <= 0 THEN 'unpaid'
      WHEN v_sd_paid < GREATEST(0, v_sd.total_amount - v_sd_cn) THEN 'partially_paid'
      ELSE 'paid'
    END;

    UPDATE public.sales_documents
    SET payment_status = v_new_pay_status,
        version = version + 1,
        updated_at = now()
    WHERE id = v_sd.id;

    v_eff_date := GREATEST(COALESCE(v_sd.delivery_date, v_sd.invoice_date), COALESCE(v_r.bank_value_date, v_r.customer_paid_at));

    PERFORM private.emit_accounting_event(
      v_pa.company_id, v_pa.branch_id, 'payment_allocated_to_sale', 'payment_allocation', v_pa.id, v_pa.version + 1,
      v_eff_date,
      jsonb_build_object(
        'receipt_id', v_r.id,
        'receipt_number', v_r.receipt_number,
        'sales_document_id', v_sd.id,
        'doc_number', v_sd.doc_number,
        'customer_id', v_sd.customer_id,
        'allocated_amount', v_pa.allocated_amount
      ),
      ARRAY[]::UUID[], v_actor_id, v_sd.correlation_id
    );

    PERFORM private.write_audit_event(
      v_pa.company_id, v_pa.branch_id, v_actor_id, 'allocation.approve', 'payment_allocation', v_pa.id,
      jsonb_build_object('status', 'proposed'),
      jsonb_build_object('status', 'approved', 'allocated_amount', v_pa.allocated_amount, 'invoice_payment_status', v_new_pay_status),
      COALESCE(p_notes, 'Alokasi pembayaran disetujui')
    );

    v_approved_ids := array_append(v_approved_ids, v_pa.id);
  END LOOP;

  IF array_length(v_approved_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Tidak ada alokasi valid yang disetujui.' USING ERRCODE = 'P0002';
  END IF;

  v_result := jsonb_build_object('approved_allocation_ids', v_approved_ids, 'status', 'approved');
  PERFORM private.save_idempotency(v_pa.company_id, v_actor_id, 'approve_payment_allocation', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_payment_allocation(
  p_idempotency_key TEXT,
  p_allocation_id UUID,
  p_expected_version INTEGER,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_pa public.payment_allocations%ROWTYPE;
  v_sd public.sales_documents%ROWTYPE;
  v_period_closed BOOLEAN := false;
  v_sd_paid NUMERIC(20,2);
  v_sd_cn NUMERIC(20,2);
  v_new_pay_status TEXT;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'reverse_payment_allocation', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Alasan pelepasan alokasi wajib diisi.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_pa FROM public.payment_allocations WHERE id = p_allocation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Alokasi pembayaran tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT private.has_branch_role(v_pa.company_id, v_pa.branch_id, ARRAY['reconciliation_reviewer','accounting_approver']) THEN
    RAISE EXCEPTION 'Izin ditolak melepas alokasi.' USING ERRCODE = '42501';
  END IF;

  PERFORM private.assert_maker_checker(v_pa.approved_by, v_actor_id, 'pelepasan alokasi pembayaran');

  IF v_pa.version <> p_expected_version THEN RAISE EXCEPTION 'Konflik versi.' USING ERRCODE = '40001'; END IF;
  IF v_pa.status <> 'approved' THEN RAISE EXCEPTION 'Hanya alokasi disetujui yang dapat dilepas.' USING ERRCODE = '22023'; END IF;

  -- Cek apakah periode akuntansi sudah ditutup
  SELECT EXISTS (
    SELECT 1 FROM public.fiscal_periods fp
    WHERE fp.company_id = v_pa.company_id
      AND fp.status = 'closed'
      AND COALESCE(v_pa.approved_at::DATE, CURRENT_DATE) BETWEEN fp.start_date AND fp.end_date
  ) INTO v_period_closed;

  IF v_period_closed THEN
    RAISE EXCEPTION 'Periode akuntansi untuk alokasi ini sudah ditutup. Lakukan prosedur jurnal koreksi/reopening pada App 3 terlebih dahulu.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_sd FROM public.sales_documents WHERE id = v_pa.sales_document_id FOR UPDATE;

  UPDATE public.payment_allocations
  SET status = 'reversed', version = version + 1, notes = p_reason
  WHERE id = v_pa.id;

  INSERT INTO public.allocation_approvals (company_id, payment_allocation_id, decision, actor_id, reason)
  VALUES (v_pa.company_id, v_pa.id, 'reversed', v_actor_id, p_reason);

  SELECT COALESCE(SUM(allocated_amount), 0) INTO v_sd_paid
  FROM public.payment_allocations WHERE sales_document_id = v_sd.id AND status = 'approved';

  SELECT COALESCE(SUM(cn.total_amount), 0) INTO v_sd_cn
  FROM public.document_links dl JOIN public.sales_documents cn ON cn.id = dl.source_id
  WHERE dl.target_id = v_sd.id AND dl.link_type = 'credit_note_for' AND cn.status IN ('approved', 'released');

  v_new_pay_status := CASE
    WHEN v_sd_paid <= 0 THEN 'unpaid'
    WHEN v_sd_paid < GREATEST(0, v_sd.total_amount - v_sd_cn) THEN 'partially_paid'
    ELSE 'paid'
  END;

  UPDATE public.sales_documents
  SET payment_status = v_new_pay_status, version = version + 1, updated_at = now()
  WHERE id = v_sd.id;

  PERFORM private.emit_accounting_event(
    v_pa.company_id, v_pa.branch_id, 'payment_allocation_reversed', 'payment_allocation', v_pa.id, v_pa.version + 1,
    CURRENT_DATE,
    jsonb_build_object('receipt_id', v_pa.receipt_id, 'sales_document_id', v_pa.sales_document_id, 'reversed_amount', v_pa.allocated_amount, 'reason', p_reason),
    ARRAY[]::UUID[], v_actor_id, v_sd.correlation_id
  );

  PERFORM private.write_audit_event(
    v_pa.company_id, v_pa.branch_id, v_actor_id, 'allocation.reverse', 'payment_allocation', v_pa.id,
    jsonb_build_object('status', 'approved'), jsonb_build_object('status', 'reversed', 'invoice_payment_status', v_new_pay_status), p_reason
  );

  v_result := jsonb_build_object('allocation_id', v_pa.id, 'status', 'reversed', 'version', v_pa.version + 1);
  PERFORM private.save_idempotency(v_pa.company_id, v_actor_id, 'reverse_payment_allocation', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. RPC: save_reconciliation_review
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_reconciliation_review(
  p_idempotency_key TEXT,
  p_company_id UUID,
  p_branch_id UUID,
  p_sales_document_id UUID,
  p_reconciliation_status TEXT, -- 'unreviewed' | 'matched' | 'needs_review' | 'discrepancy' | 'reviewed'
  p_review_stage TEXT,          -- 'waiting_finance_verification' | 'ready_to_match' | 'allocation_pending_review' | 'matched' | 'discrepancy' | 'completed'
  p_reason_code TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_structured_notes JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_sd public.sales_documents%ROWTYPE;
  v_label TEXT;
  v_rev_status TEXT;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'save_reconciliation_review', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF NOT private.has_branch_role(p_company_id, p_branch_id, ARRAY['reconciliation_reviewer','finance_checker','accounting_approver']) THEN
    RAISE EXCEPTION 'Hanya reviewer rekonsiliasi berwenang yang dapat memperbarui status review.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_sd FROM public.sales_documents WHERE id = p_sales_document_id AND company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nota tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  SELECT COALESCE(reconciliation_label, 'REKONSILIASI (ALMIRA)') INTO v_label
  FROM public.app_settings WHERE company_id = p_company_id;

  -- Penting: Status 'matched' atau 'reviewed' TIDAK boleh memaksa saldo piutang menjadi nol (penjualan kredit sah tetap terbuka)
  UPDATE public.sales_documents
  SET reconciliation_status = p_reconciliation_status,
      reconciled_by = v_actor_id,
      reconciled_at = now(),
      reconciliation_note = p_notes,
      reconciler_label = COALESCE(v_label, 'REKONSILIASI (ALMIRA)'),
      version = version + 1,
      updated_at = now()
  WHERE id = v_sd.id;

  v_rev_status := CASE
    WHEN p_review_stage IN ('matched', 'completed') THEN 'resolved'
    WHEN p_review_stage = 'discrepancy' THEN 'in_review'
    ELSE 'open'
  END;

  INSERT INTO public.reconciliation_reviews (
    company_id, branch_id, target_type, target_id, status, review_stage,
    reviewer_label, reason_code, notes, structured_notes, created_by, resolved_by, resolved_at, updated_by
  ) VALUES (
    p_company_id, p_branch_id, 'sales_document', v_sd.id, v_rev_status, p_review_stage,
    COALESCE(v_label, 'REKONSILIASI (ALMIRA)'), p_reason_code, p_notes, COALESCE(p_structured_notes, '{}'::jsonb),
    v_actor_id, CASE WHEN v_rev_status = 'resolved' THEN v_actor_id ELSE NULL END,
    CASE WHEN v_rev_status = 'resolved' THEN now() ELSE NULL END, v_actor_id
  )
  ON CONFLICT (company_id, target_type, target_id)
  DO UPDATE SET
    status = EXCLUDED.status,
    review_stage = EXCLUDED.review_stage,
    reason_code = EXCLUDED.reason_code,
    notes = EXCLUDED.notes,
    structured_notes = EXCLUDED.structured_notes,
    resolved_by = EXCLUDED.resolved_by,
    resolved_at = EXCLUDED.resolved_at,
    updated_by = v_actor_id,
    version = public.reconciliation_reviews.version + 1,
    updated_at = now();

  PERFORM private.write_audit_event(
    p_company_id, p_branch_id, v_actor_id, 'reconciliation.save_review', 'sales_document', v_sd.id,
    jsonb_build_object('reconciliation_status', v_sd.reconciliation_status),
    jsonb_build_object('reconciliation_status', p_reconciliation_status, 'review_stage', p_review_stage, 'reason_code', p_reason_code),
    COALESCE(p_notes, 'Keputusan rekonsiliasi disimpan')
  );

  v_result := jsonb_build_object(
    'sales_document_id', v_sd.id,
    'reconciliation_status', p_reconciliation_status,
    'review_stage', p_review_stage,
    'version', v_sd.version + 1
  );
  PERFORM private.save_idempotency(p_company_id, v_actor_id, 'save_reconciliation_review', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 8. RPC: issue_sales_credit_note (Nota Kredit tanpa mengedit nota asal in-place)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_sales_credit_note(
  p_idempotency_key TEXT,
  p_original_sales_document_id UUID,
  p_issue_date DATE,
  p_reason TEXT,
  p_lines JSONB -- [{product_id, unit_code, quantity, net_unit_price}]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_orig public.sales_documents%ROWTYPE;
  v_cn_id UUID;
  v_cn_no TEXT;
  v_line JSONB;
  v_line_no INTEGER := 0;
  v_prod public.products%ROWTYPE;
  v_qty NUMERIC(20,6);
  v_price NUMERIC(20,6);
  v_line_total NUMERIC(20,2);
  v_cn_total NUMERIC(20,2) := 0;
  v_paid NUMERIC(20,2);
  v_other_cn NUMERIC(20,2);
  v_new_pay_status TEXT;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'issue_sales_credit_note', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Alasan penerbitan nota kredit wajib diisi.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_orig FROM public.sales_documents WHERE id = p_original_sales_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nota asal tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT private.has_branch_role(v_orig.company_id, v_orig.branch_id, ARRAY['reconciliation_reviewer','accounting_approver']) THEN
    RAISE EXCEPTION 'Izin ditolak menerbitkan nota kredit.' USING ERRCODE = '42501';
  END IF;

  IF v_orig.status NOT IN ('approved', 'released') THEN
    RAISE EXCEPTION 'Nota kredit hanya untuk dokumen yang sudah disetujui/dirilis.' USING ERRCODE = '22023';
  END IF;

  v_cn_no := private.next_document_number(v_orig.company_id, 'credit_note', 'CN-SLS', p_issue_date);

  INSERT INTO public.sales_documents (
    company_id, branch_id, doc_number, source_invoice_no, doc_type,
    customer_id, sales_staff_id, invoice_date, delivery_date, due_date,
    tax_basis, status, accounting_status, amended_from_id, reason, notes,
    created_by, updated_by, approved_by, released_by, released_at
  ) VALUES (
    v_orig.company_id, v_orig.branch_id, v_cn_no, v_orig.doc_number, 'credit_note',
    v_orig.customer_id, v_orig.sales_staff_id, p_issue_date, p_issue_date, p_issue_date,
    v_orig.tax_basis, 'released', 'queued', v_orig.id, p_reason, p_reason,
    v_actor_id, v_actor_id, v_actor_id, v_actor_id, now()
  )
  RETURNING id INTO v_cn_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_no := v_line_no + 1;
    SELECT * INTO v_prod FROM public.products WHERE id = (v_line->>'product_id')::UUID;
    v_qty := (v_line->>'quantity')::NUMERIC(20,6);
    v_price := (v_line->>'net_unit_price')::NUMERIC(20,6);
    v_line_total := private.round_half_up(v_qty * v_price, 0);

    INSERT INTO public.sales_lines (
      company_id, sales_document_id, line_no, product_id,
      product_sku_snapshot, product_name_snapshot,
      unit_code, quantity, net_unit_price, line_total_raw, line_total, rounding_diff
    ) VALUES (
      v_orig.company_id, v_cn_id, v_line_no, v_prod.id,
      v_prod.sku, v_prod.name, COALESCE(v_line->>'unit_code', v_prod.base_unit),
      v_qty, v_price, v_qty * v_price, v_line_total, v_line_total - (v_qty * v_price)
    );
    v_cn_total := v_cn_total + v_line_total;
  END LOOP;

  UPDATE public.sales_documents
  SET subtotal_amount = v_cn_total, total_amount = v_cn_total
  WHERE id = v_cn_id;

  INSERT INTO public.document_links (company_id, source_type, source_id, target_type, target_id, link_type, created_by)
  VALUES (v_orig.company_id, 'sales_document', v_cn_id, 'sales_document', v_orig.id, 'credit_note_for', v_actor_id);

  -- Hitung ulang status pembayaran nota asal setelah dikurangi nota kredit
  SELECT COALESCE(SUM(allocated_amount), 0) INTO v_paid
  FROM public.payment_allocations WHERE sales_document_id = v_orig.id AND status = 'approved';

  SELECT COALESCE(SUM(cn.total_amount), 0) INTO v_other_cn
  FROM public.document_links dl JOIN public.sales_documents cn ON cn.id = dl.source_id
  WHERE dl.target_id = v_orig.id AND dl.link_type = 'credit_note_for' AND cn.status IN ('approved', 'released');

  v_new_pay_status := CASE
    WHEN v_paid <= 0 THEN 'unpaid'
    WHEN v_paid < GREATEST(0, v_orig.total_amount - v_other_cn) THEN 'partially_paid'
    WHEN v_paid = GREATEST(0, v_orig.total_amount - v_other_cn) THEN 'paid'
    ELSE 'overpaid'
  END;

  UPDATE public.sales_documents
  SET payment_status = v_new_pay_status, version = version + 1, updated_at = now()
  WHERE id = v_orig.id;

  PERFORM private.emit_accounting_event(
    v_orig.company_id, v_orig.branch_id, 'sales_credit_note_issued', 'sales_document', v_cn_id, 1,
    p_issue_date,
    jsonb_build_object(
      'credit_note_number', v_cn_no,
      'original_sales_document_id', v_orig.id,
      'original_doc_number', v_orig.doc_number,
      'customer_id', v_orig.customer_id,
      'credit_amount', v_cn_total,
      'reason', p_reason
    ),
    ARRAY[]::UUID[], v_actor_id, v_orig.correlation_id
  );

  PERFORM private.write_audit_event(
    v_orig.company_id, v_orig.branch_id, v_actor_id, 'sales.issue_credit_note', 'sales_document', v_cn_id,
    NULL, jsonb_build_object('credit_note_number', v_cn_no, 'original_doc', v_orig.doc_number, 'amount', v_cn_total),
    p_reason
  );

  v_result := jsonb_build_object(
    'credit_note_id', v_cn_id,
    'credit_note_number', v_cn_no,
    'credit_amount', v_cn_total,
    'original_payment_status', v_new_pay_status
  );
  PERFORM private.save_idempotency(v_orig.company_id, v_actor_id, 'issue_sales_credit_note', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 9. RPC: preview_sales_import & commit_sales_import
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preview_sales_import(
  p_idempotency_key TEXT,
  p_company_id UUID,
  p_branch_id UUID,
  p_file_name TEXT,
  p_file_hash TEXT,
  p_sheet_name TEXT,
  p_mapping_version TEXT,
  p_date_format TEXT,
  p_decimal_format TEXT,
  p_tax_basis TEXT,
  p_grouping_mode TEXT, -- 'row_per_doc' | 'by_source_invoice'
  p_cutover_mode TEXT,  -- 'active' | 'legacy_archive' | 'opening_subledger'
  p_rows JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_batch_id UUID;
  v_row JSONB;
  v_cust_id_raw TEXT;
  v_cust_name_raw TEXT;
  v_sku_raw TEXT;
  v_prod_name_raw TEXT;
  v_cust_uuid UUID;
  v_prod_uuid UUID;
  v_staff_uuid UUID;
  v_fp TEXT;
  v_dup_file BOOLEAN;
  v_val_status TEXT;
  v_res_status TEXT;
  v_msg TEXT;
  v_total INTEGER := 0;
  v_ok INTEGER := 0;
  v_err INTEGER := 0;
  v_rev INTEGER := 0;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'preview_sales_import', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF NOT private.has_branch_role(p_company_id, p_branch_id, ARRAY['sales_admin','reconciliation_reviewer','system_admin']) THEN
    RAISE EXCEPTION 'Izin ditolak mengimpor penjualan.' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.import_batches
    WHERE company_id = p_company_id AND import_type = 'sales_recap' AND file_hash = p_file_hash AND status = 'committed'
  ) INTO v_dup_file;

  INSERT INTO public.import_batches (
    company_id, branch_id, import_type, file_name, file_hash, status, created_by,
    sheet_name, mapping_version, date_format, decimal_format, tax_basis, grouping_mode, cutover_mode,
    metadata
  ) VALUES (
    p_company_id, p_branch_id, 'sales_recap', p_file_name, p_file_hash, 'staging', v_actor_id,
    p_sheet_name, COALESCE(p_mapping_version, 'v1'), p_date_format, p_decimal_format, p_tax_basis, p_grouping_mode, p_cutover_mode,
    jsonb_build_object('reimport_same_hash', v_dup_file)
  )
  RETURNING id INTO v_batch_id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_total := v_total + 1;
    v_cust_id_raw := trim(COALESCE(v_row->>'cust_id', ''));
    v_cust_name_raw := trim(COALESCE(v_row->>'cust_name', ''));
    v_sku_raw := trim(COALESCE(v_row->>'product_sku', ''));
    v_prod_name_raw := trim(COALESCE(v_row->>'product_name', ''));
    v_val_status := COALESCE(v_row->>'client_validation_status', 'valid');
    v_msg := COALESCE(v_row->>'client_validation_message', '');

    -- Exact CUST ID match terlebih dahulu (leading zero dipertahankan!)
    SELECT id INTO v_cust_uuid FROM public.customers WHERE company_id = p_company_id AND cust_id = v_cust_id_raw LIMIT 1;
    IF v_cust_uuid IS NULL THEN
      SELECT id INTO v_prod_uuid FROM public.products WHERE company_id = p_company_id AND sku = v_sku_raw LIMIT 1;
      v_val_status := 'warning';
      v_res_status := 'needs_review';
      v_msg := trim(v_msg || ' | CUST ID "' || v_cust_id_raw || '" belum terdaftar di master pelanggan.');
    END IF;

    SELECT id INTO v_prod_uuid FROM public.products
    WHERE company_id = p_company_id AND (sku = v_sku_raw OR lower(name) = lower(v_prod_name_raw)) LIMIT 1;
    IF v_prod_uuid IS NULL THEN
      v_val_status := 'warning';
      v_res_status := 'needs_review';
      v_msg := trim(v_msg || ' | Produk/SKU "' || COALESCE(NULLIF(v_sku_raw, ''), v_prod_name_raw) || '" belum terdaftar di master produk.');
    END IF;

    SELECT id INTO v_staff_uuid FROM public.staff
    WHERE company_id = p_company_id AND lower(full_name) = lower(trim(COALESCE(v_row->>'sales_name', ''))) LIMIT 1;

    v_fp := encode(digest(
      p_company_id::TEXT || '|' || COALESCE(v_row->>'delivery_date_iso', '') || '|' || v_cust_id_raw || '|' ||
      COALESCE(NULLIF(v_sku_raw, ''), v_prod_name_raw) || '|' || COALESCE(v_row->>'quantity', '') || '|' || COALESCE(v_row->>'total_sales', ''),
      'sha256'
    ), 'hex');

    IF v_val_status = 'error' THEN
      v_res_status := 'rejected';
      v_err := v_err + 1;
    ELSIF v_val_status = 'warning' OR v_cust_uuid IS NULL OR v_prod_uuid IS NULL THEN
      v_res_status := 'needs_review';
      v_rev := v_rev + 1;
    ELSE
      v_res_status := 'pending';
      v_ok := v_ok + 1;
    END IF;

    INSERT INTO public.import_rows (
      company_id, batch_id, row_no, raw_data, validation_status, validation_message,
      fingerprint, source_doc_id, source_line_id,
      delivery_date, resolved_customer_id, resolved_product_id, resolved_sales_staff_id,
      parsed_data, legacy_source_data, resolution_status
    ) VALUES (
      p_company_id, v_batch_id, COALESCE((v_row->>'row_no')::INTEGER, v_total),
      COALESCE(v_row->'raw_data', v_row), v_val_status, NULLIF(v_msg, ''),
      v_fp, NULLIF(v_row->>'source_doc_id', ''), NULLIF(v_row->>'source_line_id', ''),
      NULLIF(v_row->>'delivery_date_iso', '')::DATE, v_cust_uuid, v_prod_uuid, v_staff_uuid,
      COALESCE(v_row->'parsed_data', v_row), COALESCE(v_row->'legacy_source_data', '{}'::jsonb), v_res_status
    );
  END LOOP;

  UPDATE public.import_batches
  SET total_rows = v_total, accepted_rows = v_ok, rejected_rows = v_err, review_rows = v_rev
  WHERE id = v_batch_id;

  v_result := jsonb_build_object(
    'batch_id', v_batch_id,
    'reimport_same_hash', v_dup_file,
    'total_rows', v_total,
    'ready_rows', v_ok,
    'review_rows', v_rev,
    'rejected_rows', v_err
  );
  PERFORM private.save_idempotency(p_company_id, v_actor_id, 'preview_sales_import', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_sales_import(
  p_idempotency_key TEXT,
  p_batch_id UUID,
  p_expected_version INTEGER,
  p_allow_duplicate_rows BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_b public.import_batches%ROWTYPE;
  v_grp RECORD;
  v_r RECORD;
  v_doc_id UUID;
  v_doc_no TEXT;
  v_line_no INTEGER;
  v_subtotal NUMERIC(20,2);
  v_docs_created INTEGER := 0;
  v_rows_committed INTEGER := 0;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'commit_sales_import', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_b FROM public.import_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch impor tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;
  IF NOT private.has_branch_role(v_b.company_id, COALESCE(v_b.branch_id, (SELECT id FROM public.branches WHERE company_id = v_b.company_id LIMIT 1)), ARRAY['sales_admin','reconciliation_reviewer','system_admin']) THEN
    RAISE EXCEPTION 'Izin ditolak.' USING ERRCODE = '42501';
  END IF;

  IF v_b.version <> p_expected_version THEN RAISE EXCEPTION 'Konflik versi batch.' USING ERRCODE = '40001'; END IF;

  -- Idempoten untuk file_hash yang sama yang sudah committed
  IF v_b.status = 'committed' THEN
    RETURN jsonb_build_object('batch_id', v_b.id, 'status', 'committed', 'idempotent_reimport', true, 'docs_created', 0);
  END IF;

  IF COALESCE((v_b.metadata->>'reimport_same_hash')::BOOLEAN, false) = true AND NOT p_allow_duplicate_rows THEN
    UPDATE public.import_batches SET status = 'committed', committed_by = v_actor_id, committed_at = now(), version = version + 1 WHERE id = v_b.id;
    v_result := jsonb_build_object('batch_id', v_b.id, 'status', 'committed', 'idempotent_reimport', true, 'docs_created', 0);
    PERFORM private.save_idempotency(v_b.company_id, v_actor_id, 'commit_sales_import', p_idempotency_key, v_result);
    RETURN v_result;
  END IF;

  -- Grouping atomik: dokumen tanpa source_doc_id memakai group per row_no
  FOR v_grp IN
    SELECT
      CASE WHEN v_b.grouping_mode = 'by_source_invoice' AND ir.source_doc_id IS NOT NULL THEN ir.source_doc_id ELSE 'ROW-' || ir.row_no::TEXT END AS doc_group_key,
      MIN(ir.resolved_customer_id::TEXT)::UUID AS customer_id,
      MIN(ir.resolved_sales_staff_id::TEXT)::UUID AS sales_staff_id,
      MIN(ir.delivery_date) AS min_delivery_date,
      MAX(ir.delivery_date) AS max_delivery_date,
      MAX(ir.source_doc_id) AS source_invoice_no,
      BOOL_OR(ir.resolved_customer_id IS NULL OR ir.resolved_product_id IS NULL OR ir.validation_status = 'error') AS has_unresolved
    FROM public.import_rows ir
    WHERE ir.batch_id = v_b.id AND ir.resolution_status IN ('pending', 'duplicate_kept')
    GROUP BY 1
    ORDER BY MIN(ir.row_no)
  LOOP
    CONTINUE WHEN v_grp.has_unresolved;
    -- Jika tanggal kirim konflik dalam satu referensi invoice, tahan di staging (jangan gabung otomatis!)
    IF v_grp.min_delivery_date IS DISTINCT FROM v_grp.max_delivery_date THEN
      UPDATE public.import_rows
      SET resolution_status = 'needs_review',
          validation_status = 'warning',
          validation_message = COALESCE(validation_message, '') || ' | Konflik tanggal kirim dalam satu nomor referensi.'
      WHERE batch_id = v_b.id AND source_doc_id = v_grp.source_invoice_no;
      CONTINUE;
    END IF;

    v_doc_no := private.next_document_number(v_b.company_id, 'sales_invoice', 'SLS', COALESCE(v_grp.min_delivery_date, CURRENT_DATE));
    INSERT INTO public.sales_documents (
      company_id, branch_id, doc_number, source_invoice_no, doc_type,
      customer_id, sales_staff_id, invoice_date, delivery_date, due_date,
      tax_basis, status, is_legacy_archive, import_batch_id, created_by, updated_by
    ) VALUES (
      v_b.company_id, v_b.branch_id, v_doc_no, v_grp.source_invoice_no, 'sales_invoice',
      v_grp.customer_id, v_grp.sales_staff_id, COALESCE(v_grp.min_delivery_date, CURRENT_DATE), v_grp.min_delivery_date,
      COALESCE(v_grp.min_delivery_date, CURRENT_DATE) + 30,
      COALESCE(v_b.tax_basis, 'non_tax'),
      CASE WHEN v_b.cutover_mode = 'legacy_archive' THEN 'released' ELSE 'draft' END,
      (v_b.cutover_mode = 'legacy_archive'),
      v_b.id, v_actor_id, v_actor_id
    )
    RETURNING id INTO v_doc_id;

    v_line_no := 0;
    v_subtotal := 0;
    FOR v_r IN
      SELECT * FROM public.import_rows
      WHERE batch_id = v_b.id
        AND (CASE WHEN v_b.grouping_mode = 'by_source_invoice' AND source_doc_id IS NOT NULL THEN source_doc_id ELSE 'ROW-' || row_no::TEXT END) = v_grp.doc_group_key
      ORDER BY row_no
    LOOP
      v_line_no := v_line_no + 1;
      INSERT INTO public.sales_lines (
        company_id, sales_document_id, line_no, product_id,
        product_sku_snapshot, product_name_snapshot, unit_code,
        quantity, net_unit_price, line_total_raw, line_total,
        raw_source_total, has_price_discrepancy, notes, source_line_id, legacy_source_data
      ) VALUES (
        v_b.company_id, v_doc_id, v_line_no, v_r.resolved_product_id,
        v_r.parsed_data->>'product_sku', v_r.parsed_data->>'product_name',
        COALESCE(NULLIF(v_r.parsed_data->>'unit_code', ''), 'PCS'),
        (v_r.parsed_data->>'quantity')::NUMERIC(20,6),
        (v_r.parsed_data->>'net_unit_price')::NUMERIC(20,6),
        (v_r.parsed_data->>'quantity')::NUMERIC(20,6) * (v_r.parsed_data->>'net_unit_price')::NUMERIC(20,6),
        COALESCE((v_r.parsed_data->>'raw_total_sales')::NUMERIC(20,2), private.round_half_up((v_r.parsed_data->>'quantity')::NUMERIC(20,6) * (v_r.parsed_data->>'net_unit_price')::NUMERIC(20,6), 0)),
        (v_r.parsed_data->>'raw_total_sales')::NUMERIC(20,2),
        COALESCE((v_r.parsed_data->>'has_price_discrepancy')::BOOLEAN, false),
        v_r.parsed_data->>'notes', v_r.source_line_id, v_r.legacy_source_data
      );
      v_subtotal := v_subtotal + COALESCE((v_r.parsed_data->>'raw_total_sales')::NUMERIC(20,2), private.round_half_up((v_r.parsed_data->>'quantity')::NUMERIC(20,6) * (v_r.parsed_data->>'net_unit_price')::NUMERIC(20,6), 0));
      UPDATE public.import_rows SET resolution_status = 'accepted', created_sales_document_id = v_doc_id WHERE id = v_r.id;
      v_rows_committed := v_rows_committed + 1;
    END LOOP;

    UPDATE public.sales_documents
    SET subtotal_amount = v_subtotal, total_amount = v_subtotal,
        legacy_source_data = (SELECT COALESCE(jsonb_agg(legacy_source_data), '[]'::jsonb) FROM public.import_rows WHERE created_sales_document_id = v_doc_id)
    WHERE id = v_doc_id;
    v_docs_created := v_docs_created + 1;
  END LOOP;

  UPDATE public.import_batches
  SET status = 'committed', committed_by = v_actor_id, committed_at = now(), version = version + 1
  WHERE id = v_b.id;

  v_result := jsonb_build_object('batch_id', v_b.id, 'status', 'committed', 'docs_created', v_docs_created, 'rows_committed', v_rows_committed);
  PERFORM private.save_idempotency(v_b.company_id, v_actor_id, 'commit_sales_import', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 10. RPC: get_sales_recap (Cut-off Date & Anti-Double-Join Read RPC)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sales_recap(
  p_company_id UUID,
  p_branch_id UUID DEFAULT NULL,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL,
  p_cutoff_date DATE DEFAULT NULL,
  p_include_archive BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cutoff DATE := COALESCE(p_cutoff_date, CURRENT_DATE);
  v_rows JSONB;
  v_summary JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  IF NOT private.is_company_member(p_company_id) THEN RAISE EXCEPTION 'Akses ditolak.' USING ERRCODE = '42501'; END IF;

  WITH doc_bal AS (
    SELECT
      sd.id AS sales_document_id,
      sd.total_amount,
      COALESCE((
        SELECT SUM(pa.allocated_amount)
        FROM public.payment_allocations pa
        JOIN public.receipts r ON r.id = pa.receipt_id
        WHERE pa.sales_document_id = sd.id
          AND pa.status = 'approved'
          AND COALESCE(r.bank_value_date, r.customer_paid_at) <= v_cutoff
      ), 0)::NUMERIC(20,2) AS paid_as_of_cutoff,
      COALESCE((
        SELECT SUM(cn.total_amount)
        FROM public.document_links dl JOIN public.sales_documents cn ON cn.id = dl.source_id
        WHERE dl.target_id = sd.id AND dl.link_type = 'credit_note_for'
          AND cn.status IN ('approved', 'released')
          AND cn.invoice_date <= v_cutoff
      ), 0)::NUMERIC(20,2) AS cn_as_of_cutoff
    FROM public.sales_documents sd
    WHERE sd.company_id = p_company_id
      AND (p_branch_id IS NULL OR sd.branch_id = p_branch_id)
      AND private.has_branch_access(p_company_id, sd.branch_id)
      AND sd.doc_type = 'sales_invoice'
      AND (p_include_archive OR sd.is_legacy_archive = false)
      AND (p_date_from IS NULL OR sd.delivery_date >= p_date_from)
      AND (p_date_to IS NULL OR sd.delivery_date <= p_date_to)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'sales_line_id', sl.id,
    'sales_document_id', sd.id,
    'doc_number', sd.doc_number,
    'source_invoice_no', sd.source_invoice_no,
    'delivery_date', sd.delivery_date,
    'iso_week', CASE WHEN sd.delivery_date IS NOT NULL THEN to_char(sd.delivery_date, 'IYYY-"W"IW') ELSE NULL END,
    'iso_month', CASE WHEN sd.delivery_date IS NOT NULL THEN to_char(sd.delivery_date, 'YYYY-MM') ELSE NULL END,
    'cust_id', c.cust_id,
    'cust_name', c.name,
    'product_sku', COALESCE(sl.product_sku_snapshot, p.sku),
    'product_name', COALESCE(sl.product_name_snapshot, p.name),
    'unit_code', sl.unit_code,
    'quantity', sl.quantity,
    'net_unit_price', sl.net_unit_price,
    'line_total', sl.line_total,
    'sales_name', COALESCE(st.full_name, '-'),
    'document_status', sd.status,
    'document_total_amount', sd.total_amount,
    'paid_amount', db.paid_as_of_cutoff,
    'outstanding_amount', GREATEST(0, (sd.total_amount - db.cn_as_of_cutoff) - db.paid_as_of_cutoff),
    'status_pembayaran', CASE
      WHEN sd.is_legacy_archive THEN 'unpaid'
      WHEN db.paid_as_of_cutoff <= 0 THEN 'unpaid'
      WHEN db.paid_as_of_cutoff < GREATEST(0, sd.total_amount - db.cn_as_of_cutoff) THEN 'partially_paid'
      ELSE 'paid'
    END,
    'reconciliation_status', sd.reconciliation_status,
    'reconciler_label', sd.reconciler_label,
    'is_legacy_archive', sd.is_legacy_archive,
    'keterangan', COALESCE(sl.notes, sd.notes, '')
  ) ORDER BY sd.delivery_date DESC NULLS LAST, sd.doc_number DESC, sl.line_no ASC), '[]'::jsonb)
  INTO v_rows
  FROM public.sales_lines sl
  JOIN public.sales_documents sd ON sd.id = sl.sales_document_id
  JOIN doc_bal db ON db.sales_document_id = sd.id
  JOIN public.customers c ON c.id = sd.customer_id
  JOIN public.products p ON p.id = sl.product_id
  LEFT JOIN public.staff st ON st.id = sd.sales_staff_id;

  SELECT jsonb_build_object(
    'cutoff_date', v_cutoff,
    'document_count', COUNT(DISTINCT db.sales_document_id),
    'total_billed', COALESCE(SUM(GREATEST(0, db.total_amount - db.cn_as_of_cutoff)), 0),
    'total_paid', COALESCE(SUM(db.paid_as_of_cutoff), 0),
    'total_outstanding', COALESCE(SUM(GREATEST(0, (db.total_amount - db.cn_as_of_cutoff) - db.paid_as_of_cutoff)), 0)
  ) INTO v_summary
  FROM (
    SELECT
      sd.id AS sales_document_id,
      sd.total_amount,
      COALESCE((
        SELECT SUM(pa.allocated_amount) FROM public.payment_allocations pa
        JOIN public.receipts r ON r.id = pa.receipt_id
        WHERE pa.sales_document_id = sd.id AND pa.status = 'approved'
          AND COALESCE(r.bank_value_date, r.customer_paid_at) <= v_cutoff
      ), 0) AS paid_as_of_cutoff,
      COALESCE((
        SELECT SUM(cn.total_amount) FROM public.document_links dl
        JOIN public.sales_documents cn ON cn.id = dl.source_id
        WHERE dl.target_id = sd.id AND dl.link_type = 'credit_note_for'
          AND cn.status IN ('approved', 'released') AND cn.invoice_date <= v_cutoff
      ), 0) AS cn_as_of_cutoff
    FROM public.sales_documents sd
    WHERE sd.company_id = p_company_id
      AND (p_branch_id IS NULL OR sd.branch_id = p_branch_id)
      AND private.has_branch_access(p_company_id, sd.branch_id)
      AND sd.doc_type = 'sales_invoice'
      AND (p_include_archive OR sd.is_legacy_archive = false)
      AND (p_date_from IS NULL OR sd.delivery_date >= p_date_from)
      AND (p_date_to IS NULL OR sd.delivery_date <= p_date_to)
  ) db;

  RETURN jsonb_build_object('rows', v_rows, 'summary', v_summary);
END;
$$;

-- ------------------------------------------------------------------------------
-- 11. RPC: get_customer_receivable (Aging Piutang & Saldo Titipan Terpisah per Cut-Off)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_customer_receivable(
  p_company_id UUID,
  p_branch_id UUID DEFAULT NULL,
  p_customer_id UUID DEFAULT NULL,
  p_as_of_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_as_of DATE := COALESCE(p_as_of_date, CURRENT_DATE);
  v_customers JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  IF NOT private.is_company_member(p_company_id) THEN RAISE EXCEPTION 'Akses ditolak.' USING ERRCODE = '42501'; END IF;

  WITH inv AS (
    SELECT
      sd.id AS sales_document_id,
      sd.customer_id,
      sd.doc_number,
      sd.delivery_date,
      sd.due_date,
      sd.total_amount,
      COALESCE((
        SELECT SUM(cn.total_amount) FROM public.document_links dl
        JOIN public.sales_documents cn ON cn.id = dl.source_id
        WHERE dl.target_id = sd.id AND dl.link_type = 'credit_note_for'
          AND cn.status IN ('approved', 'released') AND cn.invoice_date <= v_as_of
      ), 0) AS cn_amount,
      COALESCE((
        SELECT SUM(pa.allocated_amount) FROM public.payment_allocations pa
        JOIN public.receipts r ON r.id = pa.receipt_id
        WHERE pa.sales_document_id = sd.id AND pa.status = 'approved'
          AND COALESCE(r.bank_value_date, r.customer_paid_at) <= v_as_of
      ), 0) AS paid_amount
    FROM public.sales_documents sd
    WHERE sd.company_id = p_company_id
      AND (p_branch_id IS NULL OR sd.branch_id = p_branch_id)
      AND private.has_branch_access(p_company_id, sd.branch_id)
      AND (p_customer_id IS NULL OR sd.customer_id = p_customer_id)
      AND sd.doc_type = 'sales_invoice'
      AND sd.status IN ('approved', 'released')
      AND sd.is_legacy_archive = false
      AND COALESCE(sd.delivery_date, sd.invoice_date) <= v_as_of
  ),
  inv_bal AS (
    SELECT
      *,
      GREATEST(0, (total_amount - cn_amount) - paid_amount) AS outstanding,
      GREATEST(0, v_as_of - COALESCE(due_date, delivery_date)) AS days_overdue
    FROM inv
  ),
  cust_titipan AS (
    SELECT
      r.customer_id,
      COALESCE(SUM(
        r.verified_amount
        - COALESCE((SELECT SUM(pa.allocated_amount) FROM public.payment_allocations pa WHERE pa.receipt_id = r.id AND pa.status = 'approved'), 0)
        - COALESCE((SELECT SUM(rl.amount) FROM public.refund_lines rl JOIN public.customer_refunds cr ON cr.id = rl.customer_refund_id WHERE rl.receipt_id = r.id AND cr.status IN ('approved', 'paid')), 0)
      ), 0)::NUMERIC(20,2) AS titipan_balance
    FROM public.receipts r
    WHERE r.company_id = p_company_id
      AND (p_branch_id IS NULL OR r.branch_id = p_branch_id)
      AND r.status = 'verified'
      AND r.is_unknown_identity = false
      AND r.customer_id IS NOT NULL
      AND COALESCE(r.bank_value_date, r.customer_paid_at) <= v_as_of
    GROUP BY r.customer_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'customer_uuid', c.id,
    'cust_id', c.cust_id,
    'cust_name', c.name,
    'total_billed', COALESCE(agg.total_billed, 0),
    'total_paid', COALESCE(agg.total_paid, 0),
    'total_outstanding', COALESCE(agg.total_outstanding, 0),
    'aging_0_30', COALESCE(agg.aging_0_30, 0),
    'aging_31_60', COALESCE(agg.aging_31_60, 0),
    'aging_61_90', COALESCE(agg.aging_61_90, 0),
    'aging_over_90', COALESCE(agg.aging_over_90, 0),
    'titipan_balance', COALESCE(ct.titipan_balance, 0)
  ) ORDER BY COALESCE(agg.total_outstanding, 0) DESC, c.cust_id ASC), '[]'::jsonb)
  INTO v_customers
  FROM public.customers c
  LEFT JOIN (
    SELECT
      customer_id,
      SUM(GREATEST(0, total_amount - cn_amount)) AS total_billed,
      SUM(paid_amount) AS total_paid,
      SUM(outstanding) AS total_outstanding,
      SUM(CASE WHEN days_overdue <= 30 THEN outstanding ELSE 0 END) AS aging_0_30,
      SUM(CASE WHEN days_overdue BETWEEN 31 AND 60 THEN outstanding ELSE 0 END) AS aging_31_60,
      SUM(CASE WHEN days_overdue BETWEEN 61 AND 90 THEN outstanding ELSE 0 END) AS aging_61_90,
      SUM(CASE WHEN days_overdue > 90 THEN outstanding ELSE 0 END) AS aging_over_90
    FROM inv_bal
    GROUP BY customer_id
  ) agg ON agg.customer_id = c.id
  LEFT JOIN cust_titipan ct ON ct.customer_id = c.id
  WHERE c.company_id = p_company_id
    AND (p_branch_id IS NULL OR c.branch_id = p_branch_id)
    AND private.has_branch_access(p_company_id, c.branch_id)
    AND (p_customer_id IS NULL OR c.id = p_customer_id);

  RETURN jsonb_build_object('as_of_date', v_as_of, 'customers', v_customers);
END;
$$;

-- ------------------------------------------------------------------------------
-- 12. RPC PENDUKUNG: append_sales_note & Master CRUD Terotorisasi
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.append_sales_note(
  p_idempotency_key TEXT,
  p_sales_document_id UUID,
  p_note_text TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_sd public.sales_documents%ROWTYPE;
  v_note_id UUID;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'append_sales_note', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_sd FROM public.sales_documents WHERE id = p_sales_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nota tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT private.has_branch_role(v_sd.company_id, v_sd.branch_id, ARRAY['sales_admin','reconciliation_reviewer','finance_checker','accountant']) THEN
    RAISE EXCEPTION 'Izin ditolak.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.sales_document_notes (company_id, branch_id, sales_document_id, note_text, created_by)
  VALUES (v_sd.company_id, v_sd.branch_id, v_sd.id, trim(p_note_text), v_actor_id)
  RETURNING id INTO v_note_id;

  v_result := jsonb_build_object('note_id', v_note_id, 'sales_document_id', v_sd.id);
  PERFORM private.save_idempotency(v_sd.company_id, v_actor_id, 'append_sales_note', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_customer_master(
  p_idempotency_key TEXT,
  p_company_id UUID,
  p_branch_id UUID,
  p_cust_id TEXT,
  p_name TEXT,
  p_default_sales_id UUID DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_id UUID;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'upsert_customer_master', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF NOT private.has_branch_role(p_company_id, p_branch_id, ARRAY['sales_admin','reconciliation_reviewer','accountant','system_admin']) THEN
    RAISE EXCEPTION 'Izin ditolak mengelola master pelanggan.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.customers (company_id, branch_id, cust_id, name, default_sales_id, phone, address, created_by, updated_by)
  VALUES (p_company_id, p_branch_id, trim(p_cust_id), trim(p_name), p_default_sales_id, p_phone, p_address, v_actor_id, v_actor_id)
  ON CONFLICT (company_id, cust_id)
  DO UPDATE SET name = EXCLUDED.name, default_sales_id = COALESCE(EXCLUDED.default_sales_id, public.customers.default_sales_id),
                phone = COALESCE(EXCLUDED.phone, public.customers.phone), address = COALESCE(EXCLUDED.address, public.customers.address),
                updated_by = v_actor_id, version = public.customers.version + 1, updated_at = now()
  RETURNING id INTO v_id;

  v_result := jsonb_build_object('customer_id', v_id, 'cust_id', trim(p_cust_id), 'name', trim(p_name));
  PERFORM private.save_idempotency(p_company_id, v_actor_id, 'upsert_customer_master', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_customer_alias(
  p_idempotency_key TEXT,
  p_company_id UUID,
  p_customer_id UUID,
  p_alias_name TEXT,
  p_source_bank_account_hint TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_id UUID;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'upsert_customer_alias', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF NOT private.has_company_role(p_company_id, ARRAY['sales_admin','reconciliation_reviewer','accountant','system_admin']) THEN
    RAISE EXCEPTION 'Izin ditolak.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.customer_aliases (company_id, customer_id, alias_name, source_bank_account_hint, created_by)
  VALUES (p_company_id, p_customer_id, trim(p_alias_name), p_source_bank_account_hint, v_actor_id)
  ON CONFLICT (company_id, alias_name)
  DO UPDATE SET customer_id = EXCLUDED.customer_id, source_bank_account_hint = EXCLUDED.source_bank_account_hint
  RETURNING id INTO v_id;

  v_result := jsonb_build_object('alias_id', v_id, 'customer_id', p_customer_id, 'alias_name', trim(p_alias_name));
  PERFORM private.save_idempotency(p_company_id, v_actor_id, 'upsert_customer_alias', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_product_master(
  p_idempotency_key TEXT,
  p_company_id UUID,
  p_sku TEXT,
  p_name TEXT,
  p_base_unit TEXT DEFAULT 'PCS',
  p_is_stocked BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_id UUID;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'upsert_product_master', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF NOT private.has_company_role(p_company_id, ARRAY['sales_admin','reconciliation_reviewer','accountant','system_admin']) THEN
    RAISE EXCEPTION 'Izin ditolak.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.products (company_id, sku, name, base_unit, is_stocked)
  VALUES (p_company_id, trim(p_sku), trim(p_name), COALESCE(NULLIF(trim(p_base_unit), ''), 'PCS'), COALESCE(p_is_stocked, true))
  ON CONFLICT (company_id, sku)
  DO UPDATE SET name = EXCLUDED.name, base_unit = EXCLUDED.base_unit, is_stocked = EXCLUDED.is_stocked,
                version = public.products.version + 1, updated_at = now()
  RETURNING id INTO v_id;

  INSERT INTO public.product_units (company_id, product_id, unit_code, conversion_factor)
  VALUES (p_company_id, v_id, COALESCE(NULLIF(trim(p_base_unit), ''), 'PCS'), 1)
  ON CONFLICT (product_id, unit_code) DO NOTHING;

  v_result := jsonb_build_object('product_id', v_id, 'sku', trim(p_sku), 'name', trim(p_name));
  PERFORM private.save_idempotency(p_company_id, v_actor_id, 'upsert_product_master', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- Restrict RPC execute grants strictly to authenticated users
REVOKE ALL ON FUNCTION public.draft_sale(TEXT,UUID,UUID,UUID,UUID,DATE,DATE,DATE,TEXT,TEXT,UUID,TEXT,TEXT,TEXT,JSONB,UUID,INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_sale(TEXT,UUID,UUID,UUID,UUID,DATE,DATE,DATE,TEXT,TEXT,UUID,TEXT,TEXT,TEXT,JSONB,UUID,INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.submit_sale(TEXT,UUID,INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_sale(TEXT,UUID,INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.approve_and_release_sale(TEXT,UUID,INTEGER,DATE,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_and_release_sale(TEXT,UUID,INTEGER,DATE,TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.propose_payment_allocation(TEXT,UUID,UUID,JSONB,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_payment_allocation(TEXT,UUID,UUID,JSONB,TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.approve_payment_allocation(TEXT,UUID[],TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_payment_allocation(TEXT,UUID[],TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.reverse_payment_allocation(TEXT,UUID,INTEGER,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_payment_allocation(TEXT,UUID,INTEGER,TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.save_reconciliation_review(TEXT,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_reconciliation_review(TEXT,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,JSONB) TO authenticated;

REVOKE ALL ON FUNCTION public.issue_sales_credit_note(TEXT,UUID,DATE,TEXT,JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_sales_credit_note(TEXT,UUID,DATE,TEXT,JSONB) TO authenticated;

REVOKE ALL ON FUNCTION public.preview_sales_import(TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_sales_import(TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB) TO authenticated;

REVOKE ALL ON FUNCTION public.commit_sales_import(TEXT,UUID,INTEGER,BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commit_sales_import(TEXT,UUID,INTEGER,BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.get_sales_recap(UUID,UUID,DATE,DATE,DATE,BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_recap(UUID,UUID,DATE,DATE,DATE,BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.get_customer_receivable(UUID,UUID,UUID,DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_receivable(UUID,UUID,UUID,DATE) TO authenticated;

REVOKE ALL ON FUNCTION public.append_sales_note(TEXT,UUID,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.append_sales_note(TEXT,UUID,TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.upsert_customer_master(TEXT,UUID,UUID,TEXT,TEXT,UUID,TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_customer_master(TEXT,UUID,UUID,TEXT,TEXT,UUID,TEXT,TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.upsert_customer_alias(TEXT,UUID,UUID,TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_customer_alias(TEXT,UUID,UUID,TEXT,TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.upsert_product_master(TEXT,UUID,TEXT,TEXT,TEXT,BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_product_master(TEXT,UUID,TEXT,TEXT,TEXT,BOOLEAN) TO authenticated;

INSERT INTO public.schema_migrations (version, description)
VALUES ('0006_finops_app2_rpcs_and_views', 'Security-invoker App 2 read models and transactional RPCs for sales, import, M:N allocation, reconciliation, credit notes, and receivables')
ON CONFLICT (version) DO NOTHING;
