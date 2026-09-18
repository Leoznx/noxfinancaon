-- Unifica cadastro, ranking, dashboard e comissao na atribuicao comercial.
--
-- O credito imutavel de seller_signup_attributions passa a ser a fonte
-- principal. Vinculos antigos em seller_client_partnerships continuam sendo
-- considerados para compatibilidade, sem duplicar o mesmo perfil.

-- Repara, de forma idempotente, qualquer envio contextual de reuniao que ja
-- tenha sido consumido sem registrar um dos dois responsaveis.
INSERT INTO public.seller_signup_attributions (
  link_id,
  seller_id,
  seller_type,
  registered_profile_id,
  profile_role,
  registered_email,
  source
)
SELECT
  event.link_id,
  event.seller_id,
  seller.seller_type,
  event.claimed_profile_id,
  event.profile_role,
  lower(profile.email),
  'link'
FROM public.seller_signup_link_send_events AS event
JOIN public.internal_users AS seller ON seller.id = event.seller_id
JOIN public.profiles AS profile ON profile.id = event.claimed_profile_id
WHERE event.claimed_profile_id IS NOT NULL
  AND seller.seller_type IN ('sdr', 'closer')
ON CONFLICT (registered_profile_id, seller_type) DO NOTHING;

INSERT INTO public.seller_signup_attributions (
  link_id,
  seller_id,
  seller_type,
  registered_profile_id,
  profile_role,
  registered_email,
  source
)
SELECT
  event.link_id,
  event.source_sdr_id,
  'sdr',
  event.claimed_profile_id,
  event.profile_role,
  lower(profile.email),
  'link'
FROM public.seller_signup_link_send_events AS event
JOIN public.profiles AS profile ON profile.id = event.claimed_profile_id
WHERE event.claimed_profile_id IS NOT NULL
  AND event.source_sdr_id IS NOT NULL
ON CONFLICT (registered_profile_id, seller_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.seller_registration_credits_for(p_seller_id uuid)
RETURNS TABLE (
  credit_id uuid,
  registered_profile_id uuid,
  registered_email text,
  profile_role text,
  credited_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH credit_sources AS (
    SELECT
      attribution.id AS credit_id,
      attribution.registered_profile_id,
      lower(attribution.registered_email) AS registered_email,
      attribution.profile_role,
      attribution.created_at AS credited_at,
      0 AS source_priority
    FROM public.seller_signup_attributions AS attribution
    WHERE attribution.seller_id = p_seller_id

    UNION ALL

    SELECT
      partnership.id,
      partnership.client_profile_id,
      lower(partnership.registered_email),
      CASE
        WHEN profile.role::text IN ('proprietario', 'imobiliaria', 'corretor')
          THEN profile.role::text
        WHEN partnership.partner_type = 'imobiliaria' THEN 'imobiliaria'
        ELSE 'corretor'
      END,
      partnership.created_at,
      1
    FROM public.seller_client_partnerships AS partnership
    JOIN public.profiles AS profile ON profile.id = partnership.client_profile_id
    WHERE partnership.seller_id = p_seller_id
  )
  SELECT
    (array_agg(source.credit_id ORDER BY source.source_priority, source.credited_at))[1],
    source.registered_profile_id,
    (array_agg(source.registered_email ORDER BY source.source_priority, source.credited_at))[1],
    (array_agg(source.profile_role ORDER BY source.source_priority, source.credited_at))[1],
    min(source.credited_at)
  FROM credit_sources AS source
  GROUP BY source.registered_profile_id;
$$;

REVOKE ALL ON FUNCTION public.seller_registration_credits_for(uuid)
  FROM PUBLIC, anon, authenticated;

-- Contratos pertencem ao credito comercial, nao ao modo como o cliente foi
-- cadastrado. Isso cobre link particular, link de reuniao compartilhado e
-- cadastros legados. Somente apolices ativas contam e geram comissao.
CREATE OR REPLACE FUNCTION public.seller_client_contract_events_for(p_seller_id uuid)
RETURNS TABLE (
  partnership_id uuid,
  partner_name text,
  partner_type text,
  contract_id uuid,
  contract_number text,
  requester_profile_id uuid,
  requester_name text,
  contract_closed_at timestamptz,
  city text,
  first_installment_paid boolean,
  first_installment_paid_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH credits AS (
    SELECT
      credit.credit_id,
      credit.registered_profile_id,
      credit.registered_email,
      credit.profile_role,
      credit.credited_at,
      profile.nome AS profile_name,
      broker.cidade AS broker_city,
      agency.id AS agency_id,
      coalesce(agency.nome_fantasia, agency.razao_social, profile.nome) AS partner_name,
      CASE
        WHEN agency.id IS NOT NULL THEN 'imobiliaria'
        WHEN credit.profile_role = 'corretor' THEN 'corretor_autonomo'
        ELSE 'proprietario'
      END AS partner_type,
      coalesce(agency.cidade, broker.cidade) AS partner_city
    FROM public.seller_registration_credits_for(p_seller_id) AS credit
    JOIN public.profiles AS profile ON profile.id = credit.registered_profile_id
    LEFT JOIN public.corretores AS broker
      ON broker.profile_id = credit.registered_profile_id
    LEFT JOIN LATERAL (
      SELECT candidate.*
      FROM public.imobiliarias AS candidate
      WHERE candidate.id = broker.imobiliaria_id
         OR (
           credit.profile_role = 'imobiliaria'
           AND lower(candidate.contato_email) = lower(credit.registered_email)
         )
      ORDER BY (candidate.id = broker.imobiliaria_id) DESC
      LIMIT 1
    ) AS agency ON true
  ),
  members AS (
    SELECT credit.credit_id, credit.registered_profile_id AS profile_id
    FROM credits AS credit

    UNION

    SELECT credit.credit_id, broker.profile_id
    FROM credits AS credit
    JOIN public.corretores AS broker ON broker.imobiliaria_id = credit.agency_id

    UNION

    SELECT credit.credit_id, agency_profile.id
    FROM credits AS credit
    JOIN public.imobiliarias AS agency ON agency.id = credit.agency_id
    JOIN public.profiles AS agency_profile
      ON lower(agency_profile.email) = lower(agency.contato_email)
  ),
  contract_rows AS (
    SELECT DISTINCT ON (policy.id)
      credit.credit_id AS partnership_id,
      credit.partner_name,
      credit.partner_type,
      policy.id AS contract_id,
      policy.numero AS contract_number,
      consultation.profile_id_solicitante AS requester_profile_id,
      requester.nome AS requester_name,
      policy.created_at AS contract_closed_at,
      coalesce(consultation.imovel_cidade, requester_broker.cidade, credit.partner_city) AS city,
      paid.paid_at AS first_installment_paid_at
    FROM credits AS credit
    JOIN members AS member ON member.credit_id = credit.credit_id
    JOIN public.consultas_credito AS consultation
      ON consultation.profile_id_solicitante = member.profile_id
    JOIN public.apolices AS policy
      ON policy.consulta_id = consultation.id
     AND policy.created_at >= credit.credited_at
     AND lower(coalesce(policy.status, '')) IN ('ativa', 'active')
    JOIN public.profiles AS requester ON requester.id = consultation.profile_id_solicitante
    LEFT JOIN public.corretores AS requester_broker
      ON requester_broker.profile_id = consultation.profile_id_solicitante
    LEFT JOIN LATERAL (
      SELECT min(payment_event.paid_at) AS paid_at
      FROM (
        SELECT coalesce(invoice.pago_em, invoice.updated_at, invoice.created_at) AS paid_at
        FROM public.faturas_inquilino AS invoice
        WHERE invoice.apolice_id = policy.id
          AND invoice.numero_parcela = 1
          AND lower(coalesce(invoice.status, '')) IN (
            'paid', 'pago', 'confirmed', 'received', 'paid_via_consolidated'
          )

        UNION ALL

        SELECT coalesce(monthly.data_pagamento, monthly.created_at)
        FROM public.mensalidades AS monthly
        WHERE monthly.apolice_id = policy.id
          AND coalesce(monthly.numero_parcela, 1) = 1
          AND lower(coalesce(monthly.status, '')) IN ('paid', 'pago', 'received')

        UNION ALL

        SELECT coalesce(asaas.received_at, asaas.confirmed_at, asaas.updated_at)
        FROM public.asaas_payments AS asaas
        WHERE asaas.consultation_id = consultation.id
          AND lower(coalesce(asaas.status, '')) IN ('paid', 'pago', 'confirmed', 'received')
      ) AS payment_event
    ) AS paid ON true
    ORDER BY policy.id, credit.credited_at, credit.credit_id
  )
  SELECT
    contract.partnership_id,
    contract.partner_name,
    contract.partner_type,
    contract.contract_id,
    contract.contract_number,
    contract.requester_profile_id,
    contract.requester_name,
    contract.contract_closed_at,
    contract.city,
    contract.first_installment_paid_at IS NOT NULL,
    contract.first_installment_paid_at
  FROM contract_rows AS contract;
$$;

REVOKE ALL ON FUNCTION public.seller_client_contract_events_for(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.count_seller_goal_registrations(
  p_seller_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::bigint
  FROM public.seller_registration_credits_for(p_seller_id) AS credit
  WHERE credit.credited_at >= p_start
    AND credit.credited_at < p_end;
$$;

REVOKE ALL ON FUNCTION public.count_seller_goal_registrations(uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;

-- Mantem o ranking ordenado por cadastros; contrato ativo e comissao passam a
-- ter seus valores reais e funcionam como desempate.
DROP FUNCTION IF EXISTS public.ranking_vendedores(integer, integer);
CREATE FUNCTION public.ranking_vendedores(
  p_month integer DEFAULT extract(month FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::integer,
  p_year integer DEFAULT extract(year FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::integer
)
RETURNS TABLE (
  vendedor_id uuid,
  nome text,
  avatar_url text,
  total_leads bigint,
  contratos_fechados bigint,
  em_atendimento bigint,
  comissoes numeric,
  posicao bigint,
  seller_type text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_type text;
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  SELECT seller.seller_type
  INTO v_type
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid()
    AND seller.role = 'vendedor'
    AND seller.status = 'ativo'
  LIMIT 1;

  v_start := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'America/Sao_Paulo');
  v_end := v_start + interval '1 month';

  RETURN QUERY
  WITH metrics AS (
    SELECT
      seller.id,
      seller.full_name,
      profile.avatar_url,
      seller.seller_type,
      public.count_seller_goal_registrations(seller.id, v_start, v_end) AS registrations,
      (
        SELECT count(DISTINCT event.contract_id)::bigint
        FROM public.seller_client_contract_events_for(seller.id) AS event
        WHERE event.contract_closed_at >= v_start
          AND event.contract_closed_at < v_end
      ) AS active_contracts,
      (
        SELECT count(*)::bigint
        FROM public.sales_leads AS lead
        WHERE lead.assigned_seller_id = seller.id
          AND lead.status IN ('novo', 'pendente', 'em_atendimento', 'em_contato', 'sem_resposta')
      ) AS open_leads,
      coalesce((
        SELECT sum(coalesce(commission.commission_amount, 0) + coalesce(commission.bonus_amount, 0))
        FROM public.seller_commissions AS commission
        WHERE commission.seller_id = seller.id
          AND commission.month = p_month
          AND commission.year = p_year
          AND commission.status NOT IN ('estornada', 'cancelada')
      ), 0)::numeric AS commission_total
    FROM public.internal_users AS seller
    LEFT JOIN public.profiles AS profile ON profile.id = seller.auth_user_id
    WHERE seller.role = 'vendedor'
      AND seller.status = 'ativo'
      AND NOT seller.exclude_from_commercial_metrics
      AND lower(seller.email) <> 'vendedornox@nox.com'
      AND (v_type IS NULL OR seller.seller_type = v_type)
  ),
  ranked AS (
    SELECT metrics.*,
      row_number() OVER (
        PARTITION BY metrics.seller_type
        ORDER BY metrics.registrations DESC,
          metrics.active_contracts DESC,
          metrics.commission_total DESC,
          metrics.full_name
      )::bigint AS ranking_position
    FROM metrics
  )
  SELECT
    ranked.id,
    ranked.full_name,
    ranked.avatar_url,
    ranked.registrations,
    ranked.active_contracts,
    ranked.open_leads,
    ranked.commission_total,
    ranked.ranking_position,
    ranked.seller_type
  FROM ranked
  ORDER BY ranked.seller_type, ranked.ranking_position;
END;
$$;

REVOKE ALL ON FUNCTION public.ranking_vendedores(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ranking_vendedores(integer, integer) TO authenticated;

-- Se um credito for atribuido depois de a apolice ja estar ativa, a comissao
-- tambem e materializada automaticamente.
CREATE OR REPLACE FUNCTION public.refresh_seller_commissions_after_credit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_policy_id uuid;
BEGIN
  FOR v_policy_id IN
    SELECT event.contract_id
    FROM public.seller_client_contract_events_for(NEW.seller_id) AS event
  LOOP
    PERFORM public.refresh_seller_commission_for_policy(v_policy_id);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_seller_commissions_after_credit
  ON public.seller_signup_attributions;
CREATE TRIGGER trg_refresh_seller_commissions_after_credit
AFTER INSERT ON public.seller_signup_attributions
FOR EACH ROW
EXECUTE FUNCTION public.refresh_seller_commissions_after_credit();

REVOKE ALL ON FUNCTION public.refresh_seller_commissions_after_credit()
  FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'seller_signup_attributions'
  ) THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.seller_signup_attributions;
  END IF;
END;
$$;

-- Reprocessa os meses que ja possuem contratos ativos atribuidos. O processo
-- e idempotente pela chave unica (seller_id, contract_id, month, year).
DO $$
DECLARE
  period record;
BEGIN
  FOR period IN
    SELECT DISTINCT
      extract(month FROM event.contract_closed_at AT TIME ZONE 'America/Sao_Paulo')::integer AS period_month,
      extract(year FROM event.contract_closed_at AT TIME ZONE 'America/Sao_Paulo')::integer AS period_year
    FROM public.internal_users AS seller
    CROSS JOIN LATERAL public.seller_client_contract_events_for(seller.id) AS event
    WHERE seller.role = 'vendedor'
  LOOP
    PERFORM public.materializar_comissoes_vendedor(period.period_month, period.period_year);
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.seller_registration_credits_for(uuid) IS
  'Fonte unica de cadastros comerciais: atribuicoes por link/manual e vinculos legados, sem duplicidade.';
COMMENT ON FUNCTION public.seller_client_contract_events_for(uuid) IS
  'Contratos ativos de todos os perfis creditados ao vendedor, inclusive links compartilhados SDR/Closer.';
COMMENT ON FUNCTION public.ranking_vendedores(integer, integer) IS
  'Ranking mensal por cadastros, com contratos ativos e comissoes reais como indicadores e desempate.';
