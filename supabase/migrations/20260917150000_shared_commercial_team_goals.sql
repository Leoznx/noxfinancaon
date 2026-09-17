-- Metas comerciais compartilhadas por equipe.
--
-- Existe uma unica configuracao por mes para SDR e outra para Closer.
-- Cada vendedor recebe automaticamente a meta do seu time, inclusive quem
-- entrar na equipe depois da configuracao, enquanto o progresso permanece
-- individual e calculado pelas fontes de verdade.

CREATE TABLE IF NOT EXISTS public.seller_team_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_type text NOT NULL CHECK (seller_type IN ('sdr', 'closer')),
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  year integer NOT NULL CHECK (year BETWEEN 2000 AND 9999),
  target_meetings_daily integer CHECK (target_meetings_daily >= 0),
  target_meetings_weekly integer CHECK (target_meetings_weekly >= 0),
  target_meetings_monthly integer CHECK (target_meetings_monthly >= 0),
  target_clients_daily integer CHECK (target_clients_daily >= 0),
  target_clients_weekly integer CHECK (target_clients_weekly >= 0),
  target_clients_monthly integer CHECK (target_clients_monthly >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (seller_type, month, year)
);

ALTER TABLE public.seller_team_goals ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.seller_team_goals TO authenticated;
GRANT ALL ON public.seller_team_goals TO service_role;

DROP POLICY IF EXISTS "seller_team_goals read" ON public.seller_team_goals;
CREATE POLICY "seller_team_goals read"
ON public.seller_team_goals
FOR SELECT
TO authenticated
USING (
  public.is_admin(auth.uid())
  OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  OR EXISTS (
    SELECT 1
    FROM public.internal_users AS current_seller
    WHERE current_seller.auth_user_id = auth.uid()
      AND current_seller.role = 'vendedor'
      AND current_seller.status = 'ativo'
      AND coalesce(current_seller.seller_type, 'sdr') = seller_team_goals.seller_type
  )
);

-- Preserva como ponto de partida a configuracao individual alterada mais
-- recentemente em cada equipe/mes. A partir desta migracao, novas alteracoes
-- sao gravadas somente na configuracao compartilhada.
WITH ranked_existing_goal AS (
  SELECT
    coalesce(seller.seller_type, 'sdr') AS seller_type,
    goal.month,
    goal.year,
    goal.target_clients_daily,
    goal.target_clients_weekly,
    goal.target_clients AS target_clients_monthly,
    CASE
      WHEN coalesce(seller.seller_type, 'sdr') = 'closer'
        THEN goal.target_meetings_completed_daily
      ELSE goal.target_meetings_scheduled_daily
    END AS target_meetings_daily,
    CASE
      WHEN coalesce(seller.seller_type, 'sdr') = 'closer'
        THEN goal.target_meetings_completed_weekly
      ELSE goal.target_meetings_scheduled_weekly
    END AS target_meetings_weekly,
    CASE
      WHEN coalesce(seller.seller_type, 'sdr') = 'closer'
        THEN goal.target_meetings_completed_monthly
      ELSE goal.target_meetings_scheduled_monthly
    END AS target_meetings_monthly,
    row_number() OVER (
      PARTITION BY coalesce(seller.seller_type, 'sdr'), goal.month, goal.year
      ORDER BY goal.updated_at DESC NULLS LAST, goal.created_at DESC, goal.id
    ) AS position
  FROM public.seller_goals AS goal
  JOIN public.internal_users AS seller ON seller.id = goal.seller_id
  WHERE seller.role = 'vendedor'
    AND coalesce(seller.seller_type, 'sdr') IN ('sdr', 'closer')
)
INSERT INTO public.seller_team_goals (
  seller_type,
  month,
  year,
  target_meetings_daily,
  target_meetings_weekly,
  target_meetings_monthly,
  target_clients_daily,
  target_clients_weekly,
  target_clients_monthly
)
SELECT
  seller_type,
  month,
  year,
  target_meetings_daily,
  target_meetings_weekly,
  target_meetings_monthly,
  target_clients_daily,
  target_clients_weekly,
  target_clients_monthly
FROM ranked_existing_goal
WHERE position = 1
ON CONFLICT (seller_type, month, year) DO NOTHING;

CREATE OR REPLACE FUNCTION public.upsert_seller_team_goals(
  p_seller_type text,
  p_month integer,
  p_year integer,
  p_target_meetings_daily integer,
  p_target_meetings_weekly integer,
  p_target_meetings_monthly integer,
  p_target_clients_daily integer,
  p_target_clients_weekly integer,
  p_target_clients_monthly integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (
    public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  ) THEN
    RAISE EXCEPTION 'Apenas administradores podem definir metas da equipe.';
  END IF;

  IF p_seller_type NOT IN ('sdr', 'closer') THEN
    RAISE EXCEPTION 'Equipe comercial invalida.';
  END IF;
  IF p_month < 1 OR p_month > 12 OR p_year < 2000 OR p_year > 9999 THEN
    RAISE EXCEPTION 'Mes ou ano invalido.';
  END IF;
  IF p_target_meetings_daily IS NULL
     OR p_target_meetings_weekly IS NULL
     OR p_target_meetings_monthly IS NULL
     OR p_target_clients_daily IS NULL
     OR p_target_clients_weekly IS NULL
     OR p_target_clients_monthly IS NULL
     OR least(
       p_target_meetings_daily,
       p_target_meetings_weekly,
       p_target_meetings_monthly,
       p_target_clients_daily,
       p_target_clients_weekly,
       p_target_clients_monthly
     ) < 0 THEN
    RAISE EXCEPTION 'As seis metas devem ser numeros inteiros maiores ou iguais a zero.';
  END IF;

  INSERT INTO public.seller_team_goals (
    seller_type,
    month,
    year,
    target_meetings_daily,
    target_meetings_weekly,
    target_meetings_monthly,
    target_clients_daily,
    target_clients_weekly,
    target_clients_monthly,
    updated_at
  )
  VALUES (
    p_seller_type,
    p_month,
    p_year,
    p_target_meetings_daily,
    p_target_meetings_weekly,
    p_target_meetings_monthly,
    p_target_clients_daily,
    p_target_clients_weekly,
    p_target_clients_monthly,
    now()
  )
  ON CONFLICT (seller_type, month, year) DO UPDATE
  SET target_meetings_daily = EXCLUDED.target_meetings_daily,
      target_meetings_weekly = EXCLUDED.target_meetings_weekly,
      target_meetings_monthly = EXCLUDED.target_meetings_monthly,
      target_clients_daily = EXCLUDED.target_clients_daily,
      target_clients_weekly = EXCLUDED.target_clients_weekly,
      target_clients_monthly = EXCLUDED.target_clients_monthly,
      updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_seller_goal_progress()
RETURNS TABLE (
  seller_id uuid,
  seller_type text,
  month integer,
  year integer,
  target_clients_daily integer,
  target_clients_weekly integer,
  target_clients_monthly integer,
  target_meetings_scheduled_daily integer,
  target_meetings_scheduled_weekly integer,
  target_meetings_scheduled_monthly integer,
  target_meetings_completed_daily integer,
  target_meetings_completed_weekly integer,
  target_meetings_completed_monthly integer,
  clients_registered_daily bigint,
  clients_registered_weekly bigint,
  clients_registered_monthly bigint,
  meetings_scheduled_daily bigint,
  meetings_scheduled_weekly bigint,
  meetings_scheduled_monthly bigint,
  meetings_completed_daily bigint,
  meetings_completed_weekly bigint,
  meetings_completed_monthly bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_id uuid;
  v_seller_type text;
  v_now_local timestamp := now() AT TIME ZONE 'America/Sao_Paulo';
  v_month integer;
  v_year integer;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_week_start timestamptz;
  v_week_end timestamptz;
  v_month_start timestamptz;
  v_month_end timestamptz;
BEGIN
  SELECT seller.id, coalesce(seller.seller_type, 'sdr')
  INTO v_seller_id, v_seller_type
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid()
    AND seller.role = 'vendedor'
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_seller_id IS NULL THEN
    RAISE EXCEPTION 'Somente vendedores ativos podem consultar metas.';
  END IF;

  v_month := extract(month FROM v_now_local)::integer;
  v_year := extract(year FROM v_now_local)::integer;
  v_day_start := date_trunc('day', v_now_local) AT TIME ZONE 'America/Sao_Paulo';
  v_day_end := v_day_start + interval '1 day';
  v_week_start := date_trunc('week', v_now_local) AT TIME ZONE 'America/Sao_Paulo';
  v_week_end := v_week_start + interval '7 days';
  v_month_start := date_trunc('month', v_now_local) AT TIME ZONE 'America/Sao_Paulo';
  v_month_end := v_month_start + interval '1 month';

  RETURN QUERY
  SELECT
    v_seller_id,
    v_seller_type,
    v_month,
    v_year,
    goal.target_clients_daily,
    goal.target_clients_weekly,
    goal.target_clients_monthly,
    CASE WHEN v_seller_type = 'sdr' THEN goal.target_meetings_daily END,
    CASE WHEN v_seller_type = 'sdr' THEN goal.target_meetings_weekly END,
    CASE WHEN v_seller_type = 'sdr' THEN goal.target_meetings_monthly END,
    CASE WHEN v_seller_type = 'closer' THEN goal.target_meetings_daily END,
    CASE WHEN v_seller_type = 'closer' THEN goal.target_meetings_weekly END,
    CASE WHEN v_seller_type = 'closer' THEN goal.target_meetings_monthly END,
    public.count_seller_goal_registrations(v_seller_id, v_day_start, v_day_end),
    public.count_seller_goal_registrations(v_seller_id, v_week_start, v_week_end),
    public.count_seller_goal_registrations(v_seller_id, v_month_start, v_month_end),
    (SELECT count(*) FROM public.seller_appointments AS appointment
      WHERE appointment.sdr_id = v_seller_id
        AND appointment.type = 'reuniao'
        AND appointment.status <> 'cancelado'
        AND appointment.created_at >= v_day_start AND appointment.created_at < v_day_end),
    (SELECT count(*) FROM public.seller_appointments AS appointment
      WHERE appointment.sdr_id = v_seller_id
        AND appointment.type = 'reuniao'
        AND appointment.status <> 'cancelado'
        AND appointment.created_at >= v_week_start AND appointment.created_at < v_week_end),
    (SELECT count(*) FROM public.seller_appointments AS appointment
      WHERE appointment.sdr_id = v_seller_id
        AND appointment.type = 'reuniao'
        AND appointment.status <> 'cancelado'
        AND appointment.created_at >= v_month_start AND appointment.created_at < v_month_end),
    (SELECT count(*) FROM public.seller_appointments AS appointment
      WHERE coalesce(appointment.assigned_closer_id, appointment.seller_id) = v_seller_id
        AND appointment.type = 'reuniao'
        AND appointment.status = 'concluido'
        AND appointment.completed_at >= v_day_start AND appointment.completed_at < v_day_end),
    (SELECT count(*) FROM public.seller_appointments AS appointment
      WHERE coalesce(appointment.assigned_closer_id, appointment.seller_id) = v_seller_id
        AND appointment.type = 'reuniao'
        AND appointment.status = 'concluido'
        AND appointment.completed_at >= v_week_start AND appointment.completed_at < v_week_end),
    (SELECT count(*) FROM public.seller_appointments AS appointment
      WHERE coalesce(appointment.assigned_closer_id, appointment.seller_id) = v_seller_id
        AND appointment.type = 'reuniao'
        AND appointment.status = 'concluido'
        AND appointment.completed_at >= v_month_start AND appointment.completed_at < v_month_end)
  FROM (SELECT 1) AS singleton
  LEFT JOIN public.seller_team_goals AS goal
    ON goal.seller_type = v_seller_type
   AND goal.month = v_month
   AND goal.year = v_year;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_seller_team_goal_progress(
  p_month integer,
  p_year integer
)
RETURNS TABLE (
  seller_id uuid,
  seller_name text,
  seller_type text,
  target_clients_daily integer,
  target_clients_weekly integer,
  target_clients_monthly integer,
  target_meetings_scheduled_daily integer,
  target_meetings_scheduled_weekly integer,
  target_meetings_scheduled_monthly integer,
  target_meetings_completed_daily integer,
  target_meetings_completed_weekly integer,
  target_meetings_completed_monthly integer,
  clients_registered_daily bigint,
  clients_registered_weekly bigint,
  clients_registered_monthly bigint,
  meetings_scheduled_daily bigint,
  meetings_scheduled_weekly bigint,
  meetings_scheduled_monthly bigint,
  meetings_completed_daily bigint,
  meetings_completed_weekly bigint,
  meetings_completed_monthly bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_now_local timestamp := now() AT TIME ZONE 'America/Sao_Paulo';
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_week_start timestamptz;
  v_week_end timestamptz;
  v_month_start timestamptz;
  v_month_end timestamptz;
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

  v_day_start := date_trunc('day', v_now_local) AT TIME ZONE 'America/Sao_Paulo';
  v_day_end := v_day_start + interval '1 day';
  v_week_start := date_trunc('week', v_now_local) AT TIME ZONE 'America/Sao_Paulo';
  v_week_end := v_week_start + interval '7 days';
  v_month_start := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'America/Sao_Paulo');
  v_month_end := v_month_start + interval '1 month';

  RETURN QUERY
  SELECT
    seller.id,
    seller.full_name,
    coalesce(seller.seller_type, 'sdr'),
    goal.target_clients_daily,
    goal.target_clients_weekly,
    goal.target_clients_monthly,
    CASE WHEN coalesce(seller.seller_type, 'sdr') = 'sdr' THEN goal.target_meetings_daily END,
    CASE WHEN coalesce(seller.seller_type, 'sdr') = 'sdr' THEN goal.target_meetings_weekly END,
    CASE WHEN coalesce(seller.seller_type, 'sdr') = 'sdr' THEN goal.target_meetings_monthly END,
    CASE WHEN coalesce(seller.seller_type, 'sdr') = 'closer' THEN goal.target_meetings_daily END,
    CASE WHEN coalesce(seller.seller_type, 'sdr') = 'closer' THEN goal.target_meetings_weekly END,
    CASE WHEN coalesce(seller.seller_type, 'sdr') = 'closer' THEN goal.target_meetings_monthly END,
    public.count_seller_goal_registrations(seller.id, v_day_start, v_day_end),
    public.count_seller_goal_registrations(seller.id, v_week_start, v_week_end),
    public.count_seller_goal_registrations(seller.id, v_month_start, v_month_end),
    (SELECT count(*) FROM public.seller_appointments AS appointment
      WHERE appointment.sdr_id = seller.id
        AND appointment.type = 'reuniao'
        AND appointment.status <> 'cancelado'
        AND appointment.created_at >= v_day_start AND appointment.created_at < v_day_end),
    (SELECT count(*) FROM public.seller_appointments AS appointment
      WHERE appointment.sdr_id = seller.id
        AND appointment.type = 'reuniao'
        AND appointment.status <> 'cancelado'
        AND appointment.created_at >= v_week_start AND appointment.created_at < v_week_end),
    (SELECT count(*) FROM public.seller_appointments AS appointment
      WHERE appointment.sdr_id = seller.id
        AND appointment.type = 'reuniao'
        AND appointment.status <> 'cancelado'
        AND appointment.created_at >= v_month_start AND appointment.created_at < v_month_end),
    (SELECT count(*) FROM public.seller_appointments AS appointment
      WHERE coalesce(appointment.assigned_closer_id, appointment.seller_id) = seller.id
        AND appointment.type = 'reuniao'
        AND appointment.status = 'concluido'
        AND appointment.completed_at >= v_day_start AND appointment.completed_at < v_day_end),
    (SELECT count(*) FROM public.seller_appointments AS appointment
      WHERE coalesce(appointment.assigned_closer_id, appointment.seller_id) = seller.id
        AND appointment.type = 'reuniao'
        AND appointment.status = 'concluido'
        AND appointment.completed_at >= v_week_start AND appointment.completed_at < v_week_end),
    (SELECT count(*) FROM public.seller_appointments AS appointment
      WHERE coalesce(appointment.assigned_closer_id, appointment.seller_id) = seller.id
        AND appointment.type = 'reuniao'
        AND appointment.status = 'concluido'
        AND appointment.completed_at >= v_month_start AND appointment.completed_at < v_month_end)
  FROM public.internal_users AS seller
  LEFT JOIN public.seller_team_goals AS goal
    ON goal.seller_type = coalesce(seller.seller_type, 'sdr')
   AND goal.month = p_month
   AND goal.year = p_year
  WHERE seller.role = 'vendedor'
    AND seller.status = 'ativo'
    AND NOT seller.exclude_from_commercial_metrics
    AND lower(seller.email) <> 'vendedornox@nox.com'
  ORDER BY seller.seller_type, seller.full_name;
END;
$$;

-- Mantem a tela mensal legada do vendedor coerente com a nova configuracao:
-- reunioes e cadastros tambem passam a usar as metas compartilhadas do time.
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
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_id uuid;
  v_seller_type text;
  v_month integer := coalesce(
    p_month,
    extract(month FROM now() AT TIME ZONE 'America/Sao_Paulo')::integer
  );
  v_year integer := coalesce(
    p_year,
    extract(year FROM now() AT TIME ZONE 'America/Sao_Paulo')::integer
  );
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  IF v_month < 1 OR v_month > 12 OR v_year < 2000 OR v_year > 9999 THEN
    RAISE EXCEPTION 'Mes ou ano invalido.';
  END IF;

  SELECT seller.id, coalesce(seller.seller_type, 'sdr')
  INTO v_seller_id, v_seller_type
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid()
    AND seller.role = 'vendedor'
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_seller_id IS NULL THEN
    RAISE EXCEPTION 'Somente vendedores ativos podem consultar este progresso.';
  END IF;

  v_start := make_timestamptz(v_year, v_month, 1, 0, 0, 0, 'America/Sao_Paulo');
  v_end := v_start + interval '1 month';

  RETURN QUERY
  SELECT
    v_seller_id,
    team_goal.target_meetings_monthly,
    team_goal.target_clients_monthly,
    individual_goal.target_contracts,
    CASE
      WHEN v_seller_type = 'sdr' THEN (
        SELECT count(*)
        FROM public.seller_appointments AS appointment
        WHERE appointment.sdr_id = v_seller_id
          AND appointment.type = 'reuniao'
          AND appointment.status <> 'cancelado'
          AND appointment.created_at >= v_start
          AND appointment.created_at < v_end
      )
      ELSE (
        SELECT count(*)
        FROM public.seller_appointments AS appointment
        WHERE coalesce(appointment.assigned_closer_id, appointment.seller_id) = v_seller_id
          AND appointment.type = 'reuniao'
          AND appointment.status = 'concluido'
          AND appointment.completed_at >= v_start
          AND appointment.completed_at < v_end
      )
    END,
    public.count_seller_goal_registrations(v_seller_id, v_start, v_end),
    (SELECT count(*) FROM public.seller_client_contract_events_for(v_seller_id) AS event
      WHERE event.contract_closed_at >= v_start
        AND event.contract_closed_at < v_end)
  FROM (SELECT 1) AS singleton
  LEFT JOIN public.seller_team_goals AS team_goal
    ON team_goal.seller_type = v_seller_type
   AND team_goal.month = v_month
   AND team_goal.year = v_year
  LEFT JOIN public.seller_goals AS individual_goal
    ON individual_goal.seller_id = v_seller_id
   AND individual_goal.month = v_month
   AND individual_goal.year = v_year;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_seller_team_goals(
  text, integer, integer, integer, integer, integer, integer, integer, integer
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_seller_goal_progress() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_seller_team_goal_progress(integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_seller_monthly_progress(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_seller_team_goals(
  text, integer, integer, integer, integer, integer, integer, integer, integer
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_seller_goal_progress() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_seller_team_goal_progress(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_seller_monthly_progress(integer, integer) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'seller_team_goals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.seller_team_goals;
  END IF;
END;
$$;

COMMENT ON TABLE public.seller_team_goals IS
  'Configuracao mensal unica de metas para todos os integrantes ativos de cada equipe comercial.';
COMMENT ON FUNCTION public.upsert_seller_team_goals(
  text, integer, integer, integer, integer, integer, integer, integer, integer
) IS 'Define as seis metas compartilhadas por todos os integrantes de uma equipe comercial.';
COMMENT ON FUNCTION public.get_my_seller_goal_progress() IS
  'Retorna a meta compartilhada da equipe e o progresso individual do vendedor autenticado.';
COMMENT ON FUNCTION public.get_seller_team_goal_progress(integer, integer) IS
  'Retorna a mesma meta para cada integrante da equipe e o progresso individual de cada vendedor.';
