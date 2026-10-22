-- Uma reuniao marcada pelo SDR so entra na meta quando ela realmente e
-- concluida. O mesmo encerramento deve creditar o Closer responsavel e o SDR
-- de origem, usando completed_at como data contabil.

CREATE OR REPLACE FUNCTION public.enforce_closer_meeting_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid;
BEGIN
  IF NEW.type <> 'reuniao'
     OR NEW.status <> 'concluido'
     OR (TG_OP = 'UPDATE' AND OLD.status = 'concluido') THEN
    RETURN NEW;
  END IF;

  -- Jobs e migracoes nao possuem usuario autenticado. Clientes interativos
  -- precisam ser o Closer responsavel ou o SDR que originou a reuniao.
  IF auth.uid() IS NOT NULL THEN
    SELECT seller.id
    INTO v_actor_id
    FROM public.internal_users AS seller
    WHERE seller.auth_user_id = auth.uid()
      AND seller.role = 'vendedor'
      AND seller.status = 'ativo'
    LIMIT 1;

    IF v_actor_id IS NULL
       OR (
         v_actor_id IS DISTINCT FROM coalesce(NEW.assigned_closer_id, NEW.seller_id)
         AND v_actor_id IS DISTINCT FROM NEW.sdr_id
       ) THEN
      RAISE EXCEPTION 'Somente o Closer responsavel ou o SDR que marcou podem concluir esta reuniao.';
    END IF;

    IF clock_timestamp() < NEW.scheduled_at THEN
      RAISE EXCEPTION 'A reuniao pode ser concluida a partir do horario de inicio.';
    END IF;
  END IF;

  -- Garante que ate clientes antigos, que atualizam apenas o status, gravem
  -- a data usada pelas metas e nao produzam reunioes concluidas invisiveis.
  NEW.completed_at := coalesce(NEW.completed_at, clock_timestamp());
  NEW.actual_duration_minutes := coalesce(
    NEW.actual_duration_minutes,
    public.seller_meeting_actual_duration_minutes(NEW.scheduled_at, NEW.completed_at)
  );

  RETURN NEW;
END;
$$;

-- Recupera conclusoes antigas que tenham sido feitas por uma versao anterior
-- do aplicativo sem preencher completed_at.
UPDATE public.seller_appointments AS appointment
SET completed_at = greatest(appointment.scheduled_at, appointment.updated_at),
    actual_duration_minutes = coalesce(
      appointment.actual_duration_minutes,
      public.seller_meeting_actual_duration_minutes(
        appointment.scheduled_at,
        greatest(appointment.scheduled_at, appointment.updated_at)
      )
    )
WHERE appointment.type = 'reuniao'
  AND appointment.status = 'concluido'
  AND appointment.completed_at IS NULL;

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
    (SELECT count(*)
     FROM public.seller_appointments AS appointment
     WHERE (
         coalesce(appointment.assigned_closer_id, appointment.seller_id) = v_seller_id
         OR appointment.sdr_id = v_seller_id
       )
       AND appointment.type = 'reuniao'
       AND appointment.status = 'concluido'
       AND appointment.completed_at >= v_start
       AND appointment.completed_at < v_end),
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
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
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
    team_goal.target_meetings_monthly,
    team_goal.target_clients_monthly,
    individual_goal.target_contracts,
    (SELECT count(*)
     FROM public.seller_appointments AS appointment
     WHERE (
         coalesce(appointment.assigned_closer_id, appointment.seller_id) = seller.id
         OR appointment.sdr_id = seller.id
       )
       AND appointment.type = 'reuniao'
       AND appointment.status = 'concluido'
       AND appointment.completed_at >= v_start
       AND appointment.completed_at < v_end),
    public.count_seller_goal_registrations(seller.id, v_start, v_end),
    (SELECT count(*) FROM public.seller_client_contract_events_for(seller.id) AS event
      WHERE event.contract_closed_at >= v_start
        AND event.contract_closed_at < v_end)
  FROM public.internal_users AS seller
  LEFT JOIN public.seller_team_goals AS team_goal
    ON team_goal.seller_type = coalesce(seller.seller_type, 'sdr')
   AND team_goal.month = p_month
   AND team_goal.year = p_year
  LEFT JOIN public.seller_goals AS individual_goal
    ON individual_goal.seller_id = seller.id
   AND individual_goal.month = p_month
   AND individual_goal.year = p_year
  WHERE seller.role = 'vendedor'
    AND seller.status = 'ativo'
    AND NOT seller.exclude_from_commercial_metrics
    AND lower(seller.email) <> 'vendedornox@nox.com'
  ORDER BY seller.seller_type, seller.full_name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_seller_monthly_progress(integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_seller_team_monthly_progress(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_seller_monthly_progress(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_seller_team_monthly_progress(integer, integer) TO authenticated;

COMMENT ON FUNCTION public.get_my_seller_monthly_progress(integer, integer) IS
  'Progresso mensal do vendedor; reunioes contam somente apos conclusao e creditam Closer e SDR de origem.';
COMMENT ON FUNCTION public.get_seller_team_monthly_progress(integer, integer) IS
  'Progresso mensal da equipe; reunioes contam somente apos conclusao e creditam Closer e SDR de origem.';
