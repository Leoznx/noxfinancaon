-- O APK da TV não recebe credenciais administrativas. Esta RPC é executável
-- somente pela service_role da Edge Function e expõe apenas as métricas que já
-- aparecem fisicamente no painel competitivo.

CREATE OR REPLACE FUNCTION public.get_tv_display_goal_progress(
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
  target_calls_daily integer,
  target_leads_contacted_daily integer,
  target_meetings_scheduled_daily integer,
  target_meetings_scheduled_weekly integer,
  target_meetings_scheduled_monthly integer,
  target_meetings_completed_daily integer,
  target_meetings_completed_weekly integer,
  target_meetings_completed_monthly integer,
  clients_registered_daily bigint,
  clients_registered_weekly bigint,
  clients_registered_monthly bigint,
  leads_contacted_daily bigint,
  meetings_scheduled_daily bigint,
  meetings_scheduled_weekly bigint,
  meetings_scheduled_monthly bigint,
  meetings_completed_daily bigint,
  meetings_completed_weekly bigint,
  meetings_completed_monthly bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_month NOT BETWEEN 1 AND 12 OR p_year NOT BETWEEN 2000 AND 9999 THEN
    RAISE EXCEPTION 'Mes ou ano invalido.';
  END IF;

  PERFORM public.materialize_seller_team_goals_month(p_month, p_year);

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
    coalesce(seller.seller_type, 'sdr')::text,
    team_goal.target_clients_daily,
    team_goal.target_clients_weekly,
    team_goal.target_clients_monthly,
    team_goal.target_calls_daily,
    team_goal.target_leads_contacted_daily,
    CASE WHEN coalesce(seller.seller_type, 'sdr') = 'sdr'
      THEN team_goal.target_meetings_daily END,
    CASE WHEN coalesce(seller.seller_type, 'sdr') = 'sdr'
      THEN team_goal.target_meetings_weekly END,
    CASE WHEN coalesce(seller.seller_type, 'sdr') = 'sdr'
      THEN team_goal.target_meetings_monthly END,
    CASE WHEN coalesce(seller.seller_type, 'sdr') = 'closer'
      THEN team_goal.target_meetings_daily END,
    CASE WHEN coalesce(seller.seller_type, 'sdr') = 'closer'
      THEN team_goal.target_meetings_weekly END,
    CASE WHEN coalesce(seller.seller_type, 'sdr') = 'closer'
      THEN team_goal.target_meetings_monthly END,
    public.count_seller_goal_registrations(seller.id, v_day_start, v_day_end),
    public.count_seller_goal_registrations(seller.id, v_week_start, v_week_end),
    public.count_seller_goal_registrations(seller.id, v_month_start, v_month_end),
    (SELECT count(*) FROM public.seller_commercial_events AS event
      WHERE event.seller_id = seller.id
        AND event.event_type = 'lead_contacted'
        AND event.occurred_at >= v_day_start AND event.occurred_at < v_day_end),
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
      WHERE (coalesce(appointment.assigned_closer_id, appointment.seller_id) = seller.id
          OR appointment.sdr_id = seller.id)
        AND appointment.type = 'reuniao'
        AND appointment.status = 'concluido'
        AND appointment.completed_at >= v_day_start AND appointment.completed_at < v_day_end),
    (SELECT count(*) FROM public.seller_appointments AS appointment
      WHERE (coalesce(appointment.assigned_closer_id, appointment.seller_id) = seller.id
          OR appointment.sdr_id = seller.id)
        AND appointment.type = 'reuniao'
        AND appointment.status = 'concluido'
        AND appointment.completed_at >= v_week_start AND appointment.completed_at < v_week_end),
    (SELECT count(*) FROM public.seller_appointments AS appointment
      WHERE (coalesce(appointment.assigned_closer_id, appointment.seller_id) = seller.id
          OR appointment.sdr_id = seller.id)
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

REVOKE ALL ON FUNCTION public.get_tv_display_goal_progress(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tv_display_goal_progress(integer, integer)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.ranking_vendedores(integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.get_tv_display_goal_progress(integer, integer) IS
  'Métricas mínimas do painel APK; acesso exclusivo da Edge Function via service_role.';
