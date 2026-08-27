-- Dashboard do proprietario: uma unica leitura autenticada para site e app.
--
-- O vinculo canonico do proprietario nao e a coluna legada
-- apolices.proprietario_profile_id (normalmente vazia), mas sim:
-- profiles -> proprietarios -> imoveis -> consultas_credito -> apolices.
-- Esta migration passa a reconhecer esse vinculo na autorizacao das apolices
-- e concentra os agregados do dashboard em uma RPC SECURITY DEFINER que nunca
-- aceita um id de usuario vindo do cliente.

CREATE OR REPLACE FUNCTION public.can_view_policy(_uid uuid, _policy_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.apolices a
    LEFT JOIN public.consultas_credito q ON q.id = a.consulta_id
    LEFT JOIN public.imoveis im ON im.id = q.imovel_id
    LEFT JOIN public.proprietarios prop ON prop.id = im.proprietario_id
    WHERE a.id = _policy_id
      AND (
        a.corretor_profile_id = _uid
        OR a.imobiliaria_profile_id = _uid
        OR a.proprietario_profile_id = _uid
        OR prop.profile_id = _uid
        OR q.profile_id_solicitante = _uid
        OR q.tenant_user_id = _uid
        OR q.billing_responsible_user_id = _uid
        OR (
          q.profile_id_solicitante IS NOT NULL
          AND public.eh_dono_ou_imobiliaria_da_consulta(q.profile_id_solicitante)
        )
        OR public.can_manage_withdrawals(_uid, 'view')
        OR EXISTS (
          SELECT 1
          FROM public.profiles p
          WHERE p.id = _uid AND p.role::text IN ('analista', 'juridico')
        )
        OR public.has_internal_role(_uid, 'juridico'::public.internal_role)
      )
  )
$$;

REVOKE ALL ON FUNCTION public.can_view_policy(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_policy(uuid, uuid) TO authenticated, service_role;

-- Documentos do contrato passam a usar a mesma autorizacao canonica.
DROP POLICY IF EXISTS "Vinculados à apolice podem ver documentos" ON public.documentos_contrato;
CREATE POLICY "Policy participants read contract documents"
  ON public.documentos_contrato
  FOR SELECT
  TO authenticated
  USING (public.can_view_policy(auth.uid(), apolice_id));
REVOKE SELECT ON public.documentos_contrato FROM anon;

-- Os contratos assinados do fluxo atual ficam em documentos_proposta.
-- O proprietario precisa enxergar somente os arquivos das suas apolices.
DROP POLICY IF EXISTS "Policy participants read proposal documents" ON public.documentos_proposta;
CREATE POLICY "Policy participants read proposal documents"
  ON public.documentos_proposta
  FOR SELECT
  TO authenticated
  USING (
    apolice_id IS NOT NULL
    AND public.can_view_policy(auth.uid(), apolice_id)
  );

-- A tela de recebimentos tambem precisa reconhecer o proprietario do imovel.
DROP POLICY IF EXISTS "Owner reads property invoices" ON public.faturas_inquilino;
CREATE POLICY "Owner reads property invoices"
  ON public.faturas_inquilino
  FOR SELECT
  TO authenticated
  USING (
    (apolice_id IS NOT NULL AND public.can_view_policy(auth.uid(), apolice_id))
    OR EXISTS (
      SELECT 1
      FROM public.consultas_credito q
      JOIN public.imoveis im ON im.id = q.imovel_id
      JOIN public.proprietarios prop ON prop.id = im.proprietario_id
      WHERE q.id = faturas_inquilino.consulta_id
        AND prop.profile_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.get_my_owner_dashboard(p_months integer DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_months integer := greatest(3, least(coalesce(p_months, 12), 12));
  v_today date := timezone('America/Sao_Paulo', now())::date;
  v_current_month date := date_trunc('month', timezone('America/Sao_Paulo', now()))::date;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'OWNER_DASHBOARD_UNAUTHENTICATED';
  END IF;

  SELECT lower(p.role::text)
  INTO v_role
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_role IS DISTINCT FROM 'proprietario' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'OWNER_DASHBOARD_FORBIDDEN';
  END IF;

  WITH
  owner_properties AS (
    SELECT
      im.id,
      im.valor_aluguel,
      im.endereco,
      im.logradouro,
      im.numero,
      im.bairro,
      im.cidade,
      im.estado,
      coalesce(
        nullif(trim(im.endereco), ''),
        nullif(trim(concat_ws(', ', nullif(trim(im.logradouro), ''), nullif(trim(im.numero), ''))), ''),
        'Imovel ' || left(im.id::text, 8)
      ) AS property_name
    FROM public.imoveis im
    JOIN public.proprietarios prop ON prop.id = im.proprietario_id
    WHERE prop.profile_id = v_uid
  ),
  owner_policies AS (
    SELECT DISTINCT
      a.id,
      a.numero,
      a.status,
      a.vigencia_inicio,
      a.vigencia_fim,
      a.created_at,
      a.updated_at,
      q.id AS consultation_id,
      q.imovel_id AS property_id,
      q.inquilino_id,
      coalesce(q.valor_aluguel, q.rent_value, op.valor_aluguel, 0) AS rent_value,
      op.property_name,
      op.bairro,
      op.cidade,
      op.estado,
      iq.nome AS tenant_name
    FROM public.apolices a
    JOIN public.consultas_credito q ON q.id = a.consulta_id
    LEFT JOIN owner_properties op ON op.id = q.imovel_id
    LEFT JOIN public.inquilinos iq ON iq.id = q.inquilino_id
    WHERE op.id IS NOT NULL OR a.proprietario_profile_id = v_uid
  ),
  receipt_events AS (
    -- Fonte atual: parcelas da fatura do inquilino. Apenas baixa efetiva.
    SELECT
      'invoice:' || f.id::text AS id,
      f.apolice_id AS policy_id,
      op.property_id,
      op.property_name,
      f.valor::numeric AS amount,
      timezone('America/Sao_Paulo', f.pago_em)::date AS paid_on,
      f.pago_em AS occurred_at,
      coalesce(f.numero_parcela, 1) AS installment_number
    FROM public.faturas_inquilino f
    JOIN owner_policies op
      ON op.id = f.apolice_id OR (f.apolice_id IS NULL AND op.consultation_id = f.consulta_id)
    WHERE lower(coalesce(f.status, '')) IN ('paid', 'pago', 'received', 'paid_via_consolidated')
      AND f.pago_em IS NOT NULL

    UNION ALL

    -- Compatibilidade com contratos antigos que usam mensalidades. Evita
    -- duplicar a mesma parcela quando ela ja foi materializada em faturas.
    SELECT
      'monthly:' || m.id::text,
      m.apolice_id,
      op.property_id,
      op.property_name,
      m.valor::numeric,
      timezone('America/Sao_Paulo', m.data_pagamento)::date,
      m.data_pagamento,
      coalesce(m.numero_parcela, 1)
    FROM public.mensalidades m
    JOIN owner_policies op ON op.id = m.apolice_id
    WHERE lower(coalesce(m.status, '')) IN ('paid', 'pago', 'received')
      AND m.data_pagamento IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.faturas_inquilino f
        WHERE f.apolice_id = m.apolice_id
          AND coalesce(f.numero_parcela, 1) = coalesce(m.numero_parcela, 1)
      )

    UNION ALL

    -- Pagamentos avulsos do Asaas que nao geraram uma linha em faturas.
    SELECT
      'asaas:' || pay.id::text,
      op.id,
      op.property_id,
      op.property_name,
      pay.value::numeric,
      timezone('America/Sao_Paulo', pay.received_at)::date,
      pay.received_at,
      1
    FROM public.asaas_payments pay
    JOIN owner_policies op ON op.consultation_id = pay.consultation_id
    WHERE lower(coalesce(pay.status, '')) IN ('paid', 'received')
      AND pay.received_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.faturas_inquilino f WHERE f.asaas_payment_id = pay.id
      )
  ),
  month_series AS (
    SELECT generate_series(
      v_current_month - ((v_months - 1) * interval '1 month'),
      v_current_month,
      interval '1 month'
    )::date AS month_start
  ),
  monthly_revenue AS (
    SELECT
      ms.month_start,
      coalesce(sum(re.amount), 0)::numeric AS amount
    FROM month_series ms
    LEFT JOIN receipt_events re
      ON re.paid_on >= ms.month_start
      AND re.paid_on < (ms.month_start + interval '1 month')::date
    GROUP BY ms.month_start
    ORDER BY ms.month_start
  ),
  current_month_revenue AS (
    SELECT coalesce(sum(amount), 0)::numeric AS amount
    FROM receipt_events
    WHERE paid_on >= v_current_month
      AND paid_on < (v_current_month + interval '1 month')::date
  ),
  previous_month_revenue AS (
    SELECT coalesce(sum(amount), 0)::numeric AS amount
    FROM receipt_events
    WHERE paid_on >= (v_current_month - interval '1 month')::date
      AND paid_on < v_current_month
  ),
  year_revenue AS (
    SELECT coalesce(sum(amount), 0)::numeric AS amount
    FROM receipt_events
    WHERE paid_on >= date_trunc('year', v_today)::date
      AND paid_on <= v_today
  ),
  property_revenue AS (
    SELECT
      property_id,
      coalesce(property_name, 'Imovel sem endereco') AS property_name,
      sum(amount)::numeric AS amount
    FROM receipt_events
    WHERE paid_on >= v_current_month
      AND paid_on < (v_current_month + interval '1 month')::date
    GROUP BY property_id, property_name
    ORDER BY amount DESC, property_name
  ),
  active_policies AS (
    SELECT *
    FROM owner_policies
    WHERE lower(coalesce(status, '')) IN ('ativa', 'active')
  ),
  contract_rows AS (
    SELECT
      ap.id,
      ap.numero,
      ap.property_id,
      coalesce(ap.property_name, 'Imovel sem endereco') AS property_name,
      concat_ws(', ', nullif(ap.bairro, ''), nullif(ap.cidade, ''), nullif(ap.estado, '')) AS location,
      coalesce(ap.tenant_name, 'Inquilino nao informado') AS tenant_name,
      ap.rent_value,
      ap.status,
      coalesce(
        (
          SELECT min(f.vencimento)
          FROM public.faturas_inquilino f
          WHERE f.apolice_id = ap.id
            AND lower(coalesce(f.status, '')) NOT IN (
              'paid', 'pago', 'received', 'paid_via_consolidated', 'cancelled', 'cancelado'
            )
        ),
        (
          SELECT min(m.data_vencimento)
          FROM public.mensalidades m
          WHERE m.apolice_id = ap.id
            AND lower(coalesce(m.status, '')) NOT IN (
              'paid', 'pago', 'received', 'cancelled', 'cancelado'
            )
        ),
        ap.vigencia_fim
      ) AS next_due_date
    FROM active_policies ap
    ORDER BY next_due_date NULLS LAST, ap.created_at DESC
    LIMIT 4
  ),
  active_claims AS (
    SELECT s.*
    FROM public.sinistros s
    JOIN owner_policies op ON op.id = s.apolice_id
    WHERE lower(coalesce(s.status, '')) NOT IN (
      'pago', 'reprovado', 'cancelado', 'encerrado', 'resolvido', 'finalizado'
    )
  ),
  activity_events AS (
    SELECT
      re.id,
      'payment'::text AS type,
      'Recebimento confirmado'::text AS title,
      coalesce(re.property_name, 'Imovel sem endereco') || ' - ' ||
        to_char(re.paid_on, 'MM/YYYY') AS description,
      re.property_name,
      re.amount,
      re.occurred_at
    FROM receipt_events re

    UNION ALL

    SELECT
      'policy:' || op.id::text,
      'contract',
      CASE WHEN lower(coalesce(op.status, '')) IN ('ativa', 'active')
        THEN 'Contrato ativo' ELSE 'Contrato atualizado' END,
      coalesce(op.property_name, 'Imovel sem endereco') || ' - ' || coalesce(op.numero, 'sem numero'),
      op.property_name,
      NULL::numeric,
      coalesce(op.updated_at, op.created_at)
    FROM owner_policies op

    UNION ALL

    SELECT
      'claim:' || s.id::text,
      'claim',
      'Sinistro aberto',
      coalesce(op.property_name, 'Imovel sem endereco') || ' - ' || coalesce(s.motivo, 'em analise'),
      op.property_name,
      s.valor_estimado,
      s.created_at
    FROM public.sinistros s
    JOIN owner_policies op ON op.id = s.apolice_id

    UNION ALL

    SELECT
      'invoice-created:' || f.id::text,
      'invoice',
      'Fatura gerada',
      coalesce(op.property_name, 'Imovel sem endereco') || ' - parcela ' || coalesce(f.numero_parcela, 1)::text,
      op.property_name,
      f.valor,
      f.created_at
    FROM public.faturas_inquilino f
    JOIN owner_policies op
      ON op.id = f.apolice_id OR (f.apolice_id IS NULL AND op.consultation_id = f.consulta_id)
  ),
  summary AS (
    SELECT jsonb_build_object(
      'property_count', (SELECT count(*) FROM owner_properties),
      'active_property_count', (SELECT count(DISTINCT property_id) FROM active_policies WHERE property_id IS NOT NULL),
      'available_property_count', greatest(
        (SELECT count(*) FROM owner_properties)
        - (SELECT count(DISTINCT property_id) FROM active_policies WHERE property_id IS NOT NULL),
        0
      ),
      'active_contract_count', (SELECT count(*) FROM active_policies),
      'current_month_received', (SELECT amount FROM current_month_revenue),
      'previous_month_received', (SELECT amount FROM previous_month_revenue),
      'month_change_percent', (
        SELECT CASE
          WHEN previous.amount > 0
            THEN round(((current.amount - previous.amount) / previous.amount) * 100, 1)
          ELSE NULL
        END
        FROM current_month_revenue current
        CROSS JOIN previous_month_revenue previous
      ),
      'year_received', (SELECT amount FROM year_revenue),
      'active_claim_count', (SELECT count(*) FROM active_claims)
    ) AS value
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'summary', (SELECT value FROM summary),
    'monthly_revenue', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object('month_start', month_start, 'amount', amount)
        ORDER BY month_start
      )
      FROM monthly_revenue
    ), '[]'::jsonb),
    'property_revenue', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'property_id', property_id,
          'property_name', property_name,
          'amount', amount,
          'percentage', CASE
            WHEN total.total_amount > 0 THEN round((amount / total.total_amount) * 100, 1)
            ELSE 0
          END
        )
        ORDER BY amount DESC, property_name
      )
      FROM property_revenue
      CROSS JOIN (SELECT coalesce(sum(amount), 0)::numeric AS total_amount FROM property_revenue) total
    ), '[]'::jsonb),
    'contracts', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', id,
          'number', numero,
          'property_id', property_id,
          'property_name', property_name,
          'location', location,
          'tenant_name', tenant_name,
          'rent_value', rent_value,
          'next_due_date', next_due_date,
          'status', status
        )
        ORDER BY next_due_date NULLS LAST
      )
      FROM contract_rows
    ), '[]'::jsonb),
    'activities', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', id,
          'type', type,
          'title', title,
          'description', description,
          'property_name', property_name,
          'amount', amount,
          'occurred_at', occurred_at
        )
        ORDER BY occurred_at DESC
      )
      FROM (
        SELECT * FROM activity_events ORDER BY occurred_at DESC LIMIT 5
      ) recent
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_owner_dashboard(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_owner_dashboard(integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_my_owner_dashboard(integer) IS
  'Retorna o dashboard real do proprietario autenticado, resolvido pelo vinculo proprietarios -> imoveis.';
