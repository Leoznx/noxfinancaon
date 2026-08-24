-- Metas mensais automatizadas, nova regra de comissao e progresso em tempo real.
-- Depende de 20260824000000_seller_client_partnerships.sql.

ALTER TABLE public.seller_goals
  ADD COLUMN IF NOT EXISTS target_meetings integer,
  ADD COLUMN IF NOT EXISTS target_clients integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'seller_goals_targets_nonnegative'
  ) THEN
    ALTER TABLE public.seller_goals
      ADD CONSTRAINT seller_goals_targets_nonnegative
      CHECK (target_meetings >= 0 AND target_clients >= 0 AND target_contracts >= 0);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.calcular_comissao_vendedor(contratos integer)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    least(greatest(coalesce(contratos, 0), 0), 15) * 35
    + least(greatest(coalesce(contratos, 0) - 15, 0), 10) * 55
    + greatest(coalesce(contratos, 0) - 25, 0) * 75;
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
    + CASE WHEN coalesce(contratos, 0) > 45 THEN 1200 ELSE 0 END;
$$;

-- Cria automaticamente uma linha de comissao para cada contrato fechado por
-- um cliente cadastrado pelo vendedor. O pagamento continua protegido pela
-- regra da primeira parcela: antes dela, a linha fica aguardando.
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
  v_inserted integer := 0;
BEGIN
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
    eligible_at
  )
  SELECT
    seller.id,
    event.contract_id,
    event.contract_id,
    p_month,
    p_year,
    0,
    0,
    0,
    0,
    CASE WHEN event.first_installment_paid THEN 'elegivel' ELSE 'aguardando_primeira_parcela' END,
    CASE WHEN event.first_installment_paid THEN coalesce(event.first_installment_paid_at, now()) END
  FROM public.internal_users AS seller
  CROSS JOIN LATERAL public.seller_client_contract_events_for(seller.id) AS event
  WHERE seller.role = 'vendedor'
    AND seller.status = 'ativo'
    AND extract(month FROM event.contract_closed_at AT TIME ZONE 'America/Sao_Paulo')::integer = p_month
    AND extract(year FROM event.contract_closed_at AT TIME ZONE 'America/Sao_Paulo')::integer = p_year
  ON CONFLICT (seller_id, contract_id, month, year) WHERE contract_id IS NOT NULL
  DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  WITH paid_contracts AS (
    SELECT seller.id AS seller_id, event.contract_id, event.first_installment_paid_at
    FROM public.internal_users AS seller
    CROSS JOIN LATERAL public.seller_client_contract_events_for(seller.id) AS event
    WHERE seller.role = 'vendedor'
      AND event.first_installment_paid
      AND extract(month FROM event.contract_closed_at AT TIME ZONE 'America/Sao_Paulo')::integer = p_month
      AND extract(year FROM event.contract_closed_at AT TIME ZONE 'America/Sao_Paulo')::integer = p_year
  )
  UPDATE public.seller_commissions AS commission
  SET
    status = 'elegivel',
    eligible_at = coalesce(commission.eligible_at, paid.first_installment_paid_at, now())
  FROM paid_contracts AS paid
  WHERE commission.seller_id = paid.seller_id
    AND commission.contract_id = paid.contract_id
    AND commission.month = p_month
    AND commission.year = p_year
    AND commission.status IN ('pendente', 'aguardando_primeira_parcela');

  RETURN v_inserted;
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
  v_mes integer := coalesce(p_mes, extract(month FROM now())::integer);
  v_ano integer := coalesce(p_ano, extract(year FROM now())::integer);
  v_seller record;
  v_count integer;
  v_activated integer;
  v_commission numeric;
  v_bonus numeric;
  v_processed integer := 0;
  v_bonus_blocked boolean;
BEGIN
  PERFORM public.sync_seller_client_commission_rows(v_mes, v_ano);

  -- Compatibilidade com contratos antigos que foram ligados manualmente ao
  -- vendedor e usam mensalidades como fonte da primeira parcela.
  UPDATE public.seller_commissions AS commission
  SET
    status = 'elegivel',
    eligible_at = coalesce(commission.eligible_at, monthly.data_pagamento, now()),
    mensalidade_id = monthly.id
  FROM public.mensalidades AS monthly
  WHERE commission.contract_id = monthly.apolice_id
    AND lower(coalesce(monthly.status, '')) IN ('pago', 'paid', 'received')
    AND coalesce(monthly.numero_parcela, 1) = 1
    AND commission.status IN ('pendente', 'aguardando_primeira_parcela')
    AND commission.month = v_mes
    AND commission.year = v_ano;

  FOR v_seller IN
    SELECT DISTINCT commission.seller_id
    FROM public.seller_commissions AS commission
    WHERE commission.month = v_mes
      AND commission.year = v_ano
      AND commission.contract_id IS NOT NULL
      AND commission.status NOT IN ('estornada', 'cancelada')
  LOOP
    SELECT count(*)::integer
    INTO v_count
    FROM public.seller_commissions AS commission
    WHERE commission.seller_id = v_seller.seller_id
      AND commission.month = v_mes
      AND commission.year = v_ano
      AND commission.contract_id IS NOT NULL
      AND commission.status NOT IN ('estornada', 'cancelada');

    SELECT count(*)::integer
    INTO v_activated
    FROM public.seller_commissions AS commission
    WHERE commission.seller_id = v_seller.seller_id
      AND commission.month = v_mes
      AND commission.year = v_ano
      AND commission.contract_id IS NOT NULL
      AND commission.status IN ('elegivel', 'retida', 'liberada_parcial', 'liberada_total', 'paga', 'pago');

    v_commission := public.calcular_comissao_vendedor(v_count);
    SELECT coalesce(performance.bonus_bloqueado, false)
    INTO v_bonus_blocked
    FROM public.seller_performance AS performance
    WHERE performance.seller_id = v_seller.seller_id
      AND performance.month = v_mes
      AND performance.year = v_ano;
    v_bonus := CASE WHEN coalesce(v_bonus_blocked, false) THEN 0 ELSE public.calcular_bonus_vendedor(v_count) END;

    WITH ranked AS (
      SELECT
        commission.id,
        commission.status,
        row_number() OVER (
          ORDER BY coalesce(policy.created_at, commission.created_at), commission.id
        )::integer AS position
      FROM public.seller_commissions AS commission
      LEFT JOIN public.apolices AS policy ON policy.id = commission.contract_id
      WHERE commission.seller_id = v_seller.seller_id
        AND commission.month = v_mes
        AND commission.year = v_ano
        AND commission.contract_id IS NOT NULL
        AND commission.status NOT IN ('estornada', 'cancelada')
    ), valued AS (
      SELECT
        ranked.*,
        CASE
          WHEN ranked.position <= 15 THEN 35::numeric
          WHEN ranked.position <= 25 THEN 55::numeric
          ELSE 75::numeric
        END AS contract_commission,
        CASE
          WHEN ranked.position = 15 THEN 400::numeric
          WHEN ranked.position = 30 THEN 600::numeric
          WHEN ranked.position = 46 THEN 1200::numeric
          ELSE 0::numeric
        END AS milestone_bonus
      FROM ranked
    )
    UPDATE public.seller_commissions AS commission
    SET
      commission_amount = valued.contract_commission,
      bonus_amount = CASE WHEN coalesce(v_bonus_blocked, false) THEN 0 ELSE valued.milestone_bonus END,
      reserve_amount = CASE
        WHEN commission.status IN ('elegivel', 'retida') THEN valued.contract_commission * 0.15
        ELSE commission.reserve_amount
      END,
      released_amount = CASE
        WHEN commission.status IN ('elegivel', 'retida') THEN valued.contract_commission * 0.85
        ELSE commission.released_amount
      END,
      reserve_release_at = CASE
        WHEN commission.status IN ('elegivel', 'retida') THEN coalesce(commission.reserve_release_at, now() + interval '60 days')
        ELSE commission.reserve_release_at
      END,
      clawback_until = coalesce(commission.clawback_until, now() + interval '90 days'),
      status = CASE WHEN commission.status = 'elegivel' THEN 'retida' ELSE commission.status END
    FROM valued
    WHERE commission.id = valued.id;

    INSERT INTO public.seller_performance (
      seller_id,
      month,
      year,
      contracts_closed,
      contracts_activated,
      commission_total,
      bonus_total,
      total_estimated_gain
    ) VALUES (
      v_seller.seller_id,
      v_mes,
      v_ano,
      v_count,
      v_activated,
      v_commission,
      v_bonus,
      v_commission + v_bonus
    )
    ON CONFLICT (seller_id, month, year) DO UPDATE SET
      contracts_closed = excluded.contracts_closed,
      contracts_activated = excluded.contracts_activated,
      commission_total = excluded.commission_total,
      bonus_total = excluded.bonus_total,
      total_estimated_gain = excluded.total_estimated_gain,
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
  v_created_at timestamptz;
BEGIN
  SELECT policy.created_at INTO v_created_at
  FROM public.apolices AS policy
  WHERE policy.id = p_policy_id;

  IF v_created_at IS NOT NULL THEN
    PERFORM public.materializar_comissoes_vendedor(
      extract(month FROM v_created_at AT TIME ZONE 'America/Sao_Paulo')::integer,
      extract(year FROM v_created_at AT TIME ZONE 'America/Sao_Paulo')::integer
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_refresh_seller_commission_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.refresh_seller_commission_for_policy(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_seller_commission_policy ON public.apolices;
CREATE TRIGGER trg_refresh_seller_commission_policy
AFTER INSERT OR UPDATE OF consulta_id, status ON public.apolices
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_seller_commission_policy();

CREATE OR REPLACE FUNCTION public.trg_materializar_comissao_on_pagamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF lower(coalesce(NEW.status, '')) IN ('pago', 'paid', 'received')
     AND lower(coalesce(OLD.status, '')) NOT IN ('pago', 'paid', 'received')
     AND coalesce(NEW.numero_parcela, 1) = 1 THEN
    PERFORM public.refresh_seller_commission_for_policy(NEW.apolice_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_materializar_comissao_vendedor ON public.mensalidades;
CREATE TRIGGER trg_materializar_comissao_vendedor
AFTER UPDATE OF status ON public.mensalidades
FOR EACH ROW EXECUTE FUNCTION public.trg_materializar_comissao_on_pagamento();

CREATE OR REPLACE FUNCTION public.trg_refresh_seller_commission_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF lower(coalesce(NEW.status, '')) IN ('paid', 'pago', 'confirmed', 'received', 'paid_via_consolidated')
     AND lower(coalesce(OLD.status, '')) NOT IN ('paid', 'pago', 'confirmed', 'received', 'paid_via_consolidated')
     AND coalesce(NEW.numero_parcela, 1) = 1 THEN
    PERFORM public.refresh_seller_commission_for_policy(NEW.apolice_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_seller_commission_invoice ON public.faturas_inquilino;
CREATE TRIGGER trg_refresh_seller_commission_invoice
AFTER UPDATE OF status ON public.faturas_inquilino
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_seller_commission_invoice();

-- Progresso individual: uma unica fonte para site e aplicativo.
CREATE OR REPLACE FUNCTION public.get_my_seller_monthly_progress(
  p_month integer DEFAULT NULL,
  p_year integer DEFAULT NULL
)
RETURNS TABLE (
  seller_id uuid,
  target_meetings integer,
  target_clients integer,
  target_contracts integer,
  meetings_completed bigint,
  clients_registered bigint,
  contracts_closed bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_id uuid;
  v_month integer := coalesce(p_month, extract(month FROM now() AT TIME ZONE 'America/Sao_Paulo')::integer);
  v_year integer := coalesce(p_year, extract(year FROM now() AT TIME ZONE 'America/Sao_Paulo')::integer);
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  IF v_month < 1 OR v_month > 12 OR v_year < 2000 OR v_year > 9999 THEN
    RAISE EXCEPTION 'Mes ou ano invalido.';
  END IF;

  SELECT internal_user.id INTO v_seller_id
  FROM public.internal_users AS internal_user
  WHERE internal_user.auth_user_id = auth.uid()
    AND internal_user.role = 'vendedor'
    AND internal_user.status = 'ativo'
  LIMIT 1;

  IF v_seller_id IS NULL THEN
    RAISE EXCEPTION 'Somente vendedores ativos podem consultar este progresso.';
  END IF;

  v_start := make_timestamptz(v_year, v_month, 1, 0, 0, 0, 'America/Sao_Paulo');
  v_end := v_start + interval '1 month';

  RETURN QUERY
  SELECT
    v_seller_id,
    goal.target_meetings,
    goal.target_clients,
    goal.target_contracts,
    (SELECT count(*) FROM public.seller_appointments AS appointment
      WHERE appointment.seller_id = v_seller_id
        AND appointment.type = 'reuniao'
        AND appointment.status = 'concluido'
        AND appointment.scheduled_at >= v_start
        AND appointment.scheduled_at < v_end),
    (SELECT count(*) FROM public.seller_client_partnerships AS partnership
      WHERE partnership.seller_id = v_seller_id
        AND partnership.created_at >= v_start
        AND partnership.created_at < v_end),
    (SELECT count(*) FROM public.seller_client_contract_events_for(v_seller_id) AS event
      WHERE event.contract_closed_at >= v_start
        AND event.contract_closed_at < v_end)
  FROM (SELECT 1) AS singleton
  LEFT JOIN public.seller_goals AS goal
    ON goal.seller_id = v_seller_id
   AND goal.month = v_month
   AND goal.year = v_year;
END;
$$;

-- Visao da equipe para a aba Metas do administrador.
CREATE OR REPLACE FUNCTION public.get_seller_team_monthly_progress(
  p_month integer,
  p_year integer
)
RETURNS TABLE (
  seller_id uuid,
  seller_name text,
  target_meetings integer,
  target_clients integer,
  target_contracts integer,
  meetings_completed bigint,
  clients_registered bigint,
  contracts_closed bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  IF NOT (
    public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  ) THEN
    RAISE EXCEPTION 'Apenas administradores podem consultar metas da equipe.';
  END IF;
  IF p_month < 1 OR p_month > 12 OR p_year < 2000 OR p_year > 9999 THEN
    RAISE EXCEPTION 'Mes ou ano invalido.';
  END IF;

  v_start := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'America/Sao_Paulo');
  v_end := v_start + interval '1 month';

  RETURN QUERY
  SELECT
    seller.id,
    seller.full_name,
    goal.target_meetings,
    goal.target_clients,
    goal.target_contracts,
    (SELECT count(*) FROM public.seller_appointments AS appointment
      WHERE appointment.seller_id = seller.id
        AND appointment.type = 'reuniao'
        AND appointment.status = 'concluido'
        AND appointment.scheduled_at >= v_start
        AND appointment.scheduled_at < v_end),
    (SELECT count(*) FROM public.seller_client_partnerships AS partnership
      WHERE partnership.seller_id = seller.id
        AND partnership.created_at >= v_start
        AND partnership.created_at < v_end),
    (SELECT count(*) FROM public.seller_client_contract_events_for(seller.id) AS event
      WHERE event.contract_closed_at >= v_start
        AND event.contract_closed_at < v_end)
  FROM public.internal_users AS seller
  LEFT JOIN public.seller_goals AS goal
    ON goal.seller_id = seller.id
   AND goal.month = p_month
   AND goal.year = p_year
  WHERE seller.role = 'vendedor'
    AND seller.status = 'ativo'
  ORDER BY seller.full_name;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_seller_client_commission_rows(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_seller_commission_for_policy(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_seller_monthly_progress(integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_seller_team_monthly_progress(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_seller_monthly_progress(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_seller_team_monthly_progress(integer, integer) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'seller_goals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.seller_goals;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'seller_appointments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.seller_appointments;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'seller_client_partnerships'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.seller_client_partnerships;
  END IF;
END;
$$;

SELECT public.materializar_comissoes_vendedor(
  extract(month FROM now() AT TIME ZONE 'America/Sao_Paulo')::integer,
  extract(year FROM now() AT TIME ZONE 'America/Sao_Paulo')::integer
);
