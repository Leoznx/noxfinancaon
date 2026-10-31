-- Metas comerciais inteligentes:
--   * cria cada nova competencia a partir da anterior, somando 2 a cada alvo;
--   * preserva qualquer ajuste manual feito pelo administrador;
--   * restaura a meta e o realizado diario de leads em contato nas RPCs;
--   * entrega um unico aviso motivacional por administrador/dia util, em um
--     horario aleatorio entre 10h-11h ou 15h-16h (America/Sao_Paulo).

ALTER TABLE public.seller_team_goals
  ADD COLUMN IF NOT EXISTS generation_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS generated_from_month date,
  ADD COLUMN IF NOT EXISTS generated_at timestamptz;

ALTER TABLE public.seller_team_goals
  DROP CONSTRAINT IF EXISTS seller_team_goals_generation_mode_check;

ALTER TABLE public.seller_team_goals
  ADD CONSTRAINT seller_team_goals_generation_mode_check
  CHECK (generation_mode IN ('manual', 'automatic'));

CREATE OR REPLACE FUNCTION public.mark_seller_team_goal_as_manual()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND (
    NEW.target_meetings_daily IS DISTINCT FROM OLD.target_meetings_daily
    OR NEW.target_meetings_weekly IS DISTINCT FROM OLD.target_meetings_weekly
    OR NEW.target_meetings_monthly IS DISTINCT FROM OLD.target_meetings_monthly
    OR NEW.target_clients_daily IS DISTINCT FROM OLD.target_clients_daily
    OR NEW.target_clients_weekly IS DISTINCT FROM OLD.target_clients_weekly
    OR NEW.target_clients_monthly IS DISTINCT FROM OLD.target_clients_monthly
    OR NEW.target_calls_daily IS DISTINCT FROM OLD.target_calls_daily
    OR NEW.target_leads_contacted_daily IS DISTINCT FROM OLD.target_leads_contacted_daily
  ) THEN
    NEW.generation_mode := 'manual';
    NEW.generated_from_month := NULL;
    NEW.generated_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seller_team_goals_manual_write ON public.seller_team_goals;
CREATE TRIGGER seller_team_goals_manual_write
BEFORE UPDATE ON public.seller_team_goals
FOR EACH ROW EXECUTE FUNCTION public.mark_seller_team_goal_as_manual();

CREATE OR REPLACE FUNCTION public.materialize_seller_team_goals_month(
  p_month integer DEFAULT NULL,
  p_year integer DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_target date;
  v_source_month date;
  v_next_month date;
  v_role text;
  v_inserted integer := 0;
  v_step_count integer := 0;
BEGIN
  p_month := coalesce(p_month, extract(month FROM v_today)::integer);
  p_year := coalesce(p_year, extract(year FROM v_today)::integer);

  IF p_month NOT BETWEEN 1 AND 12 OR p_year NOT BETWEEN 2000 AND 9999 THEN
    RAISE EXCEPTION 'Mes ou ano invalido.';
  END IF;

  v_target := make_date(p_year, p_month, 1);

  FOREACH v_role IN ARRAY ARRAY['sdr', 'closer'] LOOP
    SELECT make_date(goal.year, goal.month, 1)
    INTO v_source_month
    FROM public.seller_team_goals AS goal
    WHERE goal.seller_type = v_role
      AND make_date(goal.year, goal.month, 1) <= v_target
    ORDER BY goal.year DESC, goal.month DESC
    LIMIT 1;

    IF v_source_month IS NULL OR v_source_month >= v_target THEN
      CONTINUE;
    END IF;

    WHILE v_source_month < v_target LOOP
      v_next_month := (v_source_month + interval '1 month')::date;

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
        target_calls_daily,
        target_leads_contacted_daily,
        generation_mode,
        generated_from_month,
        generated_at,
        updated_at
      )
      SELECT
        v_role,
        extract(month FROM v_next_month)::integer,
        extract(year FROM v_next_month)::integer,
        CASE WHEN source.target_meetings_daily IS NULL THEN NULL ELSE source.target_meetings_daily + 2 END,
        CASE WHEN source.target_meetings_weekly IS NULL THEN NULL ELSE source.target_meetings_weekly + 2 END,
        CASE WHEN source.target_meetings_monthly IS NULL THEN NULL ELSE source.target_meetings_monthly + 2 END,
        CASE WHEN source.target_clients_daily IS NULL THEN NULL ELSE source.target_clients_daily + 2 END,
        CASE WHEN source.target_clients_weekly IS NULL THEN NULL ELSE source.target_clients_weekly + 2 END,
        CASE WHEN source.target_clients_monthly IS NULL THEN NULL ELSE source.target_clients_monthly + 2 END,
        CASE WHEN source.target_calls_daily IS NULL THEN NULL ELSE source.target_calls_daily + 2 END,
        CASE WHEN source.target_leads_contacted_daily IS NULL THEN NULL ELSE source.target_leads_contacted_daily + 2 END,
        'automatic',
        v_source_month,
        now(),
        now()
      FROM public.seller_team_goals AS source
      WHERE source.seller_type = v_role
        AND source.month = extract(month FROM v_source_month)::integer
        AND source.year = extract(year FROM v_source_month)::integer
      ON CONFLICT (seller_type, month, year) DO NOTHING;

      GET DIAGNOSTICS v_step_count = ROW_COUNT;
      v_inserted := v_inserted + v_step_count;
      v_source_month := v_next_month;
    END LOOP;
  END LOOP;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_seller_team_goals_month(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_seller_team_goals_month(integer, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_seller_team_goal_configs(
  p_month integer,
  p_year integer
)
RETURNS TABLE (
  seller_type text,
  month integer,
  year integer,
  target_meetings_daily integer,
  target_meetings_weekly integer,
  target_meetings_monthly integer,
  target_clients_daily integer,
  target_clients_weekly integer,
  target_clients_monthly integer,
  target_calls_daily integer,
  target_leads_contacted_daily integer,
  generation_mode text,
  generated_from_month date,
  generated_at timestamptz
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

  PERFORM public.materialize_seller_team_goals_month(p_month, p_year);

  RETURN QUERY
  SELECT
    goal.seller_type,
    goal.month,
    goal.year,
    goal.target_meetings_daily,
    goal.target_meetings_weekly,
    goal.target_meetings_monthly,
    goal.target_clients_daily,
    goal.target_clients_weekly,
    goal.target_clients_monthly,
    goal.target_calls_daily,
    goal.target_leads_contacted_daily,
    goal.generation_mode,
    goal.generated_from_month,
    goal.generated_at
  FROM public.seller_team_goals AS goal
  WHERE goal.month = p_month
    AND goal.year = p_year
    AND goal.seller_type IN ('sdr', 'closer')
  ORDER BY goal.seller_type;
END;
$$;

REVOKE ALL ON FUNCTION public.get_seller_team_goal_configs(integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_seller_team_goal_configs(integer, integer)
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.get_my_seller_goal_progress();
CREATE FUNCTION public.get_my_seller_goal_progress()
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

DROP FUNCTION IF EXISTS public.get_seller_team_goal_progress(integer, integer);
CREATE FUNCTION public.get_seller_team_goal_progress(p_month integer, p_year integer)
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
  IF NOT (
    public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  ) THEN
    RAISE EXCEPTION 'Apenas administradores podem consultar metas da equipe.';
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
    coalesce(seller.seller_type, 'sdr'),
    team_goal.target_clients_daily,
    team_goal.target_clients_weekly,
    team_goal.target_clients_monthly,
    team_goal.target_calls_daily,
    team_goal.target_leads_contacted_daily,
    CASE WHEN coalesce(seller.seller_type, 'sdr') = 'sdr' THEN team_goal.target_meetings_daily END,
    CASE WHEN coalesce(seller.seller_type, 'sdr') = 'sdr' THEN team_goal.target_meetings_weekly END,
    CASE WHEN coalesce(seller.seller_type, 'sdr') = 'sdr' THEN team_goal.target_meetings_monthly END,
    CASE WHEN coalesce(seller.seller_type, 'sdr') = 'closer' THEN team_goal.target_meetings_daily END,
    CASE WHEN coalesce(seller.seller_type, 'sdr') = 'closer' THEN team_goal.target_meetings_weekly END,
    CASE WHEN coalesce(seller.seller_type, 'sdr') = 'closer' THEN team_goal.target_meetings_monthly END,
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

REVOKE ALL ON FUNCTION public.get_my_seller_goal_progress() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_seller_team_goal_progress(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_seller_goal_progress() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_seller_team_goal_progress(integer, integer) TO authenticated;

CREATE TABLE IF NOT EXISTS public.admin_goal_daily_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notice_date date NOT NULL,
  scheduled_at timestamptz NOT NULL,
  delivered_at timestamptz,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipient_user_id, notice_date)
);

ALTER TABLE public.admin_goal_daily_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_goal_daily_notices FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.admin_goal_daily_notices TO service_role;

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
      (SELECT count(*) FROM public.seller_appointments AS appointment
        WHERE (coalesce(appointment.assigned_closer_id, appointment.seller_id) = seller.id
            OR appointment.sdr_id = seller.id)
          AND appointment.type = 'reuniao'
          AND appointment.status = 'concluido'
          AND appointment.completed_at >= v_day_start AND appointment.completed_at < v_day_end) AS meetings_done
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

REVOKE ALL ON FUNCTION public.get_admin_goal_daily_notice() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_goal_daily_notice() TO authenticated, service_role;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'nox-monthly-seller-goals';
    IF v_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_job_id);
    END IF;
    PERFORM cron.schedule(
      'nox-monthly-seller-goals',
      '5 3 1 * *',
      'SELECT public.materialize_seller_team_goals_month();'
    );
  ELSE
    RAISE NOTICE 'Cron mensal de metas nao agendado: pg_cron indisponivel. As RPCs materializam a competencia sob demanda.';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Cron mensal de metas nao agendado: %', SQLERRM;
END;
$$;

SELECT public.materialize_seller_team_goals_month();

COMMENT ON FUNCTION public.materialize_seller_team_goals_month(integer, integer) IS
  'Cria competencias ausentes ate o mes solicitado, copiando a anterior e somando 2 em cada meta sem sobrescrever ajustes manuais.';
COMMENT ON FUNCTION public.get_admin_goal_daily_notice() IS
  'Entrega no maximo um aviso motivacional por administrador e dia util, em janela aleatoria das 10h ou 15h.';
