-- Central financeira administrativa: contratos faturaveis, totais canonicos e
-- rede de seguranca para conciliacao com o Asaas.

CREATE OR REPLACE FUNCTION public.get_finance_dashboard_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_uid uuid := auth.uid(); v_result jsonb;
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
    WHERE NOT EXISTS (
      SELECT 1 FROM public.faturas_inquilino f WHERE f.consulta_id = cs.id
    )
      AND NOT EXISTS (
        SELECT 1 FROM public.asaas_payments p WHERE p.consultation_id = cs.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.asaas_subscriptions s
        WHERE s.consultation_id = cs.id
          AND s.status NOT IN ('cancelled', 'expired')
      )
  ),
  reconciliation_gaps AS (
    SELECT count(DISTINCT operation.consultation_id) AS total
    FROM public.billing_operations operation
    WHERE operation.state IN ('ambiguous', 'failed')
  )
  SELECT jsonb_build_object(
    'revenue_received_cents',
      invoice_totals.received_cents
      + orphan_provider_totals.received_cents
      + coalesce((SELECT sum(round(total_value * 100)::bigint)
                  FROM public.consolidated_invoice_batches WHERE status = 'paid'), 0)
      + coalesce((SELECT sum(round(received_value * 100)::bigint)
                  FROM public.consolidated_invoice_batches WHERE status = 'partial'), 0)
      + coalesce((SELECT sum(round(amount * 100)::bigint) FROM public.cakto_payments
                  WHERE lower(status) IN ('paid','pago','approved','completed','confirmed')), 0),
    'revenue_pending_cents',
      invoice_totals.pending_cents
      + orphan_provider_totals.pending_cents
      + coalesce((SELECT sum(round(
                    CASE WHEN status = 'partial'
                      THEN greatest(total_value - received_value, 0)
                      ELSE total_value END * 100
                  )::bigint) FROM public.consolidated_invoice_batches
                  WHERE status IN ('active','partial')), 0)
      + coalesce((SELECT sum(round(amount * 100)::bigint) FROM public.cakto_payments
                  WHERE lower(status) IN ('pending','pendente','created','waiting_payment')), 0),
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
      + (SELECT count(*) FROM public.consolidated_invoice_batches WHERE status='paid')
      + (SELECT count(*) FROM public.cakto_payments
         WHERE lower(status) IN ('paid','pago','approved','completed','confirmed')),
    'active_contracts',
      (SELECT count(*) FROM contract_scope WHERE lower(coalesce(policy_status, '')) = 'active'),
    'pending_contracts',
      (SELECT count(*) FROM contract_scope WHERE lower(coalesce(policy_status, '')) <> 'active'),
    'contracts_missing_billing', (SELECT total FROM billing_gaps),
    'reconciliation_required', (SELECT total FROM reconciliation_gaps)
  ) INTO v_result
  FROM invoice_totals, orphan_provider_totals;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_contract_billing_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_uid uuid := auth.uid(); v_result jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.can_manage_withdrawals(v_uid, 'view') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='WITHDRAWAL_FORBIDDEN';
  END IF;

  WITH latest_policy AS (
    SELECT DISTINCT ON (a.consulta_id)
      a.consulta_id, a.id, a.numero, a.status, a.vigencia_inicio, a.vigencia_fim
    FROM public.apolices a
    ORDER BY a.consulta_id, a.updated_at DESC NULLS LAST, a.created_at DESC, a.id DESC
  ),
  latest_subscription AS (
    SELECT DISTINCT ON (s.consultation_id)
      s.consultation_id, s.id, s.asaas_subscription_id, s.status,
      s.payment_status, s.payment_responsible,
      s.next_due_date, s.provider_event_at
    FROM public.asaas_subscriptions s
    ORDER BY s.consultation_id, s.created_at DESC, s.id DESC
  ),
  invoice_stats AS (
    SELECT
      f.consulta_id,
      count(*) AS invoice_count,
      count(*) FILTER (WHERE lower(f.status) IN (
        'pending','created','waiting_payment','processing','risk_analysis','approved',
          'confirmed','awaiting_consolidation','scheduled'
      )) AS pending_count,
      count(*) FILTER (WHERE lower(f.status) = 'overdue') AS overdue_count,
      count(*) FILTER (WHERE lower(f.status) IN ('paid','received','paid_via_consolidated')) AS paid_count,
      count(*) FILTER (
        WHERE lower(f.status) IN (
          'pending','created','waiting_payment','processing','risk_analysis','approved',
          'confirmed','overdue'
        )
          AND f.asaas_payment_id IS NULL
          AND f.consolidated_item_id IS NULL
      ) AS awaiting_provider_count,
      coalesce(sum(round(f.valor * 100)::bigint) FILTER (
        WHERE lower(f.status) IN ('paid','received','paid_via_consolidated')
      ), 0) AS received_cents,
      coalesce(sum(round(f.valor * 100)::bigint) FILTER (
        WHERE lower(f.status) IN (
          'pending','created','waiting_payment','processing','risk_analysis','approved',
          'confirmed','overdue','awaiting_consolidation','scheduled'
        )
      ), 0) AS outstanding_cents,
      min(f.vencimento) FILTER (WHERE lower(f.status) IN (
        'pending','created','waiting_payment','processing','risk_analysis','approved',
        'confirmed','overdue','awaiting_consolidation','scheduled'
      )) AS next_due_date,
      max(f.provider_event_at) AS last_provider_event_at
    FROM public.faturas_inquilino f
    GROUP BY f.consulta_id
  ),
  payment_stats AS (
    SELECT p.consultation_id, count(*) AS provider_payment_count,
           max(p.provider_event_at) AS last_provider_event_at
    FROM public.asaas_payments p
    GROUP BY p.consultation_id
  ),
  operation_stats AS (
    SELECT operation.consultation_id,
           count(*) FILTER (WHERE operation.state IN ('ambiguous','failed')) AS issue_count
    FROM public.billing_operations operation
    GROUP BY operation.consultation_id
  ),
  rows AS (
    SELECT
      c.id AS consultation_id,
      lp.id AS policy_id,
      lp.numero AS contract_number,
      coalesce(lp.status, c.policy_status, 'pendente') AS contract_status,
      c.policy_status,
      c.payment_state,
      c.signature_status,
      c.tenant_name,
      c.tenant_document,
      c.property_address,
      c.contract_period_months,
      c.insurance_payment_method AS payment_method,
      coalesce(ls.payment_responsible, CASE
        WHEN c.payment_type = 'imobiliaria' OR c.billing_responsible_role = 'imobiliaria'
          THEN 'agency' ELSE 'tenant' END) AS payment_responsible,
      ls.asaas_subscription_id,
      ls.status AS subscription_status,
      coalesce(inv.invoice_count, 0) AS invoice_count,
      coalesce(inv.pending_count, 0) AS pending_count,
      coalesce(inv.overdue_count, 0) AS overdue_count,
      coalesce(inv.paid_count, 0) AS paid_count,
      coalesce(inv.received_cents, 0) AS received_cents,
      coalesce(inv.outstanding_cents, 0) AS outstanding_cents,
      coalesce(inv.next_due_date, ls.next_due_date) AS next_due_date,
      greatest(inv.last_provider_event_at, pay.last_provider_event_at, ls.provider_event_at) AS last_synced_at,
      CASE
        WHEN coalesce(op.issue_count, 0) > 0 THEN 'reconciliation_required'
        WHEN coalesce(inv.invoice_count, 0) = 0
          AND coalesce(pay.provider_payment_count, 0) = 0
          AND ls.id IS NULL THEN 'awaiting_billing'
        WHEN coalesce(inv.awaiting_provider_count, 0) > 0 THEN 'awaiting_asaas'
        WHEN coalesce(inv.overdue_count, 0) > 0 THEN 'overdue'
        WHEN coalesce(inv.pending_count, 0) > 0 THEN 'pending'
        WHEN coalesce(inv.paid_count, 0) > 0 THEN 'paid'
        ELSE 'ready'
      END AS billing_status
    FROM public.consultas_credito c
    LEFT JOIN latest_policy lp ON lp.consulta_id = c.id
    LEFT JOIN latest_subscription ls ON ls.consultation_id = c.id
    LEFT JOIN invoice_stats inv ON inv.consulta_id = c.id
    LEFT JOIN payment_stats pay ON pay.consultation_id = c.id
    LEFT JOIN operation_stats op ON op.consultation_id = c.id
    WHERE lower(coalesce(c.policy_status, '')) IN ('issued_pending', 'active')
       OR lower(coalesce(lp.status, '')) IN ('pendente', 'pending', 'ativa', 'ativo', 'active')
       OR coalesce(inv.invoice_count, 0) > 0
       OR coalesce(pay.provider_payment_count, 0) > 0
       OR ls.id IS NOT NULL
  )
  SELECT coalesce(jsonb_agg(to_jsonb(rows) ORDER BY
    CASE billing_status
      WHEN 'reconciliation_required' THEN 1
      WHEN 'awaiting_billing' THEN 2
      WHEN 'awaiting_asaas' THEN 3
      WHEN 'overdue' THEN 4
      WHEN 'pending' THEN 5
      ELSE 6
    END,
    next_due_date NULLS LAST,
    tenant_name
  ), '[]'::jsonb)
  INTO v_result
  FROM rows;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_contract_billing_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_contract_billing_overview() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_finance_dashboard_summary() TO authenticated, service_role;

-- O webhook permanece o mecanismo principal. Esta agenda apenas consulta o
-- provedor periodicamente para reparar eventos perdidos ou filas interrompidas.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    PERFORM cron.unschedule('reconciliacao-financeira-asaas')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconciliacao-financeira-asaas');

    PERFORM cron.schedule(
      'reconciliacao-financeira-asaas',
      '17 */6 * * *',
      $cron$
      SELECT net.http_post(
        url := 'https://njheoytyidsghittjilr.supabase.co/functions/v1/asaas-reconcile-billing',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_notifications_secret')
        ),
        body := '{"limit":60}'::jsonb
      );
      $cron$
    );
  END IF;
END $$;

COMMENT ON FUNCTION public.get_admin_contract_billing_overview() IS
  'Visao unica de contratos ativos/pendentes, faturas locais e recursos Asaas para site e aplicativo.';
