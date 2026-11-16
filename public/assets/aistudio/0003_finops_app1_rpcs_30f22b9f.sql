-- ==============================================================================
-- FINOPS_SHARED_V1 — Migration 0003: Transactional RPCs App 1 (Penerimaan & Setoran)
-- Semua RPC dijalankan sebagai SECURITY DEFINER di schema public dengan
-- search_path = '' dan pemeriksaan auth.uid(), membership, branch scope,
-- maker-checker, idempotency_key, optimistic version, serta row-level locking.
-- ==============================================================================

-- Helper internal untuk idempotency lookup
CREATE OR REPLACE FUNCTION private.check_idempotency(
  p_actor_id UUID,
  p_rpc_name TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT response_payload
  FROM public.idempotency_keys
  WHERE actor_id = p_actor_id
    AND rpc_name = p_rpc_name
    AND idempotency_key = p_idempotency_key
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.save_idempotency(
  p_company_id UUID,
  p_actor_id UUID,
  p_rpc_name TEXT,
  p_idempotency_key TEXT,
  p_response JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency_key wajib diisi.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.idempotency_keys (company_id, actor_id, rpc_name, idempotency_key, response_payload)
  VALUES (p_company_id, p_actor_id, p_rpc_name, p_idempotency_key, p_response)
  ON CONFLICT (actor_id, rpc_name, idempotency_key) DO NOTHING;
END;
$$;

-- ------------------------------------------------------------------------------
-- 1. create_receipt_draft
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_receipt_draft(
  p_idempotency_key TEXT,
  p_company_id UUID,
  p_branch_id UUID,
  p_receipt_channel TEXT,
  p_customer_paid_at DATE,
  p_bank_value_date DATE,
  p_fund_account_id UUID,
  p_customer_id UUID,
  p_is_unknown_identity BOOLEAN,
  p_sender_name_raw TEXT,
  p_customer_gross_amount NUMERIC(20,2),
  p_bank_net_amount NUMERIC(20,2),
  p_bank_fee_amount NUMERIC(20,2) DEFAULT 0,
  p_bank_fee_bearer TEXT DEFAULT 'none',
  p_bank_reference TEXT DEFAULT NULL,
  p_optional_invoice_ref TEXT DEFAULT NULL,
  p_receipt_book_no TEXT DEFAULT NULL,
  p_actual_collector_id UUID DEFAULT NULL,
  p_sales_owner_id UUID DEFAULT NULL,
  p_location_note TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_evidence_hash TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_doc_no TEXT;
  v_receipt_id UUID;
  v_own_staff_id UUID;
  v_dup_count INTEGER;
  v_dup_flag BOOLEAN := false;
  v_dup_reason TEXT := NULL;
  v_net NUMERIC(20,2);
  v_fee NUMERIC(20,2);
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Autentikasi diperlukan (anonymous ditolak).' USING ERRCODE = '42501';
  END IF;

  v_cached := private.check_idempotency(v_actor_id, 'create_receipt_draft', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF NOT private.has_branch_role(p_company_id, p_branch_id, ARRAY['finance_maker','finance_checker','collector_optional']) THEN
    RAISE EXCEPTION 'Akses cabang atau peran tidak diizinkan untuk membuat penerimaan.' USING ERRCODE = '42501';
  END IF;

  -- Collector optional hanya boleh lapor tunai atas nama dirinya sendiri
  IF private.has_company_role(p_company_id, ARRAY['collector_optional'])
     AND NOT private.has_company_role(p_company_id, ARRAY['finance_maker','finance_checker']) THEN
    IF p_receipt_channel <> 'cash' THEN
      RAISE EXCEPTION 'Akun penagih hanya dapat melaporkan penerimaan tunai.' USING ERRCODE = '42501';
    END IF;
    v_own_staff_id := private.get_own_staff_id(p_company_id);
    IF v_own_staff_id IS NULL OR p_actual_collector_id IS DISTINCT FROM v_own_staff_id THEN
      RAISE EXCEPTION 'Akun penagih hanya boleh mencatat atas nama dirinya sendiri.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_customer_gross_amount IS NULL OR p_customer_gross_amount <= 0 THEN
    RAISE EXCEPTION 'Nominal penerimaan harus lebih dari 0.' USING ERRCODE = '22023';
  END IF;

  IF p_is_unknown_identity = true AND p_customer_id IS NOT NULL THEN
    RAISE EXCEPTION 'Pilihan identitas belum diketahui tidak boleh memiliki customer_id.' USING ERRCODE = '22023';
  END IF;

  IF p_receipt_channel = 'cash' AND p_actual_collector_id IS NULL THEN
    RAISE EXCEPTION 'Penerimaan tunai wajib mencantumkan penagih yang menerima uang.' USING ERRCODE = '22023';
  END IF;

  v_fee := COALESCE(p_bank_fee_amount, 0);
  v_net := COALESCE(p_bank_net_amount, p_customer_gross_amount - v_fee);
  IF v_net < 0 OR (v_net + v_fee) > p_customer_gross_amount THEN
    RAISE EXCEPTION 'Kredit bank bersih + biaya bank tidak konsisten terhadap nominal pelanggan.' USING ERRCODE = '22023';
  END IF;

  -- Cek indikasi duplikat (TANPA menghapus otomatis)
  SELECT count(*) INTO v_dup_count
  FROM public.receipts r
  WHERE r.company_id = p_company_id
    AND r.status NOT IN ('rejected', 'reversed')
    AND r.customer_paid_at = p_customer_paid_at
    AND r.customer_gross_amount = p_customer_gross_amount
    AND (
      (p_bank_reference IS NOT NULL AND r.bank_reference = p_bank_reference)
      OR (p_evidence_hash IS NOT NULL AND r.evidence_hash = p_evidence_hash)
      OR (p_fund_account_id IS NOT NULL AND r.fund_account_id = p_fund_account_id)
    );

  IF v_dup_count > 0 THEN
    v_dup_flag := true;
    v_dup_reason := 'Terdeteksi nominal, tanggal, rekening/referensi/hash bukti yang identik dengan dokumen lain. Perlu tinjauan checker.';
  END IF;

  v_doc_no := private.next_document_number(
    p_company_id,
    CASE WHEN p_receipt_channel = 'bank_transfer' THEN 'receipt_transfer' ELSE 'receipt_cash' END,
    CASE WHEN p_receipt_channel = 'bank_transfer' THEN 'RCV-TRF' ELSE 'RCV-TUN' END,
    p_customer_paid_at
  );

  INSERT INTO public.receipts (
    company_id, branch_id, receipt_number, receipt_channel,
    customer_gross_amount, bank_net_amount, bank_fee_amount, bank_fee_bearer, verified_amount,
    customer_paid_at, bank_value_date, is_unknown_identity, customer_id, sender_name_raw,
    fund_account_id, bank_reference, optional_invoice_ref, receipt_book_no,
    actual_collector_id, sales_owner_id, location_note, notes, evidence_hash,
    duplicate_flag, duplicate_reason,
    status, deposit_status, reconciliation_status, accounting_status,
    created_by, updated_by
  ) VALUES (
    p_company_id, p_branch_id, v_doc_no, p_receipt_channel,
    p_customer_gross_amount, v_net, v_fee, COALESCE(p_bank_fee_bearer, 'none'), 0,
    p_customer_paid_at, p_bank_value_date, p_is_unknown_identity, p_customer_id, p_sender_name_raw,
    p_fund_account_id, p_bank_reference, p_optional_invoice_ref, p_receipt_book_no,
    p_actual_collector_id, p_sales_owner_id, p_location_note, p_notes, p_evidence_hash,
    v_dup_flag, v_dup_reason,
    'draft',
    CASE WHEN p_receipt_channel = 'cash' THEN 'not_deposited' ELSE 'not_applicable' END,
    'unreviewed',
    'not_ready',
    v_actor_id, v_actor_id
  )
  RETURNING id INTO v_receipt_id;

  PERFORM private.write_audit_event(
    p_company_id, p_branch_id, v_actor_id, 'receipt.create_draft', 'receipt', v_receipt_id,
    NULL, jsonb_build_object('receipt_number', v_doc_no, 'gross', p_customer_gross_amount, 'channel', p_receipt_channel),
    'Draft penerimaan dibuat'
  );

  v_result := jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_number', v_doc_no,
    'status', 'draft',
    'duplicate_flag', v_dup_flag,
    'duplicate_reason', v_dup_reason,
    'version', 1
  );

  PERFORM private.save_idempotency(p_company_id, v_actor_id, 'create_receipt_draft', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. submit_receipt
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_receipt(
  p_idempotency_key TEXT,
  p_receipt_id UUID,
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
  v_r public.receipts%ROWTYPE;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'submit_receipt', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_r FROM public.receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Penerimaan tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT private.has_branch_role(v_r.company_id, v_r.branch_id, ARRAY['finance_maker','finance_checker','collector_optional']) THEN
    RAISE EXCEPTION 'Izin ditolak untuk mengajukan penerimaan ini.' USING ERRCODE = '42501';
  END IF;

  IF v_r.version <> p_expected_version THEN
    RAISE EXCEPTION 'Konflik versi dokumen (expected %, aktual %). Muat ulang data.', p_expected_version, v_r.version USING ERRCODE = '40001';
  END IF;

  IF v_r.status <> 'draft' THEN
    RAISE EXCEPTION 'Hanya draft yang dapat diajukan verifikasi (status saat ini: %).', v_r.status USING ERRCODE = '22023';
  END IF;

  UPDATE public.receipts
  SET status = 'waiting_verification',
      submitted_by = v_actor_id,
      submitted_at = now(),
      updated_by = v_actor_id,
      version = version + 1,
      updated_at = now()
  WHERE id = v_r.id;

  -- Jika tunai: tambahkan ke unverified_reported_balance di custody penagih (belum menambah kas sah!)
  IF v_r.receipt_channel = 'cash' AND v_r.actual_collector_id IS NOT NULL THEN
    INSERT INTO public.cash_custody_accounts (company_id, branch_id, collector_staff_id, currency, verified_balance, unverified_reported_balance)
    VALUES (v_r.company_id, v_r.branch_id, v_r.actual_collector_id, v_r.currency, 0, v_r.customer_gross_amount)
    ON CONFLICT (company_id, collector_staff_id, currency)
    DO UPDATE SET unverified_reported_balance = public.cash_custody_accounts.unverified_reported_balance + EXCLUDED.unverified_reported_balance,
                  version = public.cash_custody_accounts.version + 1,
                  updated_at = now();
  END IF;

  IF v_r.duplicate_flag = true THEN
    INSERT INTO public.discrepancy_cases (
      company_id, branch_id, case_number, case_type, source_type, source_id,
      expected_amount, actual_amount, discrepancy_amount, status, created_by
    ) VALUES (
      v_r.company_id, v_r.branch_id,
      private.next_document_number(v_r.company_id, 'discrepancy_case', 'CASE', CURRENT_DATE),
      'duplicate_review', 'receipt', v_r.id,
      v_r.customer_gross_amount, v_r.customer_gross_amount, 0, 'open', v_actor_id
    );
  END IF;

  PERFORM private.write_audit_event(
    v_r.company_id, v_r.branch_id, v_actor_id, 'receipt.submit', 'receipt', v_r.id,
    jsonb_build_object('status', v_r.status),
    jsonb_build_object('status', 'waiting_verification'),
    'Diajukan untuk verifikasi checker'
  );

  v_result := jsonb_build_object('receipt_id', v_r.id, 'status', 'waiting_verification', 'version', v_r.version + 1);
  PERFORM private.save_idempotency(v_r.company_id, v_actor_id, 'submit_receipt', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. verify_receipt
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_receipt(
  p_idempotency_key TEXT,
  p_receipt_id UUID,
  p_expected_version INTEGER,
  p_verification_method TEXT, -- 'bank_statement_match' | 'manual_bank_check' | 'cash_evidence_check'
  p_bank_statement_line_id UUID DEFAULT NULL,
  p_verification_ref TEXT DEFAULT NULL,
  p_verification_note TEXT DEFAULT NULL,
  p_bank_value_date DATE DEFAULT NULL,
  p_bank_fee_amount NUMERIC(20,2) DEFAULT NULL,
  p_bank_fee_bearer TEXT DEFAULT NULL -- 'none' | 'company' | 'customer' | 'pending_review'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_r public.receipts%ROWTYPE;
  v_bl public.bank_statement_lines%ROWTYPE;
  v_custody_id UUID;
  v_new_balance NUMERIC(20,2);
  v_fee NUMERIC(20,2);
  v_bearer TEXT;
  v_verified_amt NUMERIC(20,2);
  v_bank_net NUMERIC(20,2);
  v_event_type TEXT;
  v_match_group UUID;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'verify_receipt', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_r FROM public.receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Penerimaan tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT private.has_branch_role(v_r.company_id, v_r.branch_id, ARRAY['finance_checker']) THEN
    RAISE EXCEPTION 'Hanya finance_checker pada cabang terkait yang dapat memverifikasi penerimaan.' USING ERRCODE = '42501';
  END IF;

  PERFORM private.assert_maker_checker(v_r.created_by, v_actor_id, 'penerimaan');
  IF v_r.submitted_by IS NOT NULL THEN
    PERFORM private.assert_maker_checker(v_r.submitted_by, v_actor_id, 'pengajuan penerimaan');
  END IF;

  IF v_r.version <> p_expected_version THEN
    RAISE EXCEPTION 'Konflik versi dokumen (expected %, aktual %).', p_expected_version, v_r.version USING ERRCODE = '40001';
  END IF;

  IF v_r.status NOT IN ('submitted', 'waiting_verification') THEN
    RAISE EXCEPTION 'Penerimaan tidak berada pada antrian verifikasi (status: %).', v_r.status USING ERRCODE = '22023';
  END IF;

  v_fee := COALESCE(p_bank_fee_amount, v_r.bank_fee_amount, 0);
  v_bearer := COALESCE(p_bank_fee_bearer, v_r.bank_fee_bearer, 'none');

  IF v_r.receipt_channel = 'bank_transfer' THEN
    IF p_verification_method = 'bank_statement_match' THEN
      IF p_bank_statement_line_id IS NULL THEN
        RAISE EXCEPTION 'Pilih baris mutasi bank untuk verifikasi mutasi.' USING ERRCODE = '22023';
      END IF;
      SELECT * INTO v_bl FROM public.bank_statement_lines WHERE id = p_bank_statement_line_id FOR UPDATE;
      IF NOT FOUND OR v_bl.company_id <> v_r.company_id THEN
        RAISE EXCEPTION 'Baris mutasi bank tidak valid.' USING ERRCODE = 'P0002';
      END IF;
      IF v_bl.direction <> 'credit' THEN
        RAISE EXCEPTION 'Mutasi bank penerimaan pelanggan harus berupa kredit.' USING ERRCODE = '22023';
      END IF;
      IF (v_bl.amount - v_bl.matched_amount) <= 0 THEN
        RAISE EXCEPTION 'Baris mutasi bank ini sudah habis dicocokkan.' USING ERRCODE = '22023';
      END IF;
      v_bank_net := LEAST(v_bl.amount - v_bl.matched_amount, v_r.customer_gross_amount - v_fee);
      IF v_bank_net <= 0 THEN
        RAISE EXCEPTION 'Nominal kredit bank tidak valid untuk penerimaan ini.' USING ERRCODE = '22023';
      END IF;

      v_match_group := gen_random_uuid();
      INSERT INTO public.bank_matches (
        company_id, match_group_id, bank_statement_line_id, target_type, target_id,
        matched_amount, status, proposed_by, approved_by, approved_at
      ) VALUES (
        v_r.company_id, v_match_group, v_bl.id, 'receipt', v_r.id,
        v_bank_net, 'approved', v_r.created_by, v_actor_id, now()
      );

      UPDATE public.bank_statement_lines
      SET matched_amount = matched_amount + v_bank_net,
          match_status = CASE WHEN (matched_amount + v_bank_net) >= amount THEN 'matched' ELSE 'proposed' END,
          version = version + 1
      WHERE id = v_bl.id;
    ELSE
      IF p_verification_ref IS NULL OR length(trim(p_verification_ref)) = 0 THEN
        RAISE EXCEPTION 'Verifikasi manual wajib menyertakan referensi dan alasan pemeriksaan.' USING ERRCODE = '22023';
      END IF;
      v_bank_net := v_r.customer_gross_amount - v_fee;
    END IF;

    -- Penentuan nominal terverifikasi sesuai kebijakan biaya bank
    IF v_fee > 0 AND v_bearer = 'company' THEN
      v_verified_amt := v_r.customer_gross_amount; -- Bank net + biaya ditanggung perusahaan = titipan bruto
    ELSE
      v_verified_amt := v_bank_net; -- Tanpa persetujuan biaya, hanya alokasikan dana masuk bersih
      IF v_fee > 0 AND v_bearer = 'pending_review' THEN
        INSERT INTO public.discrepancy_cases (
          company_id, branch_id, case_number, case_type, source_type, source_id,
          expected_amount, actual_amount, discrepancy_amount, status, created_by
        ) VALUES (
          v_r.company_id, v_r.branch_id,
          private.next_document_number(v_r.company_id, 'discrepancy_case', 'CASE', CURRENT_DATE),
          'bank_fee_review', 'receipt', v_r.id,
          v_r.customer_gross_amount, v_bank_net, v_fee, 'open', v_actor_id
        );
      END IF;
    END IF;

  ELSE
    -- Penerimaan Tunai: konfirmasi penguasaan kas di penagih
    v_bank_net := v_r.customer_gross_amount;
    v_verified_amt := v_r.customer_gross_amount;

    SELECT id INTO v_custody_id
    FROM public.cash_custody_accounts
    WHERE company_id = v_r.company_id AND collector_staff_id = v_r.actual_collector_id AND currency = v_r.currency
    FOR UPDATE;

    IF v_custody_id IS NULL THEN
      INSERT INTO public.cash_custody_accounts (company_id, branch_id, collector_staff_id, currency, verified_balance, unverified_reported_balance)
      VALUES (v_r.company_id, v_r.branch_id, v_r.actual_collector_id, v_r.currency, v_verified_amt, 0)
      RETURNING id, verified_balance INTO v_custody_id, v_new_balance;
    ELSE
      UPDATE public.cash_custody_accounts
      SET verified_balance = verified_balance + v_verified_amt,
          unverified_reported_balance = GREATEST(0, unverified_reported_balance - v_r.customer_gross_amount),
          version = version + 1,
          updated_at = now()
      WHERE id = v_custody_id
      RETURNING verified_balance INTO v_new_balance;
    END IF;

    INSERT INTO public.custody_movements (
      company_id, branch_id, custody_account_id, collector_staff_id,
      movement_type, direction, amount, balance_after,
      source_type, source_id, effective_date, actor_id
    ) VALUES (
      v_r.company_id, v_r.branch_id, v_custody_id, v_r.actual_collector_id,
      'cash_receipt_verified', 'in', v_verified_amt, v_new_balance,
      'receipt', v_r.id, v_r.customer_paid_at, v_actor_id
    );

    INSERT INTO public.custody_movement_sources (
      company_id, custody_account_id, receipt_id, verified_amount, deposited_amount, remaining_amount
    ) VALUES (
      v_r.company_id, v_custody_id, v_r.id, v_verified_amt, 0, v_verified_amt
    )
    ON CONFLICT (receipt_id) DO NOTHING;
  END IF;

  -- Jika identitas pengirim belum diketahui, catat kasus tindak lanjut
  IF v_r.is_unknown_identity THEN
    INSERT INTO public.discrepancy_cases (
      company_id, branch_id, case_number, case_type, source_type, source_id,
      expected_amount, actual_amount, discrepancy_amount, status, created_by
    ) VALUES (
      v_r.company_id, v_r.branch_id,
      private.next_document_number(v_r.company_id, 'discrepancy_case', 'CASE', CURRENT_DATE),
      'unknown_sender', 'receipt', v_r.id,
      v_verified_amt, v_verified_amt, 0, 'open', v_actor_id
    );
  END IF;

  UPDATE public.receipts
  SET status = 'verified',
      bank_net_amount = v_bank_net,
      bank_fee_amount = v_fee,
      bank_fee_bearer = v_bearer,
      verified_amount = v_verified_amt,
      bank_value_date = COALESCE(p_bank_value_date, v_bl.value_date, bank_value_date, customer_paid_at),
      accounting_date = COALESCE(p_bank_value_date, v_bl.value_date, bank_value_date, customer_paid_at),
      verification_method = p_verification_method,
      verification_ref = COALESCE(p_verification_ref, v_bl.bank_reference),
      verification_note = p_verification_note,
      verified_by = v_actor_id,
      approved_by = v_actor_id,
      verified_at = now(),
      updated_by = v_actor_id,
      accounting_status = 'queued',
      version = version + 1,
      updated_at = now()
  WHERE id = v_r.id;

  v_event_type := CASE
    WHEN v_r.is_unknown_identity THEN 'receipt_unidentified_verified'
    WHEN v_r.receipt_channel = 'bank_transfer' THEN 'receipt_transfer_verified'
    ELSE 'receipt_cash_verified'
  END;

  PERFORM private.emit_accounting_event(
    v_r.company_id, v_r.branch_id, v_event_type, 'receipt', v_r.id, v_r.version + 1,
    COALESCE(p_bank_value_date, v_bl.value_date, v_r.customer_paid_at),
    jsonb_build_object(
      'receipt_number', v_r.receipt_number,
      'channel', v_r.receipt_channel,
      'is_unknown_identity', v_r.is_unknown_identity,
      'customer_id', v_r.customer_id,
      'customer_gross_amount', v_r.customer_gross_amount,
      'bank_net_amount', v_bank_net,
      'bank_fee_amount', v_fee,
      'bank_fee_bearer', v_bearer,
      'verified_amount', v_verified_amt,
      'actual_collector_id', v_r.actual_collector_id,
      'fund_account_id', v_r.fund_account_id
    ),
    ARRAY[]::UUID[], v_actor_id, v_r.correlation_id
  );

  INSERT INTO public.approvals (company_id, branch_id, target_type, target_id, action, decision, actor_id, reason)
  VALUES (v_r.company_id, v_r.branch_id, 'receipt', v_r.id, 'verify_receipt', 'approved', v_actor_id, p_verification_note);

  PERFORM private.write_audit_event(
    v_r.company_id, v_r.branch_id, v_actor_id, 'receipt.verify', 'receipt', v_r.id,
    jsonb_build_object('status', v_r.status, 'verified_amount', 0),
    jsonb_build_object('status', 'verified', 'verified_amount', v_verified_amt, 'method', p_verification_method),
    COALESCE(p_verification_note, 'Dana diverifikasi oleh checker')
  );

  v_result := jsonb_build_object(
    'receipt_id', v_r.id,
    'status', 'verified',
    'verified_amount', v_verified_amt,
    'version', v_r.version + 1
  );

  PERFORM private.save_idempotency(v_r.company_id, v_actor_id, 'verify_receipt', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. reject_receipt
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_receipt(
  p_idempotency_key TEXT,
  p_receipt_id UUID,
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
  v_r public.receipts%ROWTYPE;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'reject_receipt', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Alasan penolakan wajib diisi.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_r FROM public.receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Penerimaan tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT private.has_branch_role(v_r.company_id, v_r.branch_id, ARRAY['finance_checker']) THEN
    RAISE EXCEPTION 'Hanya finance_checker yang dapat menolak penerimaan.' USING ERRCODE = '42501';
  END IF;

  PERFORM private.assert_maker_checker(v_r.created_by, v_actor_id, 'penerimaan');

  IF v_r.version <> p_expected_version THEN
    RAISE EXCEPTION 'Konflik versi dokumen.' USING ERRCODE = '40001';
  END IF;

  IF v_r.status NOT IN ('submitted', 'waiting_verification') THEN
    RAISE EXCEPTION 'Hanya penerimaan menunggu verifikasi yang dapat ditolak.' USING ERRCODE = '22023';
  END IF;

  IF v_r.receipt_channel = 'cash' AND v_r.actual_collector_id IS NOT NULL THEN
    UPDATE public.cash_custody_accounts
    SET unverified_reported_balance = GREATEST(0, unverified_reported_balance - v_r.customer_gross_amount),
        version = version + 1,
        updated_at = now()
    WHERE company_id = v_r.company_id AND collector_staff_id = v_r.actual_collector_id AND currency = v_r.currency;
  END IF;

  UPDATE public.receipts
  SET status = 'rejected',
      rejected_by = v_actor_id,
      rejected_at = now(),
      rejection_reason = p_reason,
      updated_by = v_actor_id,
      version = version + 1,
      updated_at = now()
  WHERE id = v_r.id;

  INSERT INTO public.approvals (company_id, branch_id, target_type, target_id, action, decision, actor_id, reason)
  VALUES (v_r.company_id, v_r.branch_id, 'receipt', v_r.id, 'reject_receipt', 'rejected', v_actor_id, p_reason);

  PERFORM private.write_audit_event(
    v_r.company_id, v_r.branch_id, v_actor_id, 'receipt.reject', 'receipt', v_r.id,
    jsonb_build_object('status', v_r.status), jsonb_build_object('status', 'rejected'), p_reason
  );

  v_result := jsonb_build_object('receipt_id', v_r.id, 'status', 'rejected', 'version', v_r.version + 1);
  PERFORM private.save_idempotency(v_r.company_id, v_actor_id, 'reject_receipt', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. propose_receipt_identity & approve_receipt_identity
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.propose_receipt_identity(
  p_idempotency_key TEXT,
  p_receipt_id UUID,
  p_expected_version INTEGER,
  p_proposed_customer_id UUID,
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
  v_r public.receipts%ROWTYPE;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'propose_receipt_identity', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_r FROM public.receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Penerimaan tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT private.has_branch_role(v_r.company_id, v_r.branch_id, ARRAY['finance_maker','finance_checker','sales_admin']) THEN
    RAISE EXCEPTION 'Izin ditolak.' USING ERRCODE = '42501';
  END IF;

  IF NOT v_r.is_unknown_identity THEN
    RAISE EXCEPTION 'Penerimaan ini sudah memiliki identitas pelanggan.' USING ERRCODE = '22023';
  END IF;

  IF v_r.version <> p_expected_version THEN RAISE EXCEPTION 'Konflik versi.' USING ERRCODE = '40001'; END IF;

  UPDATE public.discrepancy_cases
  SET status = 'pending_approval',
      proposed_resolution = p_proposed_customer_id::TEXT,
      resolution_note = p_reason,
      proposed_by = v_actor_id,
      version = version + 1,
      updated_at = now()
  WHERE source_type = 'receipt' AND source_id = v_r.id AND case_type = 'unknown_sender' AND status IN ('open', 'investigating');

  PERFORM private.write_audit_event(
    v_r.company_id, v_r.branch_id, v_actor_id, 'receipt.propose_identity', 'receipt', v_r.id,
    NULL, jsonb_build_object('proposed_customer_id', p_proposed_customer_id), p_reason
  );

  v_result := jsonb_build_object('receipt_id', v_r.id, 'proposed_customer_id', p_proposed_customer_id, 'status', 'pending_approval');
  PERFORM private.save_idempotency(v_r.company_id, v_actor_id, 'propose_receipt_identity', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_receipt_identity(
  p_idempotency_key TEXT,
  p_receipt_id UUID,
  p_expected_version INTEGER,
  p_customer_id UUID,
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
  v_r public.receipts%ROWTYPE;
  v_proposed_by UUID;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'approve_receipt_identity', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_r FROM public.receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Penerimaan tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT private.has_branch_role(v_r.company_id, v_r.branch_id, ARRAY['finance_checker','reconciliation_reviewer']) THEN
    RAISE EXCEPTION 'Izin ditolak untuk mengesahkan identitas.' USING ERRCODE = '42501';
  END IF;

  SELECT proposed_by INTO v_proposed_by
  FROM public.discrepancy_cases
  WHERE source_type = 'receipt' AND source_id = v_r.id AND case_type = 'unknown_sender'
  LIMIT 1;

  IF v_proposed_by IS NOT NULL THEN
    PERFORM private.assert_maker_checker(v_proposed_by, v_actor_id, 'usulan identitas pengirim');
  END IF;

  IF v_r.version <> p_expected_version THEN RAISE EXCEPTION 'Konflik versi.' USING ERRCODE = '40001'; END IF;

  UPDATE public.receipts
  SET is_unknown_identity = false,
      customer_id = p_customer_id,
      updated_by = v_actor_id,
      version = version + 1,
      updated_at = now()
  WHERE id = v_r.id;

  UPDATE public.discrepancy_cases
  SET status = 'resolved',
      resolved_by = v_actor_id,
      resolved_at = now(),
      resolution_note = p_reason,
      version = version + 1,
      updated_at = now()
  WHERE source_type = 'receipt' AND source_id = v_r.id AND case_type = 'unknown_sender';

  IF v_r.status = 'verified' THEN
    PERFORM private.emit_accounting_event(
      v_r.company_id, v_r.branch_id, 'receipt_identity_resolved', 'receipt', v_r.id, v_r.version + 1,
      COALESCE(v_r.accounting_date, v_r.customer_paid_at),
      jsonb_build_object('receipt_number', v_r.receipt_number, 'customer_id', p_customer_id, 'amount', v_r.verified_amount),
      ARRAY[]::UUID[], v_actor_id, v_r.correlation_id
    );
  END IF;

  PERFORM private.write_audit_event(
    v_r.company_id, v_r.branch_id, v_actor_id, 'receipt.approve_identity', 'receipt', v_r.id,
    jsonb_build_object('is_unknown_identity', true),
    jsonb_build_object('is_unknown_identity', false, 'customer_id', p_customer_id),
    p_reason
  );

  v_result := jsonb_build_object('receipt_id', v_r.id, 'customer_id', p_customer_id, 'version', v_r.version + 1);
  PERFORM private.save_idempotency(v_r.company_id, v_actor_id, 'approve_receipt_identity', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. create_cash_deposit, submit_cash_deposit, accept_cash_deposit
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_cash_deposit(
  p_idempotency_key TEXT,
  p_company_id UUID,
  p_branch_id UUID,
  p_collector_staff_id UUID,
  p_target_type TEXT, -- 'office_cash' | 'bank_direct'
  p_target_fund_account_id UUID,
  p_deposit_date DATE,
  p_lines JSONB, -- [{receipt_id, declared_amount}]
  p_is_planned_partial BOOLEAN DEFAULT false,
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
  v_custody public.cash_custody_accounts%ROWTYPE;
  v_deposit_id UUID;
  v_deposit_no TEXT;
  v_line JSONB;
  v_src public.custody_movement_sources%ROWTYPE;
  v_total_declared NUMERIC(20,2) := 0;
  v_line_amt NUMERIC(20,2);
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'create_cash_deposit', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF NOT private.has_branch_role(p_company_id, p_branch_id, ARRAY['finance_maker','finance_checker','collector_optional']) THEN
    RAISE EXCEPTION 'Izin ditolak membuat setoran.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_custody
  FROM public.cash_custody_accounts
  WHERE company_id = p_company_id AND collector_staff_id = p_collector_staff_id
  FOR UPDATE;

  IF NOT FOUND OR v_custody.verified_balance <= 0 THEN
    RAISE EXCEPTION 'Penagih tidak memiliki saldo kas terverifikasi untuk disetor.' USING ERRCODE = '22023';
  END IF;

  v_deposit_no := private.next_document_number(p_company_id, 'cash_deposit', 'DEP', p_deposit_date);

  INSERT INTO public.cash_deposits (
    company_id, branch_id, deposit_number, collector_staff_id, custody_account_id,
    target_type, target_fund_account_id, deposit_date, declared_amount,
    is_planned_partial, status, notes, created_by
  ) VALUES (
    p_company_id, p_branch_id, v_deposit_no, p_collector_staff_id, v_custody.id,
    p_target_type, p_target_fund_account_id, p_deposit_date, 0.01,
    COALESCE(p_is_planned_partial, false), 'draft', p_notes, v_actor_id
  )
  RETURNING id INTO v_deposit_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_amt := (v_line->>'declared_amount')::NUMERIC(20,2);
    SELECT * INTO v_src
    FROM public.custody_movement_sources
    WHERE custody_account_id = v_custody.id
      AND receipt_id = (v_line->>'receipt_id')::UUID;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Sumber penerimaan tunai belum terverifikasi atau bukan milik penagih ini.' USING ERRCODE = '22023';
    END IF;
    IF v_line_amt <= 0 OR v_line_amt > v_src.remaining_amount THEN
      RAISE EXCEPTION 'Nominal setoran melebihi sisa saldo sumber penerimaan yang dapat ditelusuri.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.cash_deposit_lines (company_id, cash_deposit_id, source_receipt_id, declared_amount)
    VALUES (p_company_id, v_deposit_id, v_src.receipt_id, v_line_amt);

    v_total_declared := v_total_declared + v_line_amt;
  END LOOP;

  IF v_total_declared <= 0 THEN
    RAISE EXCEPTION 'Daftar sumber setoran tidak boleh kosong.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.cash_deposits SET declared_amount = v_total_declared WHERE id = v_deposit_id;

  PERFORM private.write_audit_event(
    p_company_id, p_branch_id, v_actor_id, 'deposit.create', 'cash_deposit', v_deposit_id,
    NULL, jsonb_build_object('deposit_number', v_deposit_no, 'declared_amount', v_total_declared),
    'Draft setoran penagih dibuat'
  );

  v_result := jsonb_build_object(
    'deposit_id', v_deposit_id,
    'deposit_number', v_deposit_no,
    'declared_amount', v_total_declared,
    'status', 'draft',
    'version', 1
  );
  PERFORM private.save_idempotency(p_company_id, v_actor_id, 'create_cash_deposit', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_cash_deposit(
  p_idempotency_key TEXT,
  p_deposit_id UUID,
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
  v_d public.cash_deposits%ROWTYPE;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'submit_cash_deposit', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_d FROM public.cash_deposits WHERE id = p_deposit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Setoran tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT private.has_branch_role(v_d.company_id, v_d.branch_id, ARRAY['finance_maker','finance_checker','collector_optional']) THEN
    RAISE EXCEPTION 'Izin ditolak.' USING ERRCODE = '42501';
  END IF;

  IF v_d.version <> p_expected_version THEN RAISE EXCEPTION 'Konflik versi.' USING ERRCODE = '40001'; END IF;
  IF v_d.status <> 'draft' THEN RAISE EXCEPTION 'Hanya draft setoran yang dapat diajukan.' USING ERRCODE = '22023'; END IF;

  UPDATE public.cash_deposits
  SET status = 'submitted',
      submitted_by = v_actor_id,
      submitted_at = now(),
      version = version + 1,
      updated_at = now()
  WHERE id = v_d.id;

  v_result := jsonb_build_object('deposit_id', v_d.id, 'status', 'submitted', 'version', v_d.version + 1);
  PERFORM private.save_idempotency(v_d.company_id, v_actor_id, 'submit_cash_deposit', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_cash_deposit(
  p_idempotency_key TEXT,
  p_deposit_id UUID,
  p_expected_version INTEGER,
  p_received_amount NUMERIC(20,2),
  p_bank_statement_line_id UUID DEFAULT NULL,
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
  v_d public.cash_deposits%ROWTYPE;
  v_custody public.cash_custody_accounts%ROWTYPE;
  v_bl public.bank_statement_lines%ROWTYPE;
  v_dl RECORD;
  v_src public.custody_movement_sources%ROWTYPE;
  v_remaining_to_allocate NUMERIC(20,2);
  v_take NUMERIC(20,2);
  v_shortage NUMERIC(20,2) := 0;
  v_excess NUMERIC(20,2) := 0;
  v_new_status TEXT;
  v_new_balance NUMERIC(20,2);
  v_match_group UUID;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'accept_cash_deposit', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  -- Deterministic lock order: deposit -> custody -> custody_sources -> bank_line
  SELECT * INTO v_d FROM public.cash_deposits WHERE id = p_deposit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dokumen setoran tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT private.has_branch_role(v_d.company_id, v_d.branch_id, ARRAY['finance_checker']) THEN
    RAISE EXCEPTION 'Hanya finance_checker yang dapat menerima setoran.' USING ERRCODE = '42501';
  END IF;

  PERFORM private.assert_maker_checker(v_d.created_by, v_actor_id, 'setoran penagih');
  IF v_d.submitted_by IS NOT NULL THEN
    PERFORM private.assert_maker_checker(v_d.submitted_by, v_actor_id, 'pengajuan setoran');
  END IF;

  IF v_d.version <> p_expected_version THEN
    RAISE EXCEPTION 'Konflik versi setoran (kemungkinan sudah diproses checker lain).' USING ERRCODE = '40001';
  END IF;

  IF v_d.status <> 'submitted' THEN
    RAISE EXCEPTION 'Setoran ini sudah diproses atau belum diajukan (status: %).', v_d.status USING ERRCODE = '22023';
  END IF;

  IF p_received_amount <= 0 THEN
    RAISE EXCEPTION 'Nominal diterima harus lebih dari 0.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_custody FROM public.cash_custody_accounts WHERE id = v_d.custody_account_id FOR UPDATE;

  IF p_received_amount > v_custody.verified_balance THEN
    RAISE EXCEPTION 'Nominal diterima (%) melebihi saldo kas terverifikasi di penagih (%). Untuk lebih setor tanpa sumber, buat kasus uang belum teridentifikasi terlebih dahulu.', p_received_amount, v_custody.verified_balance USING ERRCODE = '22023';
  END IF;

  -- Setor langsung ke bank wajib memilih mutasi bank yang cocok
  IF v_d.target_type = 'bank_direct' THEN
    IF p_bank_statement_line_id IS NULL THEN
      RAISE EXCEPTION 'Setoran langsung ke bank wajib memilih baris mutasi bank perusahaan yang sesuai.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_bl FROM public.bank_statement_lines WHERE id = p_bank_statement_line_id FOR UPDATE;
    IF NOT FOUND OR v_bl.company_id <> v_d.company_id OR v_bl.fund_account_id <> v_d.target_fund_account_id THEN
      RAISE EXCEPTION 'Baris mutasi bank tidak sesuai dengan rekening tujuan setoran.' USING ERRCODE = '22023';
    END IF;
    IF (v_bl.amount - v_bl.matched_amount) < p_received_amount THEN
      RAISE EXCEPTION 'Sisa mutasi bank tidak mencukupi untuk nominal setoran ini.' USING ERRCODE = '22023';
    END IF;

    v_match_group := gen_random_uuid();
    INSERT INTO public.bank_matches (
      company_id, match_group_id, bank_statement_line_id, target_type, target_id,
      matched_amount, status, proposed_by, approved_by, approved_at
    ) VALUES (
      v_d.company_id, v_match_group, v_bl.id, 'cash_deposit', v_d.id,
      p_received_amount, 'approved', v_d.created_by, v_actor_id, now()
    );

    UPDATE public.bank_statement_lines
    SET matched_amount = matched_amount + p_received_amount,
        match_status = CASE WHEN (matched_amount + p_received_amount) >= amount THEN 'matched' ELSE 'proposed' END,
        suggested_classification = 'collector_direct_deposit',
        version = version + 1
    WHERE id = v_bl.id;
  END IF;

  -- Alokasikan pengurangan sumber custody secara deterministik (FOR UPDATE per receipt_id)
  v_remaining_to_allocate := LEAST(p_received_amount, v_d.declared_amount);
  FOR v_dl IN
    SELECT * FROM public.cash_deposit_lines
    WHERE cash_deposit_id = v_d.id
    ORDER BY source_receipt_id
  LOOP
    EXIT WHEN v_remaining_to_allocate <= 0;
    SELECT * INTO v_src
    FROM public.custody_movement_sources
    WHERE custody_account_id = v_custody.id AND receipt_id = v_dl.source_receipt_id
    FOR UPDATE;

    IF v_src.remaining_amount < LEAST(v_dl.declared_amount, v_remaining_to_allocate) THEN
      RAISE EXCEPTION 'Saldo sumber penerimaan % tidak mencukupi (kemungkinan telah disetor oleh transaksi lain).', v_dl.source_receipt_id USING ERRCODE = '40001';
    END IF;

    v_take := LEAST(v_dl.declared_amount, v_remaining_to_allocate, v_src.remaining_amount);

    UPDATE public.custody_movement_sources
    SET deposited_amount = deposited_amount + v_take,
        remaining_amount = remaining_amount - v_take,
        version = version + 1,
        updated_at = now()
    WHERE id = v_src.id;

    UPDATE public.cash_deposit_lines SET accepted_amount = v_take WHERE id = v_dl.id;

    UPDATE public.receipts
    SET deposit_status = CASE WHEN (v_src.remaining_amount - v_take) = 0 THEN 'deposited' ELSE 'partially_deposited' END,
        updated_at = now()
    WHERE id = v_dl.source_receipt_id;

    v_remaining_to_allocate := v_remaining_to_allocate - v_take;
  END LOOP;

  -- Kurangi verified_balance penagih hanya sebesar nominal diterima
  UPDATE public.cash_custody_accounts
  SET verified_balance = verified_balance - p_received_amount,
      version = version + 1,
      updated_at = now()
  WHERE id = v_custody.id
  RETURNING verified_balance INTO v_new_balance;

  INSERT INTO public.custody_movements (
    company_id, branch_id, custody_account_id, collector_staff_id,
    movement_type, direction, amount, balance_after,
    source_type, source_id, effective_date, actor_id
  ) VALUES (
    v_d.company_id, v_d.branch_id, v_custody.id, v_d.collector_staff_id,
    CASE WHEN v_d.target_type = 'bank_direct' THEN 'deposit_direct_to_bank' ELSE 'deposit_to_office_cash' END,
    'out', p_received_amount, v_new_balance,
    'cash_deposit', v_d.id, v_d.deposit_date, v_actor_id
  );

  -- Evaluasi Kurang Setor vs Setoran Parsial Direncanakan
  IF p_received_amount < v_d.declared_amount THEN
    v_shortage := v_d.declared_amount - p_received_amount;
    v_new_status := 'accepted_with_discrepancy';

    INSERT INTO public.discrepancy_cases (
      company_id, branch_id, case_number, case_type, source_type, source_id,
      expected_amount, actual_amount, discrepancy_amount, status, created_by
    ) VALUES (
      v_d.company_id, v_d.branch_id,
      private.next_document_number(v_d.company_id, 'discrepancy_case', 'CASE', CURRENT_DATE),
      'deposit_shortage', 'cash_deposit', v_d.id,
      v_d.declared_amount, p_received_amount, v_shortage, 'open', v_actor_id
    );
  ELSIF p_received_amount > v_d.declared_amount THEN
    v_excess := p_received_amount - v_d.declared_amount;
    v_new_status := 'accepted_with_discrepancy';
  ELSE
    v_new_status := CASE WHEN v_d.is_planned_partial THEN 'partially_accepted' ELSE 'accepted' END;
  END IF;

  UPDATE public.cash_deposits
  SET received_amount = p_received_amount,
      shortage_amount = v_shortage,
      excess_amount = v_excess,
      bank_statement_line_id = COALESCE(p_bank_statement_line_id, bank_statement_line_id),
      status = v_new_status,
      accounting_status = 'queued',
      received_by = v_actor_id,
      approved_by = v_actor_id,
      approved_at = now(),
      notes = COALESCE(p_notes, notes),
      version = version + 1,
      updated_at = now()
  WHERE id = v_d.id;

  PERFORM private.emit_accounting_event(
    v_d.company_id, v_d.branch_id,
    CASE WHEN v_d.target_type = 'bank_direct' THEN 'cash_deposit_direct_bank_accepted' ELSE 'cash_deposit_office_accepted' END,
    'cash_deposit', v_d.id, v_d.version + 1, v_d.deposit_date,
    jsonb_build_object(
      'deposit_number', v_d.deposit_number,
      'collector_staff_id', v_d.collector_staff_id,
      'target_type', v_d.target_type,
      'target_fund_account_id', v_d.target_fund_account_id,
      'declared_amount', v_d.declared_amount,
      'received_amount', p_received_amount,
      'shortage_amount', v_shortage
    ),
    ARRAY[]::UUID[], v_actor_id, v_d.correlation_id
  );

  INSERT INTO public.approvals (company_id, branch_id, target_type, target_id, action, decision, actor_id, reason)
  VALUES (v_d.company_id, v_d.branch_id, 'cash_deposit', v_d.id, 'accept_cash_deposit', 'approved', v_actor_id, p_notes);

  PERFORM private.write_audit_event(
    v_d.company_id, v_d.branch_id, v_actor_id, 'deposit.accept', 'cash_deposit', v_d.id,
    jsonb_build_object('status', v_d.status),
    jsonb_build_object('status', v_new_status, 'received_amount', p_received_amount, 'shortage', v_shortage, 'custody_after', v_new_balance),
    COALESCE(p_notes, 'Setoran diterima checker')
  );

  v_result := jsonb_build_object(
    'deposit_id', v_d.id,
    'status', v_new_status,
    'received_amount', p_received_amount,
    'shortage_amount', v_shortage,
    'custody_balance_after', v_new_balance,
    'version', v_d.version + 1
  );

  PERFORM private.save_idempotency(v_d.company_id, v_actor_id, 'accept_cash_deposit', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. create_internal_fund_transfer & approve_internal_fund_transfer
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_internal_fund_transfer(
  p_idempotency_key TEXT,
  p_company_id UUID,
  p_branch_id UUID,
  p_transfer_date DATE,
  p_from_fund_account_id UUID,
  p_to_fund_account_id UUID,
  p_amount NUMERIC(20,2),
  p_reference_no TEXT DEFAULT NULL,
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
  v_id UUID;
  v_no TEXT;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'create_internal_fund_transfer', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF NOT private.has_branch_role(p_company_id, p_branch_id, ARRAY['finance_maker','finance_checker']) THEN
    RAISE EXCEPTION 'Izin ditolak.' USING ERRCODE = '42501';
  END IF;

  v_no := private.next_document_number(p_company_id, 'cash_transfer', 'TRF-INT', p_transfer_date);

  INSERT INTO public.cash_transfers (
    company_id, branch_id, transfer_number, transfer_date,
    from_fund_account_id, to_fund_account_id, amount, reference_no, notes, status, created_by
  ) VALUES (
    p_company_id, p_branch_id, v_no, p_transfer_date,
    p_from_fund_account_id, p_to_fund_account_id, p_amount, p_reference_no, p_notes, 'submitted', v_actor_id
  )
  RETURNING id INTO v_id;

  v_result := jsonb_build_object('transfer_id', v_id, 'transfer_number', v_no, 'status', 'submitted', 'version', 1);
  PERFORM private.save_idempotency(p_company_id, v_actor_id, 'create_internal_fund_transfer', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_internal_fund_transfer(
  p_idempotency_key TEXT,
  p_transfer_id UUID,
  p_expected_version INTEGER,
  p_bank_statement_line_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_t public.cash_transfers%ROWTYPE;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'approve_internal_fund_transfer', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_t FROM public.cash_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer internal tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT private.has_branch_role(v_t.company_id, v_t.branch_id, ARRAY['finance_checker']) THEN
    RAISE EXCEPTION 'Hanya finance_checker yang dapat menyetujui transfer kas internal.' USING ERRCODE = '42501';
  END IF;

  PERFORM private.assert_maker_checker(v_t.created_by, v_actor_id, 'transfer kas internal');

  IF v_t.version <> p_expected_version THEN RAISE EXCEPTION 'Konflik versi.' USING ERRCODE = '40001'; END IF;

  UPDATE public.cash_transfers
  SET status = 'approved',
      accounting_status = 'queued',
      bank_statement_line_id = p_bank_statement_line_id,
      approved_by = v_actor_id,
      approved_at = now(),
      version = version + 1
  WHERE id = v_t.id;

  PERFORM private.emit_accounting_event(
    v_t.company_id, v_t.branch_id, 'internal_fund_transfer_approved', 'cash_transfer', v_t.id, v_t.version + 1,
    v_t.transfer_date,
    jsonb_build_object(
      'transfer_number', v_t.transfer_number,
      'from_fund_account_id', v_t.from_fund_account_id,
      'to_fund_account_id', v_t.to_fund_account_id,
      'amount', v_t.amount
    ),
    ARRAY[]::UUID[], v_actor_id, v_t.correlation_id
  );

  v_result := jsonb_build_object('transfer_id', v_t.id, 'status', 'approved', 'version', v_t.version + 1);
  PERFORM private.save_idempotency(v_t.company_id, v_actor_id, 'approve_internal_fund_transfer', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 8. import_bank_statement_preview & commit_bank_statement_import
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_bank_statement_preview(
  p_idempotency_key TEXT,
  p_company_id UUID,
  p_fund_account_id UUID,
  p_file_name TEXT,
  p_file_hash TEXT,
  p_period_start DATE,
  p_period_end DATE,
  p_date_format TEXT,
  p_decimal_format TEXT,
  p_opening_balance NUMERIC(20,2),
  p_closing_balance NUMERIC(20,2),
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
  v_batch_no TEXT;
  v_row JSONB;
  v_ext_id TEXT;
  v_fp TEXT;
  v_dup BOOLEAN;
  v_dup_count INTEGER := 0;
  v_total INTEGER := 0;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'import_bank_statement_preview', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF NOT private.has_company_role(p_company_id, ARRAY['finance_maker','finance_checker','accountant']) THEN
    RAISE EXCEPTION 'Izin ditolak mengimpor mutasi bank.' USING ERRCODE = '42501';
  END IF;

  v_batch_no := private.next_document_number(p_company_id, 'bank_statement_batch', 'MUT', p_period_end);

  INSERT INTO public.bank_statement_batches (
    company_id, fund_account_id, batch_number, file_name, file_hash,
    period_start, period_end, date_format, decimal_format,
    opening_balance, closing_balance, status, created_by
  ) VALUES (
    p_company_id, p_fund_account_id, v_batch_no, p_file_name, p_file_hash,
    p_period_start, p_period_end, p_date_format, p_decimal_format,
    p_opening_balance, p_closing_balance, 'preview', v_actor_id
  )
  RETURNING id INTO v_batch_id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_total := v_total + 1;
    v_ext_id := NULLIF(trim(v_row->>'external_txn_id'), '');
    v_fp := encode(digest(
      p_fund_account_id::TEXT || '|' || (v_row->>'value_date') || '|' || (v_row->>'direction') || '|' || (v_row->>'amount') || '|' || COALESCE(v_row->>'description', ''),
      'sha256'
    ), 'hex');

    SELECT EXISTS (
      SELECT 1 FROM public.bank_statement_lines l
      WHERE l.company_id = p_company_id
        AND l.fund_account_id = p_fund_account_id
        AND ((v_ext_id IS NOT NULL AND l.external_txn_id = v_ext_id) OR l.fingerprint_hash = v_fp)
    ) INTO v_dup;

    IF v_dup THEN v_dup_count := v_dup_count + 1; END IF;

    INSERT INTO public.bank_statement_lines (
      company_id, batch_id, fund_account_id, row_number, raw_row,
      external_txn_id, fingerprint_hash, posting_date, value_date,
      direction, amount, signed_amount, running_balance, bank_reference, description,
      is_duplicate_suspect, duplicate_note
    ) VALUES (
      p_company_id, v_batch_id, p_fund_account_id, (v_row->>'row_number')::INTEGER, COALESCE(v_row->'raw_row', v_row),
      v_ext_id, v_fp, (v_row->>'posting_date')::DATE, (v_row->>'value_date')::DATE,
      v_row->>'direction', (v_row->>'amount')::NUMERIC(20,2),
      CASE WHEN v_row->>'direction' = 'debit' THEN -((v_row->>'amount')::NUMERIC(20,2)) ELSE (v_row->>'amount')::NUMERIC(20,2) END,
      NULLIF(v_row->>'running_balance', '')::NUMERIC(20,2),
      v_row->>'bank_reference', COALESCE(v_row->>'description', ''),
      v_dup,
      CASE WHEN v_dup THEN 'Terdeteksi baris/ID mutasi serupa sudah pernah diimpor' ELSE NULL END
    )
    ON CONFLICT (company_id, fund_account_id, external_txn_id) DO NOTHING;
  END LOOP;

  UPDATE public.bank_statement_batches
  SET total_rows = v_total, duplicate_rows = v_dup_count
  WHERE id = v_batch_id;

  v_result := jsonb_build_object(
    'batch_id', v_batch_id,
    'batch_number', v_batch_no,
    'total_rows', v_total,
    'duplicate_rows', v_dup_count,
    'status', 'preview'
  );
  PERFORM private.save_idempotency(p_company_id, v_actor_id, 'import_bank_statement_preview', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_bank_statement_import(
  p_idempotency_key TEXT,
  p_batch_id UUID,
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
  v_b public.bank_statement_batches%ROWTYPE;
  v_line_count INTEGER;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'commit_bank_statement_import', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_b FROM public.bank_statement_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch mutasi tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT private.has_company_role(v_b.company_id, ARRAY['finance_maker','finance_checker','accountant']) THEN
    RAISE EXCEPTION 'Izin ditolak.' USING ERRCODE = '42501';
  END IF;

  IF v_b.version <> p_expected_version THEN RAISE EXCEPTION 'Konflik versi.' USING ERRCODE = '40001'; END IF;
  IF v_b.status <> 'preview' THEN RAISE EXCEPTION 'Batch sudah di-commit atau dibatalkan.' USING ERRCODE = '22023'; END IF;

  SELECT count(*) INTO v_line_count FROM public.bank_statement_lines WHERE batch_id = v_b.id;

  UPDATE public.bank_statement_batches
  SET status = 'committed',
      imported_rows = v_line_count,
      committed_by = v_actor_id,
      committed_at = now(),
      version = version + 1
  WHERE id = v_b.id;

  PERFORM private.write_audit_event(
    v_b.company_id, NULL, v_actor_id, 'bank.commit_import', 'bank_statement_batch', v_b.id,
    NULL, jsonb_build_object('batch_number', v_b.batch_number, 'imported_rows', v_line_count),
    'Commit impor mutasi bank'
  );

  v_result := jsonb_build_object('batch_id', v_b.id, 'status', 'committed', 'imported_rows', v_line_count);
  PERFORM private.save_idempotency(v_b.company_id, v_actor_id, 'commit_bank_statement_import', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 9. propose_bank_match & approve_bank_match (1:1, 1:N, N:1)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.propose_bank_match(
  p_idempotency_key TEXT,
  p_company_id UUID,
  p_items JSONB, -- [{bank_statement_line_id, target_type, target_id, matched_amount}]
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
  v_group_id UUID := gen_random_uuid();
  v_item JSONB;
  v_bl public.bank_statement_lines%ROWTYPE;
  v_amt NUMERIC(20,2);
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'propose_bank_match', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF NOT private.has_company_role(p_company_id, ARRAY['finance_maker','finance_checker','reconciliation_reviewer']) THEN
    RAISE EXCEPTION 'Izin ditolak.' USING ERRCODE = '42501';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_amt := (v_item->>'matched_amount')::NUMERIC(20,2);
    SELECT * INTO v_bl FROM public.bank_statement_lines WHERE id = (v_item->>'bank_statement_line_id')::UUID FOR UPDATE;
    IF NOT FOUND OR v_bl.company_id <> p_company_id THEN
      RAISE EXCEPTION 'Baris mutasi tidak valid.' USING ERRCODE = 'P0002';
    END IF;
    IF (v_bl.amount - v_bl.matched_amount) < v_amt THEN
      RAISE EXCEPTION 'Nominal match melebihi sisa mutasi yang belum terpakai.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.bank_matches (
      company_id, match_group_id, bank_statement_line_id, target_type, target_id,
      matched_amount, status, notes, proposed_by
    ) VALUES (
      p_company_id, v_group_id, v_bl.id, v_item->>'target_type', (v_item->>'target_id')::UUID,
      v_amt, 'proposed', p_notes, v_actor_id
    );

    UPDATE public.bank_statement_lines SET match_status = 'proposed' WHERE id = v_bl.id AND match_status = 'unmatched';
  END LOOP;

  v_result := jsonb_build_object('match_group_id', v_group_id, 'status', 'proposed');
  PERFORM private.save_idempotency(p_company_id, v_actor_id, 'propose_bank_match', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_bank_match(
  p_idempotency_key TEXT,
  p_company_id UUID,
  p_match_group_id UUID,
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
  v_m RECORD;
  v_bl public.bank_statement_lines%ROWTYPE;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'approve_bank_match', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF NOT private.has_company_role(p_company_id, ARRAY['finance_checker','reconciliation_reviewer']) THEN
    RAISE EXCEPTION 'Hanya checker/reviewer yang dapat menyetujui pencocokan mutasi.' USING ERRCODE = '42501';
  END IF;

  FOR v_m IN
    SELECT * FROM public.bank_matches
    WHERE company_id = p_company_id AND match_group_id = p_match_group_id AND status = 'proposed'
    ORDER BY id
    FOR UPDATE
  LOOP
    PERFORM private.assert_maker_checker(v_m.proposed_by, v_actor_id, 'usulan pencocokan mutasi');

    SELECT * INTO v_bl FROM public.bank_statement_lines WHERE id = v_m.bank_statement_line_id FOR UPDATE;
    IF (v_bl.amount - v_bl.matched_amount) < v_m.matched_amount THEN
      RAISE EXCEPTION 'Mutasi % sudah dipakai melebihi saldonya.', v_bl.id USING ERRCODE = '40001';
    END IF;

    UPDATE public.bank_statement_lines
    SET matched_amount = matched_amount + v_m.matched_amount,
        match_status = CASE WHEN (matched_amount + v_m.matched_amount) >= amount THEN 'matched' ELSE 'proposed' END,
        version = version + 1
    WHERE id = v_bl.id;

    UPDATE public.bank_matches
    SET status = 'approved', approved_by = v_actor_id, approved_at = now(), notes = COALESCE(p_notes, notes), version = version + 1
    WHERE id = v_m.id;
  END LOOP;

  v_result := jsonb_build_object('match_group_id', p_match_group_id, 'status', 'approved');
  PERFORM private.save_idempotency(p_company_id, v_actor_id, 'approve_bank_match', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 10. request_receipt_reversal & approve_receipt_reversal
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_receipt_reversal(
  p_idempotency_key TEXT,
  p_receipt_id UUID,
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
  v_r public.receipts%ROWTYPE;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'request_receipt_reversal', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Alasan permintaan pembatalan wajib diisi jelas.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_r FROM public.receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Penerimaan tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT private.has_branch_role(v_r.company_id, v_r.branch_id, ARRAY['finance_maker','finance_checker']) THEN
    RAISE EXCEPTION 'Izin ditolak.' USING ERRCODE = '42501';
  END IF;

  IF v_r.version <> p_expected_version THEN RAISE EXCEPTION 'Konflik versi.' USING ERRCODE = '40001'; END IF;
  IF v_r.status <> 'verified' THEN RAISE EXCEPTION 'Hanya penerimaan terverifikasi yang diajukan reversal.' USING ERRCODE = '22023'; END IF;

  UPDATE public.receipts
  SET status = 'reversal_requested',
      reason = p_reason,
      updated_by = v_actor_id,
      version = version + 1,
      updated_at = now()
  WHERE id = v_r.id;

  PERFORM private.write_audit_event(
    v_r.company_id, v_r.branch_id, v_actor_id, 'receipt.request_reversal', 'receipt', v_r.id,
    jsonb_build_object('status', 'verified'), jsonb_build_object('status', 'reversal_requested'), p_reason
  );

  v_result := jsonb_build_object('receipt_id', v_r.id, 'status', 'reversal_requested', 'version', v_r.version + 1);
  PERFORM private.save_idempotency(v_r.company_id, v_actor_id, 'request_receipt_reversal', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_receipt_reversal(
  p_idempotency_key TEXT,
  p_receipt_id UUID,
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
  v_r public.receipts%ROWTYPE;
  v_alloc_count INTEGER;
  v_refund_count INTEGER;
  v_deposited_amt NUMERIC(20,2);
  v_custody_id UUID;
  v_new_balance NUMERIC(20,2);
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'approve_receipt_reversal', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_r FROM public.receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Penerimaan tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT private.has_branch_role(v_r.company_id, v_r.branch_id, ARRAY['finance_checker','accounting_approver']) THEN
    RAISE EXCEPTION 'Izin ditolak menyetujui reversal.' USING ERRCODE = '42501';
  END IF;

  PERFORM private.assert_maker_checker(v_r.updated_by, v_actor_id, 'permintaan reversal');

  IF v_r.version <> p_expected_version THEN RAISE EXCEPTION 'Konflik versi.' USING ERRCODE = '40001'; END IF;
  IF v_r.status <> 'reversal_requested' THEN RAISE EXCEPTION 'Penerimaan belum dalam status permintaan reversal.' USING ERRCODE = '22023'; END IF;

  -- Cek dependensi alokasi App 2
  SELECT count(*) INTO v_alloc_count
  FROM public.payment_allocations
  WHERE receipt_id = v_r.id AND status IN ('proposed', 'approved');

  IF v_alloc_count > 0 THEN
    RAISE EXCEPTION 'Penerimaan yang sudah dialokasikan ke nota (%) tidak dapat dibalik sebelum alokasi dilepas/dibatalkan secara sah.', v_alloc_count USING ERRCODE = '23503';
  END IF;

  -- Cek dependensi refund
  SELECT count(*) INTO v_refund_count
  FROM public.refund_lines rl
  JOIN public.customer_refunds cr ON cr.id = rl.customer_refund_id
  WHERE rl.receipt_id = v_r.id AND cr.status IN ('submitted', 'approved', 'paid');

  IF v_refund_count > 0 THEN
    RAISE EXCEPTION 'Penerimaan terkait pengembalian dana pelanggan aktif tidak dapat dibalik.' USING ERRCODE = '23503';
  END IF;

  -- Cek jika tunai sudah disetorkan
  IF v_r.receipt_channel = 'cash' THEN
    SELECT COALESCE(deposited_amount, 0), custody_account_id INTO v_deposited_amt, v_custody_id
    FROM public.custody_movement_sources WHERE receipt_id = v_r.id FOR UPDATE;

    IF COALESCE(v_deposited_amt, 0) > 0 THEN
      RAISE EXCEPTION 'Penerimaan tunai yang sudah disetor (%) tidak dapat dibalik sebelum koreksi setoran disahkan.', v_deposited_amt USING ERRCODE = '23503';
    END IF;

    IF v_custody_id IS NOT NULL THEN
      UPDATE public.cash_custody_accounts
      SET verified_balance = verified_balance - v_r.verified_amount,
          version = version + 1,
          updated_at = now()
      WHERE id = v_custody_id
      RETURNING verified_balance INTO v_new_balance;

      INSERT INTO public.custody_movements (
        company_id, branch_id, custody_account_id, collector_staff_id,
        movement_type, direction, amount, balance_after,
        source_type, source_id, effective_date, actor_id
      ) VALUES (
        v_r.company_id, v_r.branch_id, v_custody_id, v_r.actual_collector_id,
        'reversal', 'out', v_r.verified_amount, v_new_balance,
        'receipt', v_r.id, CURRENT_DATE, v_actor_id
      );

      UPDATE public.custody_movement_sources SET remaining_amount = 0 WHERE receipt_id = v_r.id;
    END IF;
  END IF;

  UPDATE public.receipts
  SET status = 'reversed',
      accounting_status = 'reversed',
      reason = p_reason,
      updated_by = v_actor_id,
      approved_by = v_actor_id,
      version = version + 1,
      updated_at = now()
  WHERE id = v_r.id;

  PERFORM private.emit_accounting_event(
    v_r.company_id, v_r.branch_id, 'receipt_reversed', 'receipt', v_r.id, v_r.version + 1,
    CURRENT_DATE,
    jsonb_build_object('receipt_number', v_r.receipt_number, 'reversed_amount', v_r.verified_amount, 'reason', p_reason),
    ARRAY[]::UUID[], v_actor_id, v_r.correlation_id
  );

  PERFORM private.write_audit_event(
    v_r.company_id, v_r.branch_id, v_actor_id, 'receipt.approve_reversal', 'receipt', v_r.id,
    jsonb_build_object('status', 'reversal_requested'), jsonb_build_object('status', 'reversed'), p_reason
  );

  v_result := jsonb_build_object('receipt_id', v_r.id, 'status', 'reversed', 'version', v_r.version + 1);
  PERFORM private.save_idempotency(v_r.company_id, v_actor_id, 'approve_receipt_reversal', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 11. list_collection_dashboard & get_collector_custody_detail
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_collection_dashboard(
  p_company_id UUID,
  p_branch_id UUID DEFAULT NULL,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_transfer_pending JSONB;
  v_cash_reported JSONB;
  v_custody_verified JSONB;
  v_deposit_submitted JSONB;
  v_deposit_accepted JSONB;
  v_open_discrepancies JSONB;
  v_unallocated_funds JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  IF NOT private.is_company_member(p_company_id) THEN RAISE EXCEPTION 'Bukan anggota perusahaan.' USING ERRCODE = '42501'; END IF;

  SELECT jsonb_build_object('count', count(*), 'amount', COALESCE(sum(customer_gross_amount), 0))
  INTO v_transfer_pending
  FROM public.receipts r
  WHERE r.company_id = p_company_id
    AND (p_branch_id IS NULL OR r.branch_id = p_branch_id)
    AND private.has_branch_access(p_company_id, r.branch_id)
    AND r.receipt_channel = 'bank_transfer'
    AND r.status IN ('submitted', 'waiting_verification')
    AND (p_date_from IS NULL OR r.customer_paid_at >= p_date_from)
    AND (p_date_to IS NULL OR r.customer_paid_at <= p_date_to);

  SELECT jsonb_build_object('count', count(*), 'amount', COALESCE(sum(customer_gross_amount), 0))
  INTO v_cash_reported
  FROM public.receipts r
  WHERE r.company_id = p_company_id
    AND (p_branch_id IS NULL OR r.branch_id = p_branch_id)
    AND private.has_branch_access(p_company_id, r.branch_id)
    AND r.receipt_channel = 'cash'
    AND r.status IN ('submitted', 'waiting_verification')
    AND (p_date_from IS NULL OR r.customer_paid_at >= p_date_from)
    AND (p_date_to IS NULL OR r.customer_paid_at <= p_date_to);

  SELECT jsonb_build_object('count', count(*), 'amount', COALESCE(sum(verified_balance), 0))
  INTO v_custody_verified
  FROM public.cash_custody_accounts c
  WHERE c.company_id = p_company_id
    AND (p_branch_id IS NULL OR c.branch_id = p_branch_id)
    AND private.has_branch_access(p_company_id, c.branch_id)
    AND c.verified_balance > 0;

  SELECT jsonb_build_object('count', count(*), 'amount', COALESCE(sum(declared_amount), 0))
  INTO v_deposit_submitted
  FROM public.cash_deposits d
  WHERE d.company_id = p_company_id
    AND (p_branch_id IS NULL OR d.branch_id = p_branch_id)
    AND private.has_branch_access(p_company_id, d.branch_id)
    AND d.status = 'submitted'
    AND (p_date_from IS NULL OR d.deposit_date >= p_date_from)
    AND (p_date_to IS NULL OR d.deposit_date <= p_date_to);

  SELECT jsonb_build_object('count', count(*), 'amount', COALESCE(sum(received_amount), 0))
  INTO v_deposit_accepted
  FROM public.cash_deposits d
  WHERE d.company_id = p_company_id
    AND (p_branch_id IS NULL OR d.branch_id = p_branch_id)
    AND private.has_branch_access(p_company_id, d.branch_id)
    AND d.status IN ('partially_accepted', 'accepted', 'accepted_with_discrepancy')
    AND (p_date_from IS NULL OR d.deposit_date >= p_date_from)
    AND (p_date_to IS NULL OR d.deposit_date <= p_date_to);

  SELECT jsonb_build_object('count', count(*), 'amount', COALESCE(sum(discrepancy_amount), 0))
  INTO v_open_discrepancies
  FROM public.discrepancy_cases dc
  WHERE dc.company_id = p_company_id
    AND (p_branch_id IS NULL OR dc.branch_id = p_branch_id)
    AND private.has_branch_access(p_company_id, dc.branch_id)
    AND dc.status IN ('open', 'investigating', 'pending_approval');

  SELECT jsonb_build_object(
    'count', count(*),
    'amount', COALESCE(sum(r.verified_amount - COALESCE(alloc.allocated, 0) - COALESCE(ref.refunded, 0)), 0)
  )
  INTO v_unallocated_funds
  FROM public.receipts r
  LEFT JOIN (
    SELECT receipt_id, sum(allocated_amount) AS allocated
    FROM public.payment_allocations WHERE status = 'approved' GROUP BY receipt_id
  ) alloc ON alloc.receipt_id = r.id
  LEFT JOIN (
    SELECT rl.receipt_id, sum(rl.amount) AS refunded
    FROM public.refund_lines rl JOIN public.customer_refunds cr ON cr.id = rl.customer_refund_id
    WHERE cr.status IN ('approved', 'paid') GROUP BY rl.receipt_id
  ) ref ON ref.receipt_id = r.id
  WHERE r.company_id = p_company_id
    AND (p_branch_id IS NULL OR r.branch_id = p_branch_id)
    AND private.has_branch_access(p_company_id, r.branch_id)
    AND r.status = 'verified'
    AND (r.verified_amount - COALESCE(alloc.allocated, 0) - COALESCE(ref.refunded, 0)) > 0;

  RETURN jsonb_build_object(
    'transfer_waiting_verification', v_transfer_pending,
    'cash_reported', v_cash_reported,
    'collector_verified_cash', v_custody_verified,
    'deposit_submitted', v_deposit_submitted,
    'deposit_accepted', v_deposit_accepted,
    'open_discrepancies', v_open_discrepancies,
    'unallocated_funds', v_unallocated_funds
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_collector_custody_detail(
  p_company_id UUID,
  p_collector_staff_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_custody public.cash_custody_accounts%ROWTYPE;
  v_sources JSONB;
  v_movements JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  IF NOT private.is_company_member(p_company_id) THEN RAISE EXCEPTION 'Akses ditolak.' USING ERRCODE = '42501'; END IF;

  IF private.has_company_role(p_company_id, ARRAY['collector_optional'])
     AND NOT private.has_company_role(p_company_id, ARRAY['finance_maker','finance_checker','accountant','owner_viewer','system_admin']) THEN
    IF p_collector_staff_id IS DISTINCT FROM private.get_own_staff_id(p_company_id) THEN
      RAISE EXCEPTION 'Penagih hanya dapat melihat saldo custody miliknya sendiri.' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO v_custody
  FROM public.cash_custody_accounts
  WHERE company_id = p_company_id AND collector_staff_id = p_collector_staff_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'receipt_id', s.receipt_id,
    'receipt_number', r.receipt_number,
    'customer_id', r.customer_id,
    'customer_paid_at', r.customer_paid_at,
    'verified_amount', s.verified_amount,
    'deposited_amount', s.deposited_amount,
    'remaining_amount', s.remaining_amount
  ) ORDER BY r.customer_paid_at ASC), '[]'::jsonb)
  INTO v_sources
  FROM public.custody_movement_sources s
  JOIN public.receipts r ON r.id = s.receipt_id
  WHERE s.custody_account_id = v_custody.id AND s.remaining_amount > 0;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'movement_type', m.movement_type,
    'direction', m.direction,
    'amount', m.amount,
    'balance_after', m.balance_after,
    'effective_date', m.effective_date,
    'source_type', m.source_type,
    'source_id', m.source_id,
    'created_at', m.created_at
  ) ORDER BY m.created_at DESC), '[]'::jsonb)
  INTO v_movements
  FROM public.custody_movements m
  WHERE m.custody_account_id = v_custody.id;

  RETURN jsonb_build_object(
    'custody', row_to_json(v_custody),
    'sources', v_sources,
    'movements', v_movements
  );
END;
$$;

-- Restrict RPC execute grants strictly to authenticated users
REVOKE ALL ON FUNCTION public.create_receipt_draft(TEXT,UUID,UUID,TEXT,DATE,DATE,UUID,UUID,BOOLEAN,TEXT,NUMERIC,NUMERIC,NUMERIC,TEXT,TEXT,TEXT,TEXT,UUID,UUID,TEXT,TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_receipt_draft(TEXT,UUID,UUID,TEXT,DATE,DATE,UUID,UUID,BOOLEAN,TEXT,NUMERIC,NUMERIC,NUMERIC,TEXT,TEXT,TEXT,TEXT,UUID,UUID,TEXT,TEXT,TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.submit_receipt(TEXT,UUID,INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_receipt(TEXT,UUID,INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.verify_receipt(TEXT,UUID,INTEGER,TEXT,UUID,TEXT,TEXT,DATE,NUMERIC,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_receipt(TEXT,UUID,INTEGER,TEXT,UUID,TEXT,TEXT,DATE,NUMERIC,TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.reject_receipt(TEXT,UUID,INTEGER,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_receipt(TEXT,UUID,INTEGER,TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.propose_receipt_identity(TEXT,UUID,INTEGER,UUID,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_receipt_identity(TEXT,UUID,INTEGER,UUID,TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.approve_receipt_identity(TEXT,UUID,INTEGER,UUID,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_receipt_identity(TEXT,UUID,INTEGER,UUID,TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.create_cash_deposit(TEXT,UUID,UUID,UUID,TEXT,UUID,DATE,JSONB,BOOLEAN,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_cash_deposit(TEXT,UUID,UUID,UUID,TEXT,UUID,DATE,JSONB,BOOLEAN,TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.submit_cash_deposit(TEXT,UUID,INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_cash_deposit(TEXT,UUID,INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.accept_cash_deposit(TEXT,UUID,INTEGER,NUMERIC,UUID,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_cash_deposit(TEXT,UUID,INTEGER,NUMERIC,UUID,TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.create_internal_fund_transfer(TEXT,UUID,UUID,DATE,UUID,UUID,NUMERIC,TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_internal_fund_transfer(TEXT,UUID,UUID,DATE,UUID,UUID,NUMERIC,TEXT,TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.approve_internal_fund_transfer(TEXT,UUID,INTEGER,UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_internal_fund_transfer(TEXT,UUID,INTEGER,UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.import_bank_statement_preview(TEXT,UUID,UUID,TEXT,TEXT,DATE,DATE,TEXT,TEXT,NUMERIC,NUMERIC,JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_bank_statement_preview(TEXT,UUID,UUID,TEXT,TEXT,DATE,DATE,TEXT,TEXT,NUMERIC,NUMERIC,JSONB) TO authenticated;

REVOKE ALL ON FUNCTION public.commit_bank_statement_import(TEXT,UUID,INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commit_bank_statement_import(TEXT,UUID,INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.propose_bank_match(TEXT,UUID,JSONB,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_bank_match(TEXT,UUID,JSONB,TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.approve_bank_match(TEXT,UUID,UUID,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_bank_match(TEXT,UUID,UUID,TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.request_receipt_reversal(TEXT,UUID,INTEGER,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_receipt_reversal(TEXT,UUID,INTEGER,TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.approve_receipt_reversal(TEXT,UUID,INTEGER,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_receipt_reversal(TEXT,UUID,INTEGER,TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.list_collection_dashboard(UUID,UUID,DATE,DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_collection_dashboard(UUID,UUID,DATE,DATE) TO authenticated;

REVOKE ALL ON FUNCTION public.get_collector_custody_detail(UUID,UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_collector_custody_detail(UUID,UUID) TO authenticated;

INSERT INTO public.schema_migrations (version, description)
VALUES ('0003_finops_app1_rpcs', 'Transactional App 1 RPCs with idempotency, row locking, maker-checker, and atomic accounting events')
ON CONFLICT (version) DO NOTHING;
