-- Contabiliza SDR e Closer assim que o primeiro pagamento for confirmado.
-- A assinatura/ativacao da apolice continua sendo exigida para producao,
-- metas e ranking, mas nao bloqueia mais a folha financeira.

BEGIN;

CREATE OR REPLACE FUNCTION public.seller_client_commission_events_for(p_seller_id uuid)
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
     AND lower(coalesce(policy.status, '')) NOT IN (
       'cancelada', 'cancelado', 'cancelled', 'canceled',
       'inativa', 'inativo', 'inactive'
     )
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

        UNION ALL

        SELECT coalesce(
          payment_consultation.payment_received_at,
          payment_consultation.payment_confirmed_at,
          payment_consultation.payment_provider_event_at,
          payment_consultation.updated_at,
          payment_consultation.created_at
        )
        FROM public.consultas_credito AS payment_consultation
        WHERE payment_consultation.id = consultation.id
          AND (
            lower(coalesce(payment_consultation.payment_state, '')) IN (
              'paid', 'pago', 'received', 'recebido', 'confirmed', 'confirmado', 'aprovado'
            )
            OR lower(coalesce(payment_consultation.payment_status, '')) IN (
              'paid', 'pago', 'received', 'recebido', 'confirmed', 'confirmado', 'aprovado'
            )
          )
      ) AS payment_event
      WHERE payment_event.paid_at IS NOT NULL
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

REVOKE ALL ON FUNCTION public.seller_client_commission_events_for(uuid)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.seller_client_commission_events_for(uuid) IS
  'Eventos financeiros de SDR/Closer: primeiro pagamento confirmado em apolice nao cancelada, sem depender de assinatura ou ativacao.';

-- O contrato deve existir uma unica vez por vendedor, mesmo que uma correcao
-- posterior mova a data para outra competencia.
ALTER TABLE public.seller_commissions DISABLE TRIGGER trg_notify_seller_commission_change;

DROP INDEX IF EXISTS public.seller_commissions_unique_contract;

UPDATE public.seller_commissions
SET contract_id = apolice_id
WHERE contract_id IS NULL
  AND apolice_id IS NOT NULL;

DELETE FROM public.seller_commissions AS duplicate
USING public.seller_commissions AS keeper
WHERE duplicate.id > keeper.id
  AND duplicate.seller_id = keeper.seller_id
  AND duplicate.contract_id = keeper.contract_id
  AND duplicate.contract_id IS NOT NULL;

CREATE UNIQUE INDEX seller_commissions_unique_contract
  ON public.seller_commissions(seller_id, contract_id)
  WHERE contract_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_seller_client_commission_rows(
  p_month integer,
  p_year integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_changed integer := 0;
BEGIN
  IF p_month < 1 OR p_month > 12 OR p_year < 2000 OR p_year > 9999 THEN
    RAISE EXCEPTION 'Mes ou ano invalido.';
  END IF;

  INSERT INTO public.seller_commissions (
    seller_id,
    contract_id,
    apolice_id,
    month,
    year,
    commission_amount,
    bonus_amount,
    reserve_amount,
    released_amount,
    status,
    eligible_at,
    client_name,
    paid_at,
    counted_at,
    reserve_release_at,
    released_at,
    clawback_until
  )
  SELECT
    seller.id,
    event.contract_id,
    event.contract_id,
    extract(month FROM recognized.counted_at AT TIME ZONE 'America/Sao_Paulo')::integer,
    extract(year FROM recognized.counted_at AT TIME ZONE 'America/Sao_Paulo')::integer,
    0,
    0,
    0,
    0,
    'contabilizada',
    recognized.counted_at,
    coalesce(
      nullif(btrim(consultation.tenant_name), ''),
      nullif(btrim(tenant.razao_social), ''),
      nullif(btrim(tenant.nome), ''),
      nullif(btrim(event.requester_name), ''),
      nullif(btrim(event.partner_name), ''),
      'Cliente sem nome'
    ),
    event.first_installment_paid_at,
    recognized.counted_at,
    NULL,
    NULL,
    NULL
  FROM public.internal_users AS seller
  CROSS JOIN LATERAL public.seller_client_commission_events_for(seller.id) AS event
  CROSS JOIN LATERAL (
    SELECT greatest(event.contract_closed_at, event.first_installment_paid_at) AS counted_at
  ) AS recognized
  JOIN public.apolices AS policy ON policy.id = event.contract_id
  LEFT JOIN public.consultas_credito AS consultation ON consultation.id = policy.consulta_id
  LEFT JOIN public.inquilinos AS tenant ON tenant.id = consultation.inquilino_id
  WHERE seller.role = 'vendedor'
    AND seller.status = 'ativo'
    AND event.first_installment_paid
    AND event.first_installment_paid_at IS NOT NULL
    AND extract(month FROM recognized.counted_at AT TIME ZONE 'America/Sao_Paulo')::integer = p_month
    AND extract(year FROM recognized.counted_at AT TIME ZONE 'America/Sao_Paulo')::integer = p_year
  ON CONFLICT (seller_id, contract_id) WHERE contract_id IS NOT NULL
  DO UPDATE SET
    apolice_id = excluded.apolice_id,
    month = excluded.month,
    year = excluded.year,
    status = 'contabilizada',
    eligible_at = excluded.eligible_at,
    client_name = excluded.client_name,
    paid_at = excluded.paid_at,
    counted_at = excluded.counted_at,
    reserve_amount = 0,
    released_amount = 0,
    reserve_release_at = NULL,
    released_at = NULL,
    clawback_until = NULL,
    canceled_at = NULL,
    clawback_applied_at = NULL,
    clawback_reason = NULL,
    updated_at = now();

  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_seller_commission_for_policy(p_policy_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period record;
BEGIN
  FOR v_period IN
    SELECT DISTINCT
      extract(month FROM greatest(event.contract_closed_at, event.first_installment_paid_at)
        AT TIME ZONE 'America/Sao_Paulo')::integer AS period_month,
      extract(year FROM greatest(event.contract_closed_at, event.first_installment_paid_at)
        AT TIME ZONE 'America/Sao_Paulo')::integer AS period_year
    FROM public.internal_users AS seller
    CROSS JOIN LATERAL public.seller_client_commission_events_for(seller.id) AS event
    WHERE seller.role = 'vendedor'
      AND seller.status = 'ativo'
      AND event.contract_id = p_policy_id
      AND event.first_installment_paid
      AND event.first_installment_paid_at IS NOT NULL
  LOOP
    PERFORM public.materializar_comissoes_vendedor(v_period.period_month, v_period.period_year);
  END LOOP;
END;
$$;

-- Pagamento do Asaas pode chegar antes da assinatura. O helper financeiro
-- decide a elegibilidade e o gatilho nao prefiltra mais apolices ativas.
CREATE OR REPLACE FUNCTION public.trg_refresh_seller_commission_asaas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_policy_id uuid;
BEGIN
  IF lower(coalesce(NEW.status, '')) IN ('paid', 'pago', 'confirmed', 'received') THEN
    FOR v_policy_id IN
      SELECT policy.id
      FROM public.apolices AS policy
      WHERE policy.consulta_id = NEW.consultation_id
        AND lower(coalesce(policy.status, '')) NOT IN (
          'cancelada', 'cancelado', 'cancelled', 'canceled',
          'inativa', 'inativo', 'inactive'
        )
    LOOP
      PERFORM public.refresh_seller_commission_for_policy(v_policy_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_refresh_seller_commission_consultation_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_policy_id uuid;
BEGIN
  IF lower(coalesce(NEW.payment_state, '')) IN (
       'paid', 'pago', 'received', 'recebido', 'confirmed', 'confirmado', 'aprovado'
     )
     OR lower(coalesce(NEW.payment_status, '')) IN (
       'paid', 'pago', 'received', 'recebido', 'confirmed', 'confirmado', 'aprovado'
     ) THEN
    FOR v_policy_id IN
      SELECT policy.id
      FROM public.apolices AS policy
      WHERE policy.consulta_id = NEW.id
        AND lower(coalesce(policy.status, '')) NOT IN (
          'cancelada', 'cancelado', 'cancelled', 'canceled',
          'inativa', 'inativo', 'inactive'
        )
    LOOP
      PERFORM public.refresh_seller_commission_for_policy(v_policy_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_seller_commission_consultation_payment
  ON public.consultas_credito;
CREATE TRIGGER trg_refresh_seller_commission_consultation_payment
AFTER INSERT OR UPDATE OF
  payment_state,
  payment_status,
  payment_received_at,
  payment_confirmed_at,
  payment_provider_event_at
ON public.consultas_credito
FOR EACH ROW
EXECUTE FUNCTION public.trg_refresh_seller_commission_consultation_payment();

-- Garante a ordem pagamento -> criacao da apolice.
CREATE OR REPLACE FUNCTION public.trg_refresh_seller_commission_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF lower(coalesce(NEW.status, '')) NOT IN (
    'cancelada', 'cancelado', 'cancelled', 'canceled',
    'inativa', 'inativo', 'inactive'
  ) THEN
    PERFORM public.refresh_seller_commission_for_policy(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_seller_commission_policy ON public.apolices;
CREATE TRIGGER trg_refresh_seller_commission_policy
AFTER INSERT OR UPDATE OF status, consulta_id ON public.apolices
FOR EACH ROW
EXECUTE FUNCTION public.trg_refresh_seller_commission_policy();

-- Garante a ordem pagamento/apolice -> atribuicao tardia do SDR ou Closer.
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
    FROM public.seller_client_commission_events_for(NEW.seller_id) AS event
    WHERE event.first_installment_paid
      AND event.first_installment_paid_at IS NOT NULL
  LOOP
    PERFORM public.refresh_seller_commission_for_policy(v_policy_id);
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_seller_client_commission_rows(integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_seller_commission_for_policy(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_refresh_seller_commission_asaas()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_refresh_seller_commission_consultation_payment()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_refresh_seller_commission_policy()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_seller_commissions_after_credit()
  FROM PUBLIC, anon, authenticated;

-- Reprocessa de forma idempotente todos os pagamentos atribuidos existentes.
DO $$
DECLARE
  v_period record;
BEGIN
  FOR v_period IN
    SELECT DISTINCT
      extract(month FROM greatest(event.contract_closed_at, event.first_installment_paid_at)
        AT TIME ZONE 'America/Sao_Paulo')::integer AS period_month,
      extract(year FROM greatest(event.contract_closed_at, event.first_installment_paid_at)
        AT TIME ZONE 'America/Sao_Paulo')::integer AS period_year
    FROM public.internal_users AS seller
    CROSS JOIN LATERAL public.seller_client_commission_events_for(seller.id) AS event
    WHERE seller.role = 'vendedor'
      AND seller.status = 'ativo'
      AND event.first_installment_paid
      AND event.first_installment_paid_at IS NOT NULL
  LOOP
    PERFORM public.materializar_comissoes_vendedor(v_period.period_month, v_period.period_year);
  END LOOP;
END;
$$;

ALTER TABLE public.seller_commissions ENABLE TRIGGER trg_notify_seller_commission_change;

COMMENT ON FUNCTION public.sync_seller_client_commission_rows(integer, integer) IS
  'Sincroniza a folha de SDR/Closer pelo primeiro pagamento, sem depender de assinatura ou ativacao da apolice.';
COMMENT ON FUNCTION public.refresh_seller_commission_for_policy(uuid) IS
  'Recalcula comissoes atribuidas a uma apolice paga e nao cancelada.';

COMMIT;
