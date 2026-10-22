-- Restore the shared SDR/Closer targets in the detailed goal RPCs.
--
-- The completed-meeting fix from 20261019140000 correctly credits both the
-- responsible Closer and the originating SDR, but it accidentally restored the
-- old per-seller goal join. Administrators configure these targets in
-- seller_team_goals, one row per role/month, so the old join returned NULL and
-- the support view rendered values such as 14/-- and 0%.

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
    team_goal.target_clients_daily,
    team_goal.target_clients_weekly,
    team_goal.target_clients_monthly,
    CASE WHEN v_seller_type = 'sdr' THEN team_goal.target_meetings_daily END,
    CASE WHEN v_seller_type = 'sdr' THEN team_goal.target_meetings_weekly END,
    CASE WHEN v_seller_type = 'sdr' THEN team_goal.target_meetings_monthly END,
    CASE WHEN v_seller_type = 'closer' THEN team_goal.target_meetings_daily END,
    CASE WHEN v_seller_type = 'closer' THEN team_goal.target_meetings_weekly END,
    CASE WHEN v_seller_type = 'closer' THEN team_goal.target_meetings_monthly END,
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
      WHERE (
          coalesce(appointment.assigned_closer_id, appointment.seller_id) = v_seller_id
          OR appointment.sdr_id = v_seller_id
        )
        AND appointment.type = 'reuniao'
        AND appointment.status = 'concluido'
        AND appointment.completed_at >= v_day_start AND appointment.completed_at < v_day_end),
    (SELECT count(*) FROM public.seller_appointments AS appointment
      WHERE (
          coalesce(appointment.assigned_closer_id, appointment.seller_id) = v_seller_id
          OR appointment.sdr_id = v_seller_id
        )
        AND appointment.type = 'reuniao'
        AND appointment.status = 'concluido'
        AND appointment.completed_at >= v_week_start AND appointment.completed_at < v_week_end),
    (SELECT count(*) FROM public.seller_appointments AS appointment
      WHERE (
          coalesce(appointment.assigned_closer_id, appointment.seller_id) = v_seller_id
          OR appointment.sdr_id = v_seller_id
        )
        AND appointment.type = 'reuniao'
        AND appointment.status = 'concluido'
        AND appointment.completed_at >= v_month_start AND appointment.completed_at < v_month_end)
  FROM (SELECT 1) AS singleton
  LEFT JOIN public.seller_team_goals AS team_goal
    ON team_goal.seller_type = v_seller_type
   AND team_goal.month = v_month
   AND team_goal.year = v_year;
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
    team_goal.target_clients_daily,
    team_goal.target_clients_weekly,
    team_goal.target_clients_monthly,
    CASE WHEN coalesce(seller.seller_type, 'sdr') = 'sdr' THEN team_goal.target_meetings_daily END,
    CASE WHEN coalesce(seller.seller_type, 'sdr') = 'sdr' THEN team_goal.target_meetings_weekly END,
    CASE WHEN coalesce(seller.seller_type, 'sdr') = 'sdr' THEN team_goal.target_meetings_monthly END,
    CASE WHEN coalesce(seller.seller_type, 'sdr') = 'closer' THEN team_goal.target_meetings_daily END,
    CASE WHEN coalesce(seller.seller_type, 'sdr') = 'closer' THEN team_goal.target_meetings_weekly END,
    CASE WHEN coalesce(seller.seller_type, 'sdr') = 'closer' THEN team_goal.target_meetings_monthly END,
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
      WHERE (
          coalesce(appointment.assigned_closer_id, appointment.seller_id) = seller.id
          OR appointment.sdr_id = seller.id
        )
        AND appointment.type = 'reuniao'
        AND appointment.status = 'concluido'
        AND appointment.completed_at >= v_day_start AND appointment.completed_at < v_day_end),
    (SELECT count(*) FROM public.seller_appointments AS appointment
      WHERE (
          coalesce(appointment.assigned_closer_id, appointment.seller_id) = seller.id
          OR appointment.sdr_id = seller.id
        )
        AND appointment.type = 'reuniao'
        AND appointment.status = 'concluido'
        AND appointment.completed_at >= v_week_start AND appointment.completed_at < v_week_end),
    (SELECT count(*) FROM public.seller_appointments AS appointment
      WHERE (
          coalesce(appointment.assigned_closer_id, appointment.seller_id) = seller.id
          OR appointment.sdr_id = seller.id
        )
        AND appointment.type = 'reuniao'
        AND appointment.status = 'concluido'
        AND appointment.completed_at >= v_month_start AND appointment.completed_at < v_month_end)
  FROM public.internal_users AS seller
  LEFT JOIN public.seller_team_goals AS team_goal
    ON team_goal.seller_type = coalesce(seller.seller_type, 'sdr')
   AND team_goal.month = p_month
   AND team_goal.year = p_year
  WHERE seller.role = 'vendedor'
    AND seller.status = 'ativo'
    AND NOT seller.exclude_from_commercial_metrics
    AND lower(seller.email) <> 'vendedornox@nox.com'
  ORDER BY seller.seller_type, seller.full_name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_seller_goal_progress() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_seller_team_goal_progress(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_seller_goal_progress() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_seller_team_goal_progress(integer, integer) TO authenticated;

COMMENT ON FUNCTION public.get_my_seller_goal_progress() IS
  'Retorna metas compartilhadas do time e progresso individual diario, semanal e mensal do vendedor.';
COMMENT ON FUNCTION public.get_seller_team_goal_progress(integer, integer) IS
  'Retorna metas compartilhadas de SDR/Closer e progresso individual da equipe para administradores.';
