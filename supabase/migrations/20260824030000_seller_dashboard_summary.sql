-- Dashboard comercial do vendedor: uma leitura agregada, segura e compartilhada
-- pelo site e pelo aplicativo. Nenhum dado pessoal de clientes de outro vendedor
-- e exposto; o ranking retorna somente nome, avatar e indicadores agregados.
CREATE OR REPLACE FUNCTION public.get_my_seller_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_id uuid;
  v_auth_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_current_month_start timestamptz;
  v_previous_month_start timestamptz;
  v_today_start timestamptz;
BEGIN
  SELECT seller.id
  INTO v_seller_id
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = v_auth_user_id
    AND seller.role = 'vendedor'
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_seller_id IS NULL THEN
    RAISE EXCEPTION 'Somente vendedores ativos podem consultar este dashboard.';
  END IF;

  v_current_month_start := date_trunc(
    'month',
    v_now AT TIME ZONE 'America/Sao_Paulo'
  ) AT TIME ZONE 'America/Sao_Paulo';
  v_previous_month_start := v_current_month_start - interval '1 month';
  v_today_start := date_trunc(
    'day',
    v_now AT TIME ZONE 'America/Sao_Paulo'
  ) AT TIME ZONE 'America/Sao_Paulo';

  RETURN (
    WITH
    contract_events AS MATERIALIZED (
      SELECT *
      FROM public.seller_client_contract_events_for(v_seller_id)
    ),
    month_calendar AS (
      SELECT
        v_current_month_start - make_interval(months => month_offset) AS month_start
      FROM generate_series(11, 0, -1) AS month_offset
    ),
    monthly_base AS (
      SELECT
        calendar.month_start,
        count(event.contract_id)::integer AS contracts,
        coalesce((
          SELECT sum(coalesce(commission.commission_amount, 0) + coalesce(commission.bonus_amount, 0))
          FROM public.seller_commissions AS commission
          WHERE commission.seller_id = v_seller_id
            AND commission.month = extract(month FROM calendar.month_start AT TIME ZONE 'America/Sao_Paulo')::integer
            AND commission.year = extract(year FROM calendar.month_start AT TIME ZONE 'America/Sao_Paulo')::integer
            AND commission.status IN (
              'elegivel', 'retida', 'liberada_parcial', 'liberada_total',
              'paga', 'pago', 'aprovada', 'aprovado'
            )
        ), 0)::numeric AS commissions
      FROM month_calendar AS calendar
      LEFT JOIN contract_events AS event
        ON event.contract_closed_at >= calendar.month_start
       AND event.contract_closed_at < calendar.month_start + interval '1 month'
      GROUP BY calendar.month_start
    ),
    monthly_history AS (
      SELECT
        base.month_start,
        base.contracts,
        sum(base.contracts) OVER (ORDER BY base.month_start)::integer AS accumulated,
        base.commissions
      FROM monthly_base AS base
    ),
    lead_weeks AS (
      SELECT
        date_trunc('week', v_now AT TIME ZONE 'America/Sao_Paulo')
          AT TIME ZONE 'America/Sao_Paulo'
          - make_interval(weeks => week_offset) AS week_start
      FROM generate_series(7, 0, -1) AS week_offset
    ),
    lead_trend AS (
      SELECT
        week.week_start,
        count(lead.id)::integer AS total
      FROM lead_weeks AS week
      LEFT JOIN public.sales_leads AS lead
        ON lead.assigned_seller_id = v_seller_id
       AND lead.created_at >= week.week_start
       AND lead.created_at < week.week_start + interval '1 week'
      GROUP BY week.week_start
      ORDER BY week.week_start
    ),
    lead_stage_totals AS (
      SELECT
        count(*) FILTER (WHERE lead.status IN ('novo', 'pendente'))::integer AS new_total,
        count(*) FILTER (WHERE lead.status IN ('em_atendimento', 'em_contato', 'atendido', 'sem_resposta'))::integer AS contact_total,
        count(*) FILTER (WHERE lead.status = 'proposta_enviada')::integer AS proposal_total,
        count(*) FILTER (WHERE lead.status IN ('negociacao', 'qualificado'))::integer AS negotiation_total,
        count(*) FILTER (WHERE lead.status IN ('convertido', 'fechado', 'ganho'))::integer AS closed_total
      FROM public.sales_leads AS lead
      WHERE lead.assigned_seller_id = v_seller_id
    ),
    pipeline_counts AS (
      SELECT stage.*
      FROM lead_stage_totals AS totals
      CROSS JOIN LATERAL (VALUES
        ('novo', 'Novo Lead', 1, totals.new_total),
        ('contato', 'Contato Realizado', 2, totals.contact_total),
        ('proposta', 'Proposta Enviada', 3, totals.proposal_total),
        ('negociacao', 'Negociação', 4, totals.negotiation_total),
        ('fechamento', 'Fechamento', 5, totals.closed_total)
      ) AS stage(key, label, position, total)
    ),
    activity_source AS (
      SELECT
        'contract-' || event.contract_id::text AS id,
        'contract'::text AS type,
        'Contrato fechado' || coalesce(' #' || nullif(event.contract_number, ''), '') AS title,
        'Cliente: ' || coalesce(event.requester_name, event.partner_name, 'Não informado') AS subtitle,
        event.contract_closed_at AS occurred_at
      FROM contract_events AS event

      UNION ALL

      SELECT
        'lead-' || lead.id::text,
        CASE
          WHEN lead.status IN ('proposta_enviada', 'negociacao') THEN 'proposal'
          ELSE 'lead'
        END,
        CASE
          WHEN lead.status = 'proposta_enviada' THEN 'Proposta enviada'
          WHEN lead.status = 'negociacao' THEN 'Negociação iniciada'
          ELSE 'Novo lead cadastrado'
        END,
        'Cliente: ' || coalesce(lead.full_name, 'Não informado'),
        CASE
          WHEN lead.status IN ('proposta_enviada', 'negociacao') THEN lead.updated_at
          ELSE lead.created_at
        END
      FROM public.sales_leads AS lead
      WHERE lead.assigned_seller_id = v_seller_id

      UNION ALL

      SELECT
        'appointment-' || appointment.id::text,
        'appointment',
        CASE appointment.type
          WHEN 'reuniao' THEN 'Reunião agendada'
          WHEN 'apresentacao' THEN 'Apresentação agendada'
          WHEN 'proposta_enviada' THEN 'Proposta enviada'
          WHEN 'follow_up' THEN 'Follow-up agendado'
          ELSE appointment.title
        END,
        CASE
          WHEN lead.full_name IS NOT NULL THEN 'Com: ' || lead.full_name
          ELSE appointment.title
        END,
        appointment.created_at
      FROM public.seller_appointments AS appointment
      LEFT JOIN public.sales_leads AS lead ON lead.id = appointment.lead_id
      WHERE appointment.seller_id = v_seller_id
    ),
    recent_activities AS (
      SELECT *
      FROM activity_source
      ORDER BY occurred_at DESC
      LIMIT 4
    ),
    today_agenda AS (
      SELECT
        appointment.id,
        appointment.title,
        appointment.type,
        appointment.status,
        appointment.scheduled_at,
        lead.full_name AS lead_name
      FROM public.seller_appointments AS appointment
      LEFT JOIN public.sales_leads AS lead ON lead.id = appointment.lead_id
      WHERE appointment.seller_id = v_seller_id
        AND appointment.scheduled_at >= v_today_start
        AND appointment.scheduled_at < v_today_start + interval '1 day'
        AND appointment.status NOT IN ('cancelado', 'concluido')
      ORDER BY appointment.scheduled_at
      LIMIT 4
    ),
    ranking_base AS (
      SELECT
        seller.id AS seller_id,
        seller.full_name AS seller_name,
        profile.avatar_url,
        coalesce((
          SELECT count(*)
          FROM public.seller_client_contract_events_for(seller.id) AS event
          WHERE event.contract_closed_at >= v_current_month_start
            AND event.contract_closed_at < v_current_month_start + interval '1 month'
        ), 0)::integer AS contracts,
        coalesce((
          SELECT sum(coalesce(commission.commission_amount, 0) + coalesce(commission.bonus_amount, 0))
          FROM public.seller_commissions AS commission
          WHERE commission.seller_id = seller.id
            AND commission.month = extract(month FROM v_current_month_start AT TIME ZONE 'America/Sao_Paulo')::integer
            AND commission.year = extract(year FROM v_current_month_start AT TIME ZONE 'America/Sao_Paulo')::integer
            AND commission.status IN (
              'elegivel', 'retida', 'liberada_parcial', 'liberada_total',
              'paga', 'pago', 'aprovada', 'aprovado'
            )
        ), 0)::numeric AS commissions,
        (SELECT count(*) FROM public.sales_leads AS lead WHERE lead.assigned_seller_id = seller.id)::integer AS leads
      FROM public.internal_users AS seller
      LEFT JOIN public.profiles AS profile ON profile.id = seller.auth_user_id
      WHERE seller.role = 'vendedor'
        AND seller.status = 'ativo'
    ),
    ranked_sellers AS (
      SELECT
        ranking.*,
        row_number() OVER (
          ORDER BY ranking.commissions DESC, ranking.contracts DESC, ranking.leads DESC, ranking.seller_name
        )::integer AS position
      FROM ranking_base AS ranking
    ),
    selected_ranking AS (
      SELECT *
      FROM ranked_sellers
      WHERE position <= 3 OR seller_id = v_seller_id
      ORDER BY position
    ),
    current_numbers AS (
      SELECT
        coalesce((SELECT contracts FROM monthly_history WHERE month_start = v_current_month_start), 0)::integer AS current_contracts,
        coalesce((SELECT contracts FROM monthly_history WHERE month_start = v_previous_month_start), 0)::integer AS previous_contracts,
        coalesce((SELECT commissions FROM monthly_history WHERE month_start = v_current_month_start), 0)::numeric AS current_commissions,
        coalesce((SELECT commissions FROM monthly_history WHERE month_start = v_previous_month_start), 0)::numeric AS previous_commissions,
        coalesce((
          SELECT sum(coalesce(commission.commission_amount, 0) + coalesce(commission.bonus_amount, 0))
          FROM public.seller_commissions AS commission
          WHERE commission.seller_id = v_seller_id
            AND commission.status IN (
              'elegivel', 'retida', 'liberada_parcial', 'liberada_total',
              'paga', 'pago', 'aprovada', 'aprovado'
            )
        ), 0)::numeric AS accumulated_commissions,
        (SELECT goal.target_contracts
         FROM public.seller_goals AS goal
         WHERE goal.seller_id = v_seller_id
           AND goal.month = extract(month FROM v_current_month_start AT TIME ZONE 'America/Sao_Paulo')::integer
           AND goal.year = extract(year FROM v_current_month_start AT TIME ZONE 'America/Sao_Paulo')::integer
         LIMIT 1) AS target_contracts,
        (SELECT position FROM ranked_sellers WHERE seller_id = v_seller_id) AS ranking_position
    )
    SELECT jsonb_build_object(
      'generated_at', v_now,
      'seller', jsonb_build_object(
        'id', seller.id,
        'name', seller.full_name,
        'avatar_url', profile.avatar_url
      ),
      'metrics', jsonb_build_object(
        'leads_pending', (
          SELECT count(*)
          FROM public.sales_leads AS lead
          WHERE lead.assigned_seller_id = v_seller_id
            AND lead.status IN ('novo', 'pendente', 'em_atendimento', 'em_contato', 'sem_resposta')
        ),
        'leads_new_this_week', (
          SELECT count(*)
          FROM public.sales_leads AS lead
          WHERE lead.assigned_seller_id = v_seller_id
            AND lead.created_at >= v_now - interval '7 days'
        ),
        'contracts_current', numbers.current_contracts,
        'contracts_previous', numbers.previous_contracts,
        'commissions_accumulated', numbers.accumulated_commissions,
        'commissions_current', numbers.current_commissions,
        'commissions_previous', numbers.previous_commissions,
        'goal_target', numbers.target_contracts,
        'ranking_position', numbers.ranking_position
      ),
      'monthly_history', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'month', extract(month FROM history.month_start AT TIME ZONE 'America/Sao_Paulo')::integer,
          'year', extract(year FROM history.month_start AT TIME ZONE 'America/Sao_Paulo')::integer,
          'contracts', history.contracts,
          'accumulated', history.accumulated,
          'commissions', history.commissions
        ) ORDER BY history.month_start)
        FROM monthly_history AS history
      ), '[]'::jsonb),
      'lead_trend', coalesce((
        SELECT jsonb_agg(trend.total ORDER BY trend.week_start)
        FROM lead_trend AS trend
      ), '[]'::jsonb),
      'pipeline', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'key', stage.key,
          'label', stage.label,
          'count', stage.total
        ) ORDER BY stage.position)
        FROM pipeline_counts AS stage
      ), '[]'::jsonb),
      'activities', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', activity.id,
          'type', activity.type,
          'title', activity.title,
          'subtitle', activity.subtitle,
          'occurred_at', activity.occurred_at
        ) ORDER BY activity.occurred_at DESC)
        FROM recent_activities AS activity
      ), '[]'::jsonb),
      'agenda', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', agenda.id,
          'title', agenda.title,
          'type', agenda.type,
          'status', agenda.status,
          'scheduled_at', agenda.scheduled_at,
          'lead_name', agenda.lead_name
        ) ORDER BY agenda.scheduled_at)
        FROM today_agenda AS agenda
      ), '[]'::jsonb),
      'ranking', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'seller_id', ranking.seller_id,
          'name', ranking.seller_name,
          'avatar_url', ranking.avatar_url,
          'contracts', ranking.contracts,
          'commissions', ranking.commissions,
          'position', ranking.position,
          'is_current', ranking.seller_id = v_seller_id
        ) ORDER BY ranking.position)
        FROM selected_ranking AS ranking
      ), '[]'::jsonb)
    )
    FROM public.internal_users AS seller
    LEFT JOIN public.profiles AS profile ON profile.id = seller.auth_user_id
    CROSS JOIN current_numbers AS numbers
    WHERE seller.id = v_seller_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_seller_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_seller_dashboard() TO authenticated;
