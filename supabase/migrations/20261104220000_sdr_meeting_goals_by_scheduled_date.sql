BEGIN;

-- A meta de reunioes do SDR representa as reunioes que estao marcadas no
-- periodo exibido. Usar created_at fazia uma reuniao marcada antecipadamente
-- desaparecer da meta do dia em que ela realmente acontece.
CREATE OR REPLACE FUNCTION public.count_sdr_goal_meetings(
  p_seller_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz
)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::bigint
  FROM public.seller_appointments AS appointment
  WHERE appointment.sdr_id = p_seller_id
    AND appointment.type = 'reuniao'
    AND appointment.status <> 'cancelado'
    AND appointment.scheduled_at >= p_period_start
    AND appointment.scheduled_at < p_period_end;
$$;

REVOKE ALL ON FUNCTION public.count_sdr_goal_meetings(uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

-- Fonte unica para o painel administrativo e o modo de exibicao da TV.
-- As duas superficies passam a receber exatamente os mesmos totais.
CREATE OR REPLACE FUNCTION public.seller_team_goal_progress_rows(
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
    public.count_sdr_goal_meetings(seller.id, v_day_start, v_day_end),
    public.count_sdr_goal_meetings(seller.id, v_week_start, v_week_end),
    public.count_sdr_goal_meetings(seller.id, v_month_start, v_month_end),
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

REVOKE ALL ON FUNCTION public.seller_team_goal_progress_rows(integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_seller_goal_progress()
RETURNS TABLE (
  seller_id uuid,
  seller_type text,
  month integer,
  year integer,
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
  PERFORM public.materialize_seller_team_goals_month(v_month, v_year);

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
    team_goal.target_calls_daily,
    team_goal.target_leads_contacted_daily,
    CASE WHEN v_seller_type = 'sdr' THEN team_goal.target_meetings_daily END,
    CASE WHEN v_seller_type = 'sdr' THEN team_goal.target_meetings_weekly END,
    CASE WHEN v_seller_type = 'sdr' THEN team_goal.target_meetings_monthly END,
    CASE WHEN v_seller_type = 'closer' THEN team_goal.target_meetings_daily END,
    CASE WHEN v_seller_type = 'closer' THEN team_goal.target_meetings_weekly END,
    CASE WHEN v_seller_type = 'closer' THEN team_goal.target_meetings_monthly END,
    public.count_seller_goal_registrations(v_seller_id, v_day_start, v_day_end),
    public.count_seller_goal_registrations(v_seller_id, v_week_start, v_week_end),
    public.count_seller_goal_registrations(v_seller_id, v_month_start, v_month_end),
    (SELECT count(*) FROM public.seller_commercial_events AS event
      WHERE event.seller_id = v_seller_id
        AND event.event_type = 'lead_contacted'
        AND event.occurred_at >= v_day_start AND event.occurred_at < v_day_end),
    public.count_sdr_goal_meetings(v_seller_id, v_day_start, v_day_end),
    public.count_sdr_goal_meetings(v_seller_id, v_week_start, v_week_end),
    public.count_sdr_goal_meetings(v_seller_id, v_month_start, v_month_end),
    (SELECT count(*) FROM public.seller_appointments AS appointment
      WHERE (coalesce(appointment.assigned_closer_id, appointment.seller_id) = v_seller_id
          OR appointment.sdr_id = v_seller_id)
        AND appointment.type = 'reuniao'
        AND appointment.status = 'concluido'
        AND appointment.completed_at >= v_day_start AND appointment.completed_at < v_day_end),
    (SELECT count(*) FROM public.seller_appointments AS appointment
      WHERE (coalesce(appointment.assigned_closer_id, appointment.seller_id) = v_seller_id
          OR appointment.sdr_id = v_seller_id)
        AND appointment.type = 'reuniao'
        AND appointment.status = 'concluido'
        AND appointment.completed_at >= v_week_start AND appointment.completed_at < v_week_end),
    (SELECT count(*) FROM public.seller_appointments AS appointment
      WHERE (coalesce(appointment.assigned_closer_id, appointment.seller_id) = v_seller_id
          OR appointment.sdr_id = v_seller_id)
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
BEGIN
  IF NOT (
    public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  ) THEN
    RAISE EXCEPTION 'Apenas administradores podem consultar metas da equipe.';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.seller_team_goal_progress_rows(p_month, p_year);
END;
$$;

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
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.seller_team_goal_progress_rows(p_month, p_year);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_goal_daily_notice()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_local_now timestamp := now() AT TIME ZONE 'America/Sao_Paulo';
  v_today date := v_local_now::date;
  v_day_start timestamptz := date_trunc('day', v_local_now) AT TIME ZONE 'America/Sao_Paulo';
  v_day_end timestamptz := v_day_start + interval '1 day';
  v_notice public.admin_goal_daily_notices%ROWTYPE;
  v_window_hour integer;
  v_window_end timestamp;
  v_sellers jsonb;
BEGIN
  IF NOT (
    public.is_admin(v_uid)
    OR public.has_internal_role(v_uid, 'admin_master'::public.internal_role)
  ) THEN
    RAISE EXCEPTION 'Apenas administradores podem consultar avisos de metas.';
  END IF;

  IF extract(isodow FROM v_today) > 5 OR public.is_seller_business_holiday(v_today) THEN
    RETURN jsonb_build_object('show', false, 'reason', 'non_business_day');
  END IF;

  PERFORM public.materialize_seller_team_goals_month(
    extract(month FROM v_today)::integer,
    extract(year FROM v_today)::integer
  );

  INSERT INTO public.admin_goal_daily_notices (
    recipient_user_id,
    notice_date,
    scheduled_at
  )
  VALUES (
    v_uid,
    v_today,
    (
      v_today::timestamp
      + make_interval(
          hours => CASE WHEN random() < 0.5 THEN 10 ELSE 15 END,
          mins => floor(random() * 60)::integer
        )
    ) AT TIME ZONE 'America/Sao_Paulo'
  )
  ON CONFLICT (recipient_user_id, notice_date) DO NOTHING;

  SELECT * INTO v_notice
  FROM public.admin_goal_daily_notices
  WHERE recipient_user_id = v_uid AND notice_date = v_today
  FOR UPDATE;

  IF v_notice.delivered_at IS NOT NULL THEN
    RETURN jsonb_build_object('show', false, 'reason', 'already_delivered');
  END IF;

  v_window_hour := extract(hour FROM (v_notice.scheduled_at AT TIME ZONE 'America/Sao_Paulo'))::integer;
  v_window_end := v_today::timestamp + make_interval(hours => v_window_hour + 1);

  IF now() < v_notice.scheduled_at OR v_local_now >= v_window_end THEN
    RETURN jsonb_build_object(
      'show', false,
      'reason', CASE WHEN now() < v_notice.scheduled_at THEN 'scheduled' ELSE 'window_missed' END,
      'scheduled_at', v_notice.scheduled_at
    );
  END IF;

  WITH seller_progress AS (
    SELECT
      seller.id,
      seller.full_name,
      coalesce(seller.seller_type, 'sdr') AS seller_type,
      coalesce(goal.target_leads_contacted_daily, 0) AS target_leads,
      coalesce(goal.target_clients_daily, 0) AS target_clients,
      coalesce(goal.target_meetings_daily, 0) AS target_meetings,
      (SELECT count(*) FROM public.seller_commercial_events AS event
        WHERE event.seller_id = seller.id
          AND event.event_type = 'lead_contacted'
          AND event.occurred_at >= v_day_start AND event.occurred_at < v_day_end) AS leads_done,
      public.count_seller_goal_registrations(seller.id, v_day_start, v_day_end) AS clients_done,
      CASE
        WHEN coalesce(seller.seller_type, 'sdr') = 'sdr'
          THEN public.count_sdr_goal_meetings(seller.id, v_day_start, v_day_end)
        ELSE (SELECT count(*) FROM public.seller_appointments AS appointment
          WHERE coalesce(appointment.assigned_closer_id, appointment.seller_id) = seller.id
            AND appointment.type = 'reuniao'
            AND appointment.status = 'concluido'
            AND appointment.completed_at >= v_day_start
            AND appointment.completed_at < v_day_end)
      END AS meetings_done
    FROM public.internal_users AS seller
    LEFT JOIN public.seller_team_goals AS goal
      ON goal.seller_type = coalesce(seller.seller_type, 'sdr')
     AND goal.month = extract(month FROM v_today)::integer
     AND goal.year = extract(year FROM v_today)::integer
    WHERE seller.role = 'vendedor'
      AND seller.status = 'ativo'
      AND NOT seller.exclude_from_commercial_metrics
      AND lower(seller.email) <> 'vendedornox@nox.com'
  ), missing AS (
    SELECT
      *,
      greatest(target_leads - leads_done, 0) AS leads_missing,
      greatest(target_clients - clients_done, 0) AS clients_missing,
      greatest(target_meetings - meetings_done, 0) AS meetings_missing
    FROM seller_progress
  )
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'seller_id', id,
      'seller_name', full_name,
      'seller_type', seller_type,
      'leads_done', leads_done,
      'leads_target', target_leads,
      'leads_missing', leads_missing,
      'clients_missing', clients_missing,
      'meetings_missing', meetings_missing
    ) ORDER BY leads_missing DESC, clients_missing DESC, meetings_missing DESC, full_name
  ), '[]'::jsonb)
  INTO v_sellers
  FROM missing
  WHERE leads_missing > 0 OR clients_missing > 0 OR meetings_missing > 0;

  UPDATE public.admin_goal_daily_notices
  SET delivered_at = now(), payload = v_sellers
  WHERE id = v_notice.id;

  IF jsonb_array_length(v_sellers) = 0 THEN
    RETURN jsonb_build_object('show', false, 'reason', 'all_goals_met');
  END IF;

  RETURN jsonb_build_object(
    'show', true,
    'notice_date', v_today,
    'scheduled_at', v_notice.scheduled_at,
    'title', 'Foco nas metas de hoje',
    'message', 'Ainda há metas diárias em aberto. Mais foco e determinação para fechar o dia forte.',
    'sellers', v_sellers
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_seller_goal_progress() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_seller_team_goal_progress(integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_tv_display_goal_progress(integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_admin_goal_daily_notice() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_my_seller_goal_progress() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_seller_team_goal_progress(integer, integer)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tv_display_goal_progress(integer, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_goal_daily_notice()
  TO authenticated, service_role;

COMMENT ON FUNCTION public.count_sdr_goal_meetings(uuid, timestamptz, timestamptz) IS
  'Conta reunioes do SDR pela data marcada (scheduled_at), excluindo cancelamentos.';
COMMENT ON FUNCTION public.get_my_seller_goal_progress() IS
  'Metas pessoais; reunioes agendadas do SDR contam no dia, semana e mes da data marcada.';
COMMENT ON FUNCTION public.get_seller_team_goal_progress(integer, integer) IS
  'Metas da equipe; reunioes agendadas do SDR contam no periodo da data marcada.';
COMMENT ON FUNCTION public.get_tv_display_goal_progress(integer, integer) IS
  'Metricas minimas da TV; reunioes do SDR contam pela data marcada e acesso permanece exclusivo da service_role.';

NOTIFY pgrst, 'reload schema';

COMMIT;
