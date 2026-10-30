-- Corrige o painel financeiro apos a retirada definitiva da Cakto, organiza a
-- folha mensal dos vendedores e remove dois contratos de homologacao ja
-- cancelados nos provedores externos.

CREATE TABLE IF NOT EXISTS public.seller_monthly_payrolls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES public.internal_users(id) ON DELETE CASCADE,
  competence_month date NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  due_date date NOT NULL,
  base_salary_cents bigint NOT NULL DEFAULT 230000 CHECK (base_salary_cents = 230000),
  commission_cents bigint NOT NULL DEFAULT 0 CHECK (commission_cents >= 0),
  bonus_cents bigint NOT NULL DEFAULT 0 CHECK (bonus_cents >= 0),
  total_cents bigint NOT NULL CHECK (total_cents >= 0),
  paid_amount_cents bigint NOT NULL DEFAULT 0 CHECK (paid_amount_cents >= 0),
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'due', 'overdue', 'paid', 'cancelled')),
  paid_at timestamptz,
  paid_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  payment_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (seller_id, competence_month),
  CHECK (competence_month = date_trunc('month', competence_month)::date),
  CHECK (period_start = competence_month),
  CHECK (period_end = (competence_month + interval '1 month - 1 day')::date),
  CHECK (due_date = (competence_month + interval '1 month + 4 days')::date)
);

CREATE INDEX IF NOT EXISTS seller_monthly_payrolls_competence_idx
  ON public.seller_monthly_payrolls (competence_month DESC, status, due_date);

CREATE TABLE IF NOT EXISTS public.seller_monthly_payroll_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_id uuid NOT NULL REFERENCES public.seller_monthly_payrolls(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('payment_confirmed', 'payment_reopened')),
  previous_status text,
  new_status text NOT NULL,
  amount_cents bigint NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seller_monthly_payroll_events_payroll_idx
  ON public.seller_monthly_payroll_events (payroll_id, created_at DESC);

ALTER TABLE public.seller_monthly_payrolls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_monthly_payroll_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.seller_monthly_payrolls FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.seller_monthly_payroll_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.seller_monthly_payrolls TO authenticated;
GRANT SELECT ON public.seller_monthly_payroll_events TO authenticated;
GRANT ALL ON public.seller_monthly_payrolls, public.seller_monthly_payroll_events TO service_role;

DROP POLICY IF EXISTS seller_monthly_payrolls_finance_read ON public.seller_monthly_payrolls;
CREATE POLICY seller_monthly_payrolls_finance_read
ON public.seller_monthly_payrolls FOR SELECT TO authenticated
USING (public.can_manage_withdrawals(auth.uid(), 'view'));

DROP POLICY IF EXISTS seller_monthly_payroll_events_finance_read ON public.seller_monthly_payroll_events;
CREATE POLICY seller_monthly_payroll_events_finance_read
ON public.seller_monthly_payroll_events FOR SELECT TO authenticated
USING (public.can_manage_withdrawals(auth.uid(), 'view'));

CREATE OR REPLACE FUNCTION public.materialize_seller_monthly_payroll(
  p_month integer DEFAULT NULL,
  p_year integer DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_month integer := coalesce(p_month, extract(month FROM v_today)::integer);
  v_year integer := coalesce(p_year, extract(year FROM v_today)::integer);
  v_competence date;
  v_changed integer := 0;
BEGIN
  IF v_month < 1 OR v_month > 12 OR v_year < 2000 OR v_year > 9999 THEN
    RAISE EXCEPTION 'PAYROLL_INVALID_PERIOD';
  END IF;

  v_competence := make_date(v_year, v_month, 1);
  PERFORM public.materializar_comissoes_vendedor(v_month, v_year);

  INSERT INTO public.seller_monthly_payrolls (
    seller_id,
    competence_month,
    period_start,
    period_end,
    due_date,
    base_salary_cents,
    commission_cents,
    bonus_cents,
    total_cents,
    status
  )
  SELECT
    seller.id,
    v_competence,
    v_competence,
    (v_competence + interval '1 month - 1 day')::date,
    (v_competence + interval '1 month + 4 days')::date,
    230000,
    coalesce(commissions.commission_cents, 0),
    coalesce(commissions.bonus_cents, 0),
    230000 + coalesce(commissions.commission_cents, 0) + coalesce(commissions.bonus_cents, 0),
    CASE
      WHEN v_today > (v_competence + interval '1 month + 4 days')::date THEN 'overdue'
      WHEN v_today = (v_competence + interval '1 month + 4 days')::date THEN 'due'
      ELSE 'scheduled'
    END
  FROM public.internal_users AS seller
  LEFT JOIN LATERAL (
    SELECT
      coalesce(sum(round(commission.commission_amount * 100)::bigint), 0) AS commission_cents,
      coalesce(sum(round(commission.bonus_amount * 100)::bigint), 0) AS bonus_cents
    FROM public.seller_commissions AS commission
    WHERE commission.seller_id = seller.id
      AND commission.month = v_month
      AND commission.year = v_year
      AND commission.status NOT IN ('estornada', 'cancelada')
  ) AS commissions ON true
  WHERE seller.role = 'vendedor'
    AND seller.status = 'ativo'
    AND coalesce(seller.exclude_from_commercial_metrics, false) = false
    AND seller.created_at::date <= (v_competence + interval '1 month - 1 day')::date
  ON CONFLICT (seller_id, competence_month) DO UPDATE SET
    period_start = excluded.period_start,
    period_end = excluded.period_end,
    due_date = excluded.due_date,
    base_salary_cents = excluded.base_salary_cents,
    commission_cents = excluded.commission_cents,
    bonus_cents = excluded.bonus_cents,
    total_cents = excluded.total_cents,
    status = CASE
      WHEN seller_monthly_payrolls.status = 'cancelled' THEN 'cancelled'
      WHEN seller_monthly_payrolls.paid_amount_cents >= excluded.total_cents THEN 'paid'
      WHEN v_today > excluded.due_date THEN 'overdue'
      WHEN v_today = excluded.due_date THEN 'due'
      ELSE 'scheduled'
    END,
    paid_at = CASE
      WHEN seller_monthly_payrolls.paid_amount_cents >= excluded.total_cents
        THEN seller_monthly_payrolls.paid_at
      ELSE NULL
    END,
    updated_at = now();

  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_seller_monthly_payroll(
  p_month integer DEFAULT NULL,
  p_year integer DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  seller_id uuid,
  seller_name text,
  seller_email text,
  seller_type text,
  competence_month date,
  period_start date,
  period_end date,
  due_date date,
  base_salary_cents bigint,
  commission_cents bigint,
  bonus_cents bigint,
  total_cents bigint,
  paid_amount_cents bigint,
  payable_cents bigint,
  status text,
  paid_at timestamptz,
  paid_by_name text,
  payment_notes text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_month integer := coalesce(p_month, extract(month FROM v_today)::integer);
  v_year integer := coalesce(p_year, extract(year FROM v_today)::integer);
  v_competence date;
BEGIN
  IF v_uid IS NULL OR NOT public.can_manage_withdrawals(v_uid, 'view') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYROLL_FORBIDDEN';
  END IF;
  IF v_month < 1 OR v_month > 12 OR v_year < 2000 OR v_year > 9999 THEN
    RAISE EXCEPTION 'PAYROLL_INVALID_PERIOD';
  END IF;

  v_competence := make_date(v_year, v_month, 1);
  PERFORM public.materialize_seller_monthly_payroll(v_month, v_year);

  RETURN QUERY
  SELECT
    payroll.id,
    payroll.seller_id,
    seller.full_name,
    seller.email,
    seller.seller_type,
    payroll.competence_month,
    payroll.period_start,
    payroll.period_end,
    payroll.due_date,
    payroll.base_salary_cents,
    payroll.commission_cents,
    payroll.bonus_cents,
    payroll.total_cents,
    payroll.paid_amount_cents,
    greatest(payroll.total_cents - payroll.paid_amount_cents, 0),
    payroll.status,
    payroll.paid_at,
    payer.nome,
    payroll.payment_notes
  FROM public.seller_monthly_payrolls AS payroll
  JOIN public.internal_users AS seller ON seller.id = payroll.seller_id
  LEFT JOIN public.profiles AS payer ON payer.id = payroll.paid_by
  WHERE payroll.competence_month = v_competence
  ORDER BY
    CASE payroll.status
      WHEN 'overdue' THEN 1 WHEN 'due' THEN 2 WHEN 'scheduled' THEN 3
      WHEN 'paid' THEN 4 ELSE 5
    END,
    seller.full_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_seller_monthly_payroll_paid(
  p_payroll_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_payroll public.seller_monthly_payrolls%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.can_manage_withdrawals(v_uid, 'edit') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYROLL_FORBIDDEN';
  END IF;

  SELECT * INTO v_payroll
  FROM public.seller_monthly_payrolls
  WHERE id = p_payroll_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'PAYROLL_NOT_FOUND'; END IF;
  IF v_payroll.status = 'cancelled' THEN RAISE EXCEPTION 'PAYROLL_CANCELLED'; END IF;
  IF v_today < v_payroll.due_date THEN RAISE EXCEPTION 'PAYROLL_NOT_DUE'; END IF;
  IF v_payroll.paid_amount_cents >= v_payroll.total_cents THEN
    RETURN jsonb_build_object('ok', true, 'id', v_payroll.id, 'already_paid', true);
  END IF;

  UPDATE public.seller_monthly_payrolls
  SET
    paid_amount_cents = total_cents,
    status = 'paid',
    paid_at = now(),
    paid_by = v_uid,
    payment_notes = nullif(btrim(p_notes), ''),
    updated_at = now()
  WHERE id = v_payroll.id;

  INSERT INTO public.seller_monthly_payroll_events (
    payroll_id, actor_user_id, event_type, previous_status, new_status, amount_cents, notes
  ) VALUES (
    v_payroll.id, v_uid, 'payment_confirmed', v_payroll.status, 'paid',
    v_payroll.total_cents - v_payroll.paid_amount_cents, nullif(btrim(p_notes), '')
  );

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_payroll.id,
    'status', 'paid',
    'paid_amount_cents', v_payroll.total_cents
  );
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_seller_monthly_payroll(integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_seller_monthly_payroll(integer, integer)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_seller_monthly_payroll_paid(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.materialize_seller_monthly_payroll(integer, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.list_seller_monthly_payroll(integer, integer)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_seller_monthly_payroll_paid(uuid, text)
  TO authenticated, service_role;

COMMENT ON TABLE public.seller_monthly_payrolls IS
  'Folha mensal dos vendedores NOX: competencia do primeiro ao ultimo dia do mes, fixo de R$ 2.300 mais comissoes/bonus e vencimento no dia 05 seguinte.';

-- O resumo deixa de consultar a integracao Cakto removida em 20261019130000 e
-- passa a expor tambem a folha dos vendedores da competencia atual.
CREATE OR REPLACE FUNCTION public.get_finance_dashboard_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_result jsonb;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_month integer := extract(month FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::integer;
  v_year integer := extract(year FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::integer;
  v_competence date := date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF v_uid IS NULL OR NOT public.can_manage_withdrawals(v_uid, 'view') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='WITHDRAWAL_FORBIDDEN';
  END IF;

  WITH contract_scope AS (
    SELECT DISTINCT c.id, c.policy_status
    FROM public.consultas_credito c
    LEFT JOIN public.apolices a ON a.consulta_id = c.id
    WHERE lower(coalesce(c.policy_status, '')) IN ('issued_pending', 'active')
       OR lower(coalesce(a.status, '')) IN ('pendente', 'pending', 'ativa', 'ativo', 'active')
  ),
  invoice_totals AS (
    SELECT
      coalesce(sum(round(f.valor * 100)::bigint) FILTER (
        WHERE lower(f.status) IN ('paid', 'received', 'paid_via_consolidated')
          AND f.consolidated_item_id IS NULL
      ), 0) AS received_cents,
      coalesce(sum(round(f.valor * 100)::bigint) FILTER (
        WHERE lower(f.status) IN (
          'pending', 'created', 'waiting_payment', 'processing', 'risk_analysis',
          'approved', 'confirmed', 'overdue', 'awaiting_consolidation', 'scheduled'
        )
          AND NOT EXISTS (
            SELECT 1
            FROM public.consolidated_invoice_items ci
            JOIN public.consolidated_invoice_batches cb ON cb.id = ci.batch_id
            WHERE ci.id = f.consolidated_item_id
              AND ci.status = 'active'
              AND cb.status IN ('active', 'partial')
          )
      ), 0) AS pending_cents,
      count(*) FILTER (
        WHERE lower(f.status) IN ('paid', 'received', 'paid_via_consolidated')
          AND f.consolidated_item_id IS NULL
      ) AS received_count
    FROM public.faturas_inquilino f
  ),
  orphan_provider_totals AS (
    SELECT
      coalesce(sum(round(p.value * 100)::bigint) FILTER (
        WHERE lower(p.status) IN ('paid', 'received')
      ), 0) AS received_cents,
      coalesce(sum(round(p.value * 100)::bigint) FILTER (
        WHERE lower(p.status) IN (
          'pending', 'created', 'waiting_payment', 'processing', 'risk_analysis',
          'approved', 'confirmed', 'overdue'
        )
      ), 0) AS pending_cents,
      count(*) FILTER (WHERE lower(p.status) IN ('paid', 'received')) AS received_count
    FROM public.asaas_payments p
    WHERE NOT EXISTS (
      SELECT 1 FROM public.faturas_inquilino f WHERE f.asaas_payment_id = p.id
    )
  ),
  billing_gaps AS (
    SELECT count(*) AS total
    FROM contract_scope cs
    WHERE NOT EXISTS (SELECT 1 FROM public.faturas_inquilino f WHERE f.consulta_id = cs.id)
      AND NOT EXISTS (SELECT 1 FROM public.asaas_payments p WHERE p.consultation_id = cs.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.asaas_subscriptions s
        WHERE s.consultation_id = cs.id AND s.status NOT IN ('cancelled', 'expired')
      )
  ),
  reconciliation_gaps AS (
    SELECT count(DISTINCT operation.consultation_id) AS total
    FROM public.billing_operations operation
    WHERE operation.state IN ('ambiguous', 'failed')
  ),
  seller_payroll_live AS (
    SELECT
      seller.id AS seller_id,
      230000
        + coalesce(sum(round(commission.commission_amount * 100)::bigint), 0)
        + coalesce(sum(round(commission.bonus_amount * 100)::bigint), 0) AS total_cents
    FROM public.internal_users AS seller
    LEFT JOIN public.seller_commissions AS commission
      ON commission.seller_id = seller.id
     AND commission.month = v_month
     AND commission.year = v_year
     AND commission.status NOT IN ('estornada', 'cancelada')
    WHERE seller.role = 'vendedor'
      AND seller.status = 'ativo'
      AND coalesce(seller.exclude_from_commercial_metrics, false) = false
      AND seller.created_at::date <= (v_competence + interval '1 month - 1 day')::date
    GROUP BY seller.id
  ),
  seller_payroll_totals AS (
    SELECT
      count(*) AS seller_count,
      coalesce(sum(live.total_cents), 0) AS total_cents,
      coalesce(sum(least(coalesce(payroll.paid_amount_cents, 0), live.total_cents)), 0) AS paid_cents
    FROM seller_payroll_live AS live
    LEFT JOIN public.seller_monthly_payrolls AS payroll
      ON payroll.seller_id = live.seller_id
     AND payroll.competence_month = v_competence
  )
  SELECT jsonb_build_object(
    'revenue_received_cents',
      invoice_totals.received_cents
      + orphan_provider_totals.received_cents
      + coalesce((SELECT sum(round(total_value * 100)::bigint)
                  FROM public.consolidated_invoice_batches WHERE status = 'paid'), 0)
      + coalesce((SELECT sum(round(received_value * 100)::bigint)
                  FROM public.consolidated_invoice_batches WHERE status = 'partial'), 0),
    'revenue_pending_cents',
      invoice_totals.pending_cents
      + orphan_provider_totals.pending_cents
      + coalesce((SELECT sum(round(
                    CASE WHEN status = 'partial'
                      THEN greatest(total_value - received_value, 0)
                      ELSE total_value END * 100
                  )::bigint) FROM public.consolidated_invoice_batches
                  WHERE status IN ('active','partial')), 0),
    'commissions_paid_cents',
      coalesce((SELECT sum(amount_cents) FROM public.withdrawal_requests WHERE status='PAID'), 0),
    'commissions_payable_cents',
      coalesce((SELECT sum(amount_cents) FROM public.comissoes WHERE status='AVAILABLE'), 0)
      + coalesce((SELECT sum(amount_cents) FROM public.withdrawal_commissions WHERE active), 0),
    'open_withdrawals',
      (SELECT count(*) FROM public.withdrawal_requests
       WHERE status IN ('PENDING_REVIEW','APPROVED','AWAITING_PAYMENT','MANUAL_REVIEW')),
    'pending_review_withdrawals',
      (SELECT count(*) FROM public.withdrawal_requests WHERE status='PENDING_REVIEW'),
    'paid_withdrawals',
      (SELECT count(*) FROM public.withdrawal_requests WHERE status='PAID'),
    'commission_count', (SELECT count(*) FROM public.comissoes),
    'payment_count',
      invoice_totals.received_count
      + orphan_provider_totals.received_count
      + (SELECT count(*) FROM public.consolidated_invoice_batches WHERE status='paid'),
    'active_contracts',
      (SELECT count(*) FROM contract_scope WHERE lower(coalesce(policy_status, '')) = 'active'),
    'pending_contracts',
      (SELECT count(*) FROM contract_scope WHERE lower(coalesce(policy_status, '')) <> 'active'),
    'contracts_missing_billing', (SELECT total FROM billing_gaps),
    'reconciliation_required', (SELECT total FROM reconciliation_gaps),
    'seller_payroll_count', seller_payroll_totals.seller_count,
    'seller_payroll_total_cents', seller_payroll_totals.total_cents,
    'seller_payroll_paid_cents', seller_payroll_totals.paid_cents,
    'seller_payroll_payable_cents',
      greatest(seller_payroll_totals.total_cents - seller_payroll_totals.paid_cents, 0),
    'seller_payroll_due_date', (v_competence + interval '1 month + 4 days')::date,
    'seller_payroll_period_end', (v_competence + interval '1 month - 1 day')::date,
    'seller_payroll_is_overdue',
      v_today > (v_competence + interval '1 month + 4 days')::date
      AND seller_payroll_totals.total_cents > seller_payroll_totals.paid_cents
  ) INTO v_result
  FROM invoice_totals, orphan_provider_totals, seller_payroll_totals;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_finance_dashboard_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_finance_dashboard_summary() TO authenticated, service_role;

-- Os recursos externos destes dois contratos foram previamente confirmados em
-- estado cancelled. A transacao aborta caso apareca qualquer compromisso ativo.
DO $$
DECLARE
  v_consultation_count integer;
  v_policy_count integer;
BEGIN
  CREATE TEMP TABLE _test_policies_to_remove ON COMMIT DROP AS
  SELECT id, consulta_id
  FROM public.apolices
  WHERE numero IN ('NOX-2026-DE833CD037', 'NOX-2026-ECD4596FBF');

  CREATE TEMP TABLE _test_consultations_to_remove ON COMMIT DROP AS
  SELECT DISTINCT consulta_id AS id FROM _test_policies_to_remove;

  SELECT count(*) INTO v_policy_count FROM _test_policies_to_remove;
  SELECT count(*) INTO v_consultation_count FROM _test_consultations_to_remove;

  IF v_policy_count <> 2 OR v_consultation_count <> 2 THEN
    RAISE EXCEPTION 'TEST_CONTRACT_SCOPE_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.asaas_payments
    WHERE consultation_id IN (SELECT id FROM _test_consultations_to_remove)
      AND lower(coalesce(status, '')) NOT IN ('cancelled', 'canceled', 'cancelado')
  ) THEN
    RAISE EXCEPTION 'TEST_CONTRACT_HAS_ACTIVE_ASAAS_PAYMENT';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.contract_signatures
    WHERE consultation_id IN (SELECT id FROM _test_consultations_to_remove)
      AND lower(coalesce(status, '')) NOT IN ('cancelled', 'canceled', 'cancelado')
  ) THEN
    RAISE EXCEPTION 'TEST_CONTRACT_HAS_ACTIVE_SIGNATURE';
  END IF;

  CREATE TEMP TABLE _test_invoices_to_remove ON COMMIT DROP AS
  SELECT id FROM public.faturas_inquilino
  WHERE consulta_id IN (SELECT id FROM _test_consultations_to_remove)
     OR apolice_id IN (SELECT id FROM _test_policies_to_remove);

  CREATE TEMP TABLE _test_signatures_to_remove ON COMMIT DROP AS
  SELECT id FROM public.contract_signatures
  WHERE consultation_id IN (SELECT id FROM _test_consultations_to_remove)
     OR policy_id IN (SELECT id FROM _test_policies_to_remove);

  DELETE FROM public.financial_notifications
  WHERE invoice_id IN (SELECT id FROM _test_invoices_to_remove);
  DELETE FROM public.payment_reissue_requests
  WHERE invoice_id IN (SELECT id FROM _test_invoices_to_remove);
  DELETE FROM public.whatsapp_billing_requests
  WHERE invoice_id IN (SELECT id FROM _test_invoices_to_remove);
  DELETE FROM public.consolidated_invoice_items
  WHERE fatura_id IN (SELECT id FROM _test_invoices_to_remove)
     OR consulta_id IN (SELECT id FROM _test_consultations_to_remove);

  DELETE FROM public.contract_notification_deliveries
  WHERE contract_signature_id IN (SELECT id FROM _test_signatures_to_remove);
  DELETE FROM public.contract_signature_events
  WHERE contract_signature_id IN (SELECT id FROM _test_signatures_to_remove);
  DELETE FROM public.documentos_proposta
  WHERE consulta_id IN (SELECT id FROM _test_consultations_to_remove)
     OR apolice_id IN (SELECT id FROM _test_policies_to_remove)
     OR contract_signature_id IN (SELECT id FROM _test_signatures_to_remove);
  DELETE FROM public.documentos_contrato
  WHERE apolice_id IN (SELECT id FROM _test_policies_to_remove);
  DELETE FROM public.contract_signatures
  WHERE id IN (SELECT id FROM _test_signatures_to_remove);

  DELETE FROM public.withdrawal_commissions
  WHERE contract_id IN (SELECT id FROM _test_policies_to_remove)
     OR commission_id IN (
       SELECT id FROM public.comissoes
       WHERE contrato_id IN (SELECT id FROM _test_policies_to_remove)
     );
  DELETE FROM public.commission_financial_ledger
  WHERE contract_id IN (SELECT id FROM _test_policies_to_remove)
     OR commission_id IN (
       SELECT id FROM public.comissoes
       WHERE contrato_id IN (SELECT id FROM _test_policies_to_remove)
     );
  DELETE FROM public.commission_release_events
  WHERE contract_id IN (SELECT id FROM _test_policies_to_remove)
     OR invoice_id IN (SELECT id FROM _test_invoices_to_remove);
  DELETE FROM public.seller_commissions
  WHERE contract_id IN (SELECT id FROM _test_policies_to_remove)
     OR apolice_id IN (SELECT id FROM _test_policies_to_remove);
  DELETE FROM public.comissoes
  WHERE contrato_id IN (SELECT id FROM _test_policies_to_remove);
  DELETE FROM public.seller_referral_rewards
  WHERE policy_id IN (SELECT id FROM _test_policies_to_remove);

  DELETE FROM public.faturas_inquilino WHERE id IN (SELECT id FROM _test_invoices_to_remove);
  DELETE FROM public.mensalidades
  WHERE apolice_id IN (SELECT id FROM _test_policies_to_remove);
  DELETE FROM public.asaas_payments
  WHERE consultation_id IN (SELECT id FROM _test_consultations_to_remove)
     OR proposal_id IN (SELECT id FROM _test_consultations_to_remove);
  DELETE FROM public.asaas_subscriptions
  WHERE consultation_id IN (SELECT id FROM _test_consultations_to_remove);
  DELETE FROM public.billing_operations
  WHERE consultation_id IN (SELECT id FROM _test_consultations_to_remove);
  DELETE FROM public.loft_proposal_cancellations
  WHERE consultation_id IN (SELECT id FROM _test_consultations_to_remove);
  DELETE FROM public.contract_signature_superseded_documents
  WHERE consultation_id IN (SELECT id FROM _test_consultations_to_remove);
  DELETE FROM public.directd_credit_requests
  WHERE consultation_id IN (SELECT id FROM _test_consultations_to_remove);
  UPDATE public.directd_credit_requests
  SET reused_from_consultation_id = NULL, reused_at = NULL
  WHERE reused_from_consultation_id IN (SELECT id FROM _test_consultations_to_remove);
  CREATE TEMP TABLE _test_automation_errors_to_remove ON COMMIT DROP AS
  SELECT id FROM public.automation_errors
  WHERE simulation_id IN (SELECT id FROM _test_consultations_to_remove);
  CREATE TEMP TABLE _test_repair_jobs_to_remove ON COMMIT DROP AS
  SELECT id FROM public.repair_jobs
  WHERE error_id IN (SELECT id FROM _test_automation_errors_to_remove);
  DELETE FROM public.repair_steps
  WHERE job_id IN (SELECT id FROM _test_repair_jobs_to_remove);
  DELETE FROM public.repair_locks
  WHERE job_id IN (SELECT id FROM _test_repair_jobs_to_remove);
  UPDATE public.automation_errors
  SET current_repair_job_id = NULL
  WHERE id IN (SELECT id FROM _test_automation_errors_to_remove);
  DELETE FROM public.repair_jobs
  WHERE id IN (SELECT id FROM _test_repair_jobs_to_remove);
  DELETE FROM public.automation_errors
  WHERE id IN (SELECT id FROM _test_automation_errors_to_remove);
  DELETE FROM public.marketing_conversion_events
  WHERE source_id IN (SELECT id FROM _test_consultations_to_remove);
  DELETE FROM public.proposta_historico
  WHERE consulta_id IN (SELECT id FROM _test_consultations_to_remove);

  DELETE FROM public.apolices WHERE id IN (SELECT id FROM _test_policies_to_remove);
  DELETE FROM public.consultas_credito WHERE id IN (SELECT id FROM _test_consultations_to_remove);
END;
$$;
