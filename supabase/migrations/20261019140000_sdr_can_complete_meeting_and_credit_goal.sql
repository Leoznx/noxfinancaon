-- Permite que o SDR que marcou a reuniao tambem conclua o compromisso
-- (hoje so o Closer responsavel podia), e credita a reuniao concluida
-- tambem na meta meetings_completed_* do SDR que a marcou — hoje so o
-- Closer recebia esse credito, o que escondia o esforco do SDR nas
-- metas da equipe.
--
-- Mudancas:
--   1. Trigger enforce_closer_meeting_completion passa a aceitar o SDR
--      que marcou (sdr_id) como ator valido da conclusao.
--   2. RPC complete_closer_meeting aceita Closer OU SDR da reuniao.
--   3. RPCs get_my_seller_goal_progress / get_seller_team_goal_progress
--      somam reunioes concluidas tanto para o Closer (como ja fazem)
--      quanto para o SDR (sdr_id). Isso vale no dia, semana e mes.

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

  -- SQL migrations and service jobs have no authenticated user. Interactive
  -- clients devem ser o Closer responsavel OU o SDR que marcou a reuniao.
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

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_closer_meeting(
  p_appointment_id uuid,
  p_feedback text
)
RETURNS public.seller_appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid;
  v_completed_at timestamptz;
  v_meeting public.seller_appointments%ROWTYPE;
BEGIN
  SELECT seller.id
  INTO v_actor_id
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid()
    AND seller.role = 'vendedor'
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Somente vendedores ativos podem concluir reunioes.';
  END IF;

  SELECT appointment.*
  INTO v_meeting
  FROM public.seller_appointments AS appointment
  WHERE appointment.id = p_appointment_id
    AND appointment.type = 'reuniao'
    AND (
      coalesce(appointment.assigned_closer_id, appointment.seller_id) = v_actor_id
      OR appointment.sdr_id = v_actor_id
    )
  FOR UPDATE;

  IF v_meeting.id IS NULL THEN
    RAISE EXCEPTION 'Reuniao nao encontrada na agenda deste vendedor.';
  END IF;
  IF v_meeting.status = 'cancelado' THEN
    RAISE EXCEPTION 'Uma reuniao cancelada nao pode ser concluida.';
  END IF;
  IF v_meeting.status = 'concluido' THEN
    RAISE EXCEPTION 'Esta reuniao ja foi concluida.';
  END IF;

  v_completed_at := clock_timestamp();
  IF v_completed_at < v_meeting.scheduled_at THEN
    RAISE EXCEPTION 'A reuniao pode ser concluida a partir do horario de inicio.';
  END IF;
  IF length(trim(coalesce(p_feedback, ''))) < 10 THEN
    RAISE EXCEPTION 'Descreva o resultado da reuniao com pelo menos 10 caracteres.';
  END IF;

  UPDATE public.seller_appointments
  SET meeting_feedback = trim(p_feedback),
      feedback_submitted_at = v_completed_at,
      completed_at = v_completed_at,
      actual_duration_minutes = public.seller_meeting_actual_duration_minutes(
        v_meeting.scheduled_at,
        v_completed_at
      ),
      status = 'concluido'
  WHERE id = v_meeting.id
  RETURNING * INTO v_meeting;

  RETURN v_meeting;
END;
$$;

COMMENT ON FUNCTION public.complete_closer_meeting(uuid, text) IS
  'Conclui a reuniao pelo Closer responsavel OU pelo SDR que marcou, registrando termino, feedback e duracao reais.';

-- Agora o SDR tambem recebe credito nas metas meetings_completed_* por reunioes
-- que ele marcou e que foram concluidas. Mantem-se o credito ao Closer (ou
-- seller_id quando nao houver assigned_closer_id).

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
    v_seller_id, v_seller_type, v_month, v_year,
    goal.target_clients_daily, goal.target_clients_weekly, goal.target_clients,
    goal.target_meetings_scheduled_daily, goal.target_meetings_scheduled_weekly,
    goal.target_meetings_scheduled_monthly,
    goal.target_meetings_completed_daily, goal.target_meetings_completed_weekly,
    goal.target_meetings_completed_monthly,
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
  LEFT JOIN public.seller_goals AS goal
    ON goal.seller_id = v_seller_id
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
    seller.id, seller.full_name, coalesce(seller.seller_type, 'sdr'),
    goal.target_clients_daily, goal.target_clients_weekly, goal.target_clients,
    goal.target_meetings_scheduled_daily, goal.target_meetings_scheduled_weekly,
    goal.target_meetings_scheduled_monthly,
    goal.target_meetings_completed_daily, goal.target_meetings_completed_weekly,
    goal.target_meetings_completed_monthly,
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
  LEFT JOIN public.seller_goals AS goal
    ON goal.seller_id = seller.id
   AND goal.month = p_month
   AND goal.year = p_year
  WHERE seller.role = 'vendedor'
    AND seller.status = 'ativo'
    AND NOT seller.exclude_from_commercial_metrics
    AND lower(seller.email) <> 'vendedornox@nox.com'
  ORDER BY seller.seller_type, seller.full_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_closer_meeting(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_seller_goal_progress() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_seller_team_goal_progress(integer, integer) TO authenticated;
