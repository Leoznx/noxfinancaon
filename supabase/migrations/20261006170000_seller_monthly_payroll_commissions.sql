-- Comissao mensal de SDR/Closer contabilizada em folha, sem saque, reserva ou liberacao.
-- A competencia nasce somente quando o contrato esta ativo E a primeira parcela esta paga.

ALTER TABLE public.seller_commissions
  ADD COLUMN IF NOT EXISTS client_name text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS counted_at timestamptz,
  ADD COLUMN IF NOT EXISTS contract_sequence integer;

COMMENT ON COLUMN public.seller_commissions.client_name IS
  'Nome do cliente contratante preservado no momento em que a comissao entra na folha.';
COMMENT ON COLUMN public.seller_commissions.paid_at IS
  'Data do primeiro pagamento que tornou o contrato elegivel para comissao.';
COMMENT ON COLUMN public.seller_commissions.counted_at IS
  'Data em que contrato ativo e pagamento passaram a coexistir; define a competencia mensal.';
COMMENT ON COLUMN public.seller_commissions.contract_sequence IS
  'Posicao do contrato na producao paga do colaborador dentro da competencia mensal.';

DROP TRIGGER IF EXISTS trg_no_seller_production_bonus ON public.seller_commissions;
DROP FUNCTION IF EXISTS public.enforce_no_seller_production_bonus();
DROP TRIGGER IF EXISTS trg_equalize_sdr_closer_commission_pair ON public.seller_commissions;
DROP FUNCTION IF EXISTS public.equalize_sdr_closer_commission_pair();

CREATE OR REPLACE FUNCTION public.calcular_comissao_vendedor(contratos integer)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    least(greatest(coalesce(contratos, 0), 0), 15) * 25
    + least(greatest(coalesce(contratos, 0) - 15, 0), 10) * 35
    + greatest(coalesce(contratos, 0) - 25, 0) * 45;
$$;

CREATE OR REPLACE FUNCTION public.calcular_bonus_vendedor(contratos integer)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    CASE WHEN coalesce(contratos, 0) >= 15 THEN 400 ELSE 0 END
    + CASE WHEN coalesce(contratos, 0) >= 30 THEN 600 ELSE 0 END
    + CASE WHEN coalesce(contratos, 0) >= 45 THEN 1200 ELSE 0 END;
$$;

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
  CROSS JOIN LATERAL public.seller_client_contract_events_for(seller.id) AS event
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
  ON CONFLICT (seller_id, contract_id, month, year) WHERE contract_id IS NOT NULL
  DO UPDATE SET
    apolice_id = excluded.apolice_id,
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

CREATE OR REPLACE FUNCTION public.materializar_comissoes_vendedor(
  p_mes integer DEFAULT NULL,
  p_ano integer DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mes integer := coalesce(p_mes, extract(month FROM now() AT TIME ZONE 'America/Sao_Paulo')::integer);
  v_ano integer := coalesce(p_ano, extract(year FROM now() AT TIME ZONE 'America/Sao_Paulo')::integer);
  v_seller record;
  v_count integer;
  v_commission numeric;
  v_bonus numeric;
  v_processed integer := 0;
BEGIN
  IF v_mes < 1 OR v_mes > 12 OR v_ano < 2000 OR v_ano > 9999 THEN
    RAISE EXCEPTION 'Mes ou ano invalido.';
  END IF;

  PERFORM public.sync_seller_client_commission_rows(v_mes, v_ano);

  FOR v_seller IN
    SELECT DISTINCT commission.seller_id
    FROM public.seller_commissions AS commission
    WHERE commission.month = v_mes
      AND commission.year = v_ano
      AND commission.contract_id IS NOT NULL
      AND commission.status = 'contabilizada'
  LOOP
    SELECT count(*)::integer
    INTO v_count
    FROM public.seller_commissions AS commission
    WHERE commission.seller_id = v_seller.seller_id
      AND commission.month = v_mes
      AND commission.year = v_ano
      AND commission.contract_id IS NOT NULL
      AND commission.status = 'contabilizada';

    WITH ranked AS (
      SELECT
        commission.id,
        row_number() OVER (
          ORDER BY
            coalesce(commission.counted_at, commission.eligible_at, commission.created_at),
            commission.contract_id,
            commission.id
        )::integer AS position
      FROM public.seller_commissions AS commission
      WHERE commission.seller_id = v_seller.seller_id
        AND commission.month = v_mes
        AND commission.year = v_ano
        AND commission.contract_id IS NOT NULL
        AND commission.status = 'contabilizada'
    ), valued AS (
      SELECT
        ranked.id,
        ranked.position,
        CASE
          WHEN ranked.position <= 15 THEN 25::numeric
          WHEN ranked.position <= 25 THEN 35::numeric
          ELSE 45::numeric
        END AS contract_commission,
        CASE
          WHEN ranked.position = 15 THEN 400::numeric
          WHEN ranked.position = 30 THEN 600::numeric
          WHEN ranked.position = 45 THEN 1200::numeric
          ELSE 0::numeric
        END AS milestone_bonus
      FROM ranked
    )
    UPDATE public.seller_commissions AS commission
    SET
      contract_sequence = valued.position,
      commission_amount = valued.contract_commission,
      bonus_amount = valued.milestone_bonus,
      reserve_amount = 0,
      released_amount = 0,
      reserve_release_at = NULL,
      released_at = NULL,
      clawback_until = NULL,
      status = 'contabilizada',
      updated_at = now()
    FROM valued
    WHERE commission.id = valued.id;

    v_commission := public.calcular_comissao_vendedor(v_count);
    v_bonus := public.calcular_bonus_vendedor(v_count);

    INSERT INTO public.seller_performance (
      seller_id,
      month,
      year,
      contracts_closed,
      contracts_activated,
      commission_total,
      bonus_total,
      total_estimated_gain,
      bonus_bloqueado
    ) VALUES (
      v_seller.seller_id,
      v_mes,
      v_ano,
      v_count,
      v_count,
      v_commission,
      v_bonus,
      v_commission + v_bonus,
      false
    )
    ON CONFLICT (seller_id, month, year) DO UPDATE SET
      contracts_closed = excluded.contracts_closed,
      contracts_activated = excluded.contracts_activated,
      commission_total = excluded.commission_total,
      bonus_total = excluded.bonus_total,
      total_estimated_gain = excluded.total_estimated_gain,
      bonus_bloqueado = false,
      updated_at = now();

    v_processed := v_processed + 1;
  END LOOP;

  RETURN v_processed;
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
    CROSS JOIN LATERAL public.seller_client_contract_events_for(seller.id) AS event
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

CREATE OR REPLACE FUNCTION public.trg_materializar_comissao_on_pagamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF lower(coalesce(NEW.status, '')) IN ('pago', 'paid', 'received')
     AND coalesce(NEW.numero_parcela, 1) = 1 THEN
    PERFORM public.refresh_seller_commission_for_policy(NEW.apolice_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_materializar_comissao_vendedor ON public.mensalidades;
CREATE TRIGGER trg_materializar_comissao_vendedor
AFTER INSERT OR UPDATE OF status, data_pagamento ON public.mensalidades
FOR EACH ROW EXECUTE FUNCTION public.trg_materializar_comissao_on_pagamento();

CREATE OR REPLACE FUNCTION public.trg_refresh_seller_commission_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF lower(coalesce(NEW.status, '')) IN ('paid', 'pago', 'confirmed', 'received', 'paid_via_consolidated')
     AND coalesce(NEW.numero_parcela, 1) = 1 THEN
    PERFORM public.refresh_seller_commission_for_policy(NEW.apolice_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_seller_commission_invoice ON public.faturas_inquilino;
CREATE TRIGGER trg_refresh_seller_commission_invoice
AFTER INSERT OR UPDATE OF status, pago_em ON public.faturas_inquilino
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_seller_commission_invoice();

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
        AND lower(coalesce(policy.status, '')) IN ('ativa', 'active')
    LOOP
      PERFORM public.refresh_seller_commission_for_policy(v_policy_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_seller_commission_asaas ON public.asaas_payments;
CREATE TRIGGER trg_refresh_seller_commission_asaas
AFTER INSERT OR UPDATE OF status, received_at, confirmed_at ON public.asaas_payments
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_seller_commission_asaas();

-- Corrige dados existentes sem disparar uma segunda notificacao aos vendedores.
ALTER TABLE public.seller_commissions DISABLE TRIGGER trg_notify_seller_commission_change;

DROP INDEX IF EXISTS public.seller_commissions_unique_contract;

WITH paid_events AS (
  SELECT DISTINCT ON (seller.id, event.contract_id)
    seller.id AS seller_id,
    event.contract_id,
    event.first_installment_paid_at AS paid_at,
    greatest(event.contract_closed_at, event.first_installment_paid_at) AS counted_at,
    coalesce(
      nullif(btrim(consultation.tenant_name), ''),
      nullif(btrim(tenant.razao_social), ''),
      nullif(btrim(tenant.nome), ''),
      nullif(btrim(event.requester_name), ''),
      nullif(btrim(event.partner_name), ''),
      'Cliente sem nome'
    ) AS client_name
  FROM public.internal_users AS seller
  CROSS JOIN LATERAL public.seller_client_contract_events_for(seller.id) AS event
  JOIN public.apolices AS policy ON policy.id = event.contract_id
  LEFT JOIN public.consultas_credito AS consultation ON consultation.id = policy.consulta_id
  LEFT JOIN public.inquilinos AS tenant ON tenant.id = consultation.inquilino_id
  WHERE seller.role = 'vendedor'
    AND event.first_installment_paid
    AND event.first_installment_paid_at IS NOT NULL
  ORDER BY seller.id, event.contract_id, event.first_installment_paid_at
)
UPDATE public.seller_commissions AS commission
SET
  month = extract(month FROM paid.counted_at AT TIME ZONE 'America/Sao_Paulo')::integer,
  year = extract(year FROM paid.counted_at AT TIME ZONE 'America/Sao_Paulo')::integer,
  status = 'contabilizada',
  eligible_at = paid.counted_at,
  client_name = paid.client_name,
  paid_at = paid.paid_at,
  counted_at = paid.counted_at,
  reserve_amount = 0,
  released_amount = 0,
  reserve_release_at = NULL,
  released_at = NULL,
  clawback_until = NULL,
  canceled_at = NULL,
  clawback_applied_at = NULL,
  clawback_reason = NULL,
  updated_at = now()
FROM paid_events AS paid
WHERE commission.seller_id = paid.seller_id
  AND coalesce(commission.contract_id, commission.apolice_id) = paid.contract_id;

DELETE FROM public.seller_commissions AS duplicate
USING public.seller_commissions AS keeper
WHERE duplicate.id > keeper.id
  AND duplicate.seller_id = keeper.seller_id
  AND duplicate.contract_id = keeper.contract_id
  AND duplicate.month = keeper.month
  AND duplicate.year = keeper.year
  AND duplicate.contract_id IS NOT NULL;

CREATE UNIQUE INDEX seller_commissions_unique_contract
  ON public.seller_commissions(seller_id, contract_id, month, year)
  WHERE contract_id IS NOT NULL;

DO $$
DECLARE
  v_period record;
BEGIN
  FOR v_period IN
    SELECT DISTINCT
      commission.month AS period_month,
      commission.year AS period_year
    FROM public.seller_commissions AS commission
    WHERE commission.status = 'contabilizada'
      AND commission.contract_id IS NOT NULL
  LOOP
    PERFORM public.materializar_comissoes_vendedor(v_period.period_month, v_period.period_year);
  END LOOP;
END;
$$;

ALTER TABLE public.seller_commissions ENABLE TRIGGER trg_notify_seller_commission_change;

REVOKE ALL ON FUNCTION public.sync_seller_client_commission_rows(integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_seller_commission_for_policy(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_refresh_seller_commission_asaas()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.materializar_comissoes_vendedor(integer, integer) IS
  'Conta contratos ativos e pagos por colaborador e competencia: 1-15 R$25, 16-25 R$35, 26+ R$45; bonus cumulativos em 15, 30 e 45.';
