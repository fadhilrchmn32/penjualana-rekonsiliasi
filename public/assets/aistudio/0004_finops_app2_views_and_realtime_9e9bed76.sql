-- ==============================================================================
-- FINOPS_SHARED_V1 — Migration 0004: Handoff Views (App 2/3) & Realtime
-- Semua view memakai security_invoker = true agar RLS tetap berlaku penuh.
-- ==============================================================================

CREATE OR REPLACE VIEW public.v_app2_allocatable_receipts
WITH (security_invoker = true) AS
SELECT
  r.id AS receipt_id,
  r.company_id,
  r.branch_id,
  r.receipt_number,
  r.receipt_channel,
  r.customer_id,
  c.cust_id,
  c.name AS customer_name,
  r.is_unknown_identity,
  r.sender_name_raw,
  r.customer_paid_at,
  r.bank_value_date,
  r.verified_at,
  r.currency,
  r.customer_gross_amount,
  r.verified_amount,
  COALESCE(alloc.allocated_amount, 0)::NUMERIC(20,2) AS allocated_amount,
  COALESCE(ref.refunded_amount, 0)::NUMERIC(20,2) AS refunded_amount,
  (r.verified_amount - COALESCE(alloc.allocated_amount, 0) - COALESCE(ref.refunded_amount, 0))::NUMERIC(20,2) AS available_to_allocate,
  r.optional_invoice_ref,
  r.status,
  r.deposit_status,
  r.reconciliation_status,
  r.accounting_status,
  r.version
FROM public.receipts r
LEFT JOIN public.customers c ON c.id = r.customer_id
LEFT JOIN (
  SELECT receipt_id, SUM(allocated_amount) AS allocated_amount
  FROM public.payment_allocations
  WHERE status = 'approved'
  GROUP BY receipt_id
) alloc ON alloc.receipt_id = r.id
LEFT JOIN (
  SELECT rl.receipt_id, SUM(rl.amount) AS refunded_amount
  FROM public.refund_lines rl
  JOIN public.customer_refunds cr ON cr.id = rl.customer_refund_id
  WHERE cr.status IN ('approved', 'paid')
  GROUP BY rl.receipt_id
) ref ON ref.receipt_id = r.id
WHERE r.status IN ('waiting_verification', 'verified', 'rejected');

REVOKE ALL ON public.v_app2_allocatable_receipts FROM PUBLIC, anon;
GRANT SELECT ON public.v_app2_allocatable_receipts TO authenticated;

-- Realtime: hanya untuk invalidasi cache pada tabel operasional App 1
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.receipts;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cash_deposits;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cash_custody_accounts;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.discrepancy_cases;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.accounting_events;
  END IF;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

INSERT INTO public.schema_migrations (version, description)
VALUES ('0004_finops_app2_views_and_realtime', 'Security-invoker App 2 handoff view and explicit Realtime publication')
ON CONFLICT (version) DO NOTHING;
