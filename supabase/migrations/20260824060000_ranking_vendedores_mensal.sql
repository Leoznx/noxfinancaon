-- Ranking mensal compartilhado entre site e aplicativo. A resposta expõe
-- somente identidade pública do vendedor e indicadores agregados do período.
DROP FUNCTION IF EXISTS public.ranking_vendedores();

CREATE OR REPLACE FUNCTION public.ranking_vendedores(
  p_month integer DEFAULT extract(month FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::integer,
  p_year integer DEFAULT extract(year FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::integer
)
RETURNS TABLE (
  vendedor_id uuid,
  nome text,
  avatar_url text,
  total_leads bigint,
  contratos_fechados bigint,
  em_atendimento bigint,
  comissoes numeric,
  posicao bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period_start timestamptz;
  v_period_end timestamptz;
BEGIN
  IF p_month < 1 OR p_month > 12 OR p_year < 2000 OR p_year > 9999 THEN
    RAISE EXCEPTION 'Mês ou ano inválido.';
  END IF;

  v_period_start := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'America/Sao_Paulo');
  v_period_end := v_period_start + interval '1 month';

  RETURN QUERY
  WITH seller_metrics AS (
    SELECT
      seller.id AS seller_id,
      coalesce(nullif(seller.full_name, ''), nullif(profile.nome, ''), 'Vendedor') AS seller_name,
      profile.avatar_url AS seller_avatar_url,
      (
        SELECT count(*)
        FROM public.sales_leads AS lead
        WHERE lead.assigned_seller_id = seller.id
          AND lead.created_at >= v_period_start
          AND lead.created_at < v_period_end
      )::bigint AS leads,
      (
        SELECT count(*)
        FROM public.seller_client_contract_events_for(seller.id) AS event
        WHERE event.contract_closed_at >= v_period_start
          AND event.contract_closed_at < v_period_end
      )::bigint AS contracts,
      (
        SELECT count(*)
        FROM public.sales_leads AS lead
        WHERE lead.assigned_seller_id = seller.id
          AND lead.created_at >= v_period_start
          AND lead.created_at < v_period_end
          AND lead.status IN (
            'em_atendimento', 'em_contato', 'atendido', 'sem_resposta',
            'proposta_enviada', 'negociacao', 'qualificado'
          )
      )::bigint AS in_progress,
      coalesce((
        SELECT sum(coalesce(commission.commission_amount, 0) + coalesce(commission.bonus_amount, 0))
        FROM public.seller_commissions AS commission
        WHERE commission.seller_id = seller.id
          AND commission.month = p_month
          AND commission.year = p_year
          AND commission.status IN (
            'elegivel', 'retida', 'liberada_parcial', 'liberada_total',
            'paga', 'pago', 'aprovada', 'aprovado'
          )
      ), 0)::numeric AS commission_total
    FROM public.internal_users AS seller
    LEFT JOIN public.profiles AS profile ON profile.id = seller.auth_user_id
    WHERE seller.role = 'vendedor'
      AND seller.status = 'ativo'
  ), ranked AS (
    SELECT
      metrics.*,
      row_number() OVER (
        ORDER BY
          metrics.contracts DESC,
          metrics.commission_total DESC,
          metrics.leads DESC,
          metrics.seller_name
      )::bigint AS ranking_position
    FROM seller_metrics AS metrics
  )
  SELECT
    ranked.seller_id,
    ranked.seller_name,
    ranked.seller_avatar_url,
    ranked.leads,
    ranked.contracts,
    ranked.in_progress,
    ranked.commission_total,
    ranked.ranking_position
  FROM ranked
  ORDER BY ranked.ranking_position;
END;
$$;

REVOKE ALL ON FUNCTION public.ranking_vendedores(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ranking_vendedores(integer, integer) TO authenticated;
