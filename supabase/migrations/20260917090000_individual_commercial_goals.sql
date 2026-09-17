-- Metas comerciais individuais por equipe.
--
-- O progresso e sempre calculado a partir das fontes de verdade:
--   * SDR: reunioes criadas por ele e ainda validas;
--   * Closer: reunioes concluidas por ele;
--   * Cadastros: vinculos manuais + atribuicoes por link, sem duplicar o
--     mesmo perfil quando o cadastro por link tambem criou um vinculo.
-- Assim, excluir/cancelar uma reuniao ou corrigir uma atribuicao reflete
-- imediatamente nas metas, sem contadores incrementais que possam divergir.

CREATE OR REPLACE FUNCTION public.count_seller_goal_registrations(
  p_seller_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::bigint
  FROM (
    SELECT source.registration_key, min(source.created_at) AS registered_at
    FROM (
      SELECT partnership.client_profile_id::text AS registration_key,
        partnership.created_at
      FROM public.seller_client_partnerships AS partnership
      WHERE partnership.seller_id = p_seller_id

      UNION ALL

      SELECT attribution.registered_profile_id::text AS registration_key,
        attribution.created_at
      FROM public.seller_signup_attributions AS attribution
      WHERE attribution.seller_id = p_seller_id
    ) AS source
    GROUP BY source.registration_key
  ) AS registration
  WHERE registration.registered_at >= p_start
    AND registration.registered_at < p_end;
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

REVOKE ALL ON FUNCTION public.count_seller_goal_registrations(uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_seller_goal_progress() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_seller_team_goal_progress(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_seller_goal_progress() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_seller_team_goal_progress(integer, integer) TO authenticated;

COMMENT ON FUNCTION public.count_seller_goal_registrations(uuid, timestamptz, timestamptz) IS
  'Conta cadastros unicos do vendedor a partir de vinculos manuais e atribuicoes por link.';
COMMENT ON FUNCTION public.get_my_seller_goal_progress() IS
  'Metas individuais em tempo real: SDR agenda, Closer conclui e ambos recebem os cadastros atribuidos.';
COMMENT ON FUNCTION public.get_seller_team_goal_progress(integer, integer) IS
  'Progresso individual da equipe comercial, separado por SDR e Closer, para edicao administrativa.';
