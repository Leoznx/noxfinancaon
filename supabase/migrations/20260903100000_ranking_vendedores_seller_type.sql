-- A aba /vendedor/ranking tambem pode ser aberta por admin/admin_master/
-- financeiro (roles sem vinculo de vendedor ativo). Nesses casos v_type fica
-- NULL dentro de ranking_vendedores e a funcao devolve SDR e Closer juntos,
-- cada grupo com sua propria posicao 1,2,3... Sem o tipo na resposta o front
-- nao tem como separar os dois grupos ao renderizar (misturava 1o lugar SDR
-- com 1o lugar Closer no mesmo pódio). Expomos seller_type para o front
-- isolar cada lista com seguranca, sem depender apenas do filtro server-side.
DROP FUNCTION IF EXISTS public.ranking_vendedores(integer, integer);
CREATE FUNCTION public.ranking_vendedores(
  p_month integer DEFAULT extract(month FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::integer,
  p_year integer DEFAULT extract(year FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::integer
)
RETURNS TABLE (
  vendedor_id uuid, nome text, avatar_url text, total_leads bigint,
  contratos_fechados bigint, em_atendimento bigint, comissoes numeric, posicao bigint,
  seller_type text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_type text; v_start timestamptz; v_end timestamptz;
BEGIN
  SELECT seller.seller_type INTO v_type FROM public.internal_users seller
  WHERE seller.auth_user_id = auth.uid() AND seller.role = 'vendedor' AND seller.status = 'ativo' LIMIT 1;
  v_start := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'America/Sao_Paulo');
  v_end := v_start + interval '1 month';
  RETURN QUERY
  WITH metrics AS (
    SELECT seller.id, seller.full_name, profile.avatar_url, seller.seller_type,
      count(partnership.id)::bigint AS registrations
    FROM public.internal_users seller
    LEFT JOIN public.profiles profile ON profile.id = seller.auth_user_id
    LEFT JOIN public.seller_client_partnerships partnership
      ON partnership.seller_id = seller.id
     AND partnership.created_at >= v_start AND partnership.created_at < v_end
    WHERE seller.role = 'vendedor' AND seller.status = 'ativo'
      AND NOT seller.exclude_from_commercial_metrics
      AND lower(seller.email) <> 'vendedornox@nox.com'
      AND (v_type IS NULL OR seller.seller_type = v_type)
    GROUP BY seller.id, seller.full_name, profile.avatar_url, seller.seller_type
  ), ranked AS (
    SELECT metrics.*, row_number() OVER (
      PARTITION BY metrics.seller_type ORDER BY metrics.registrations DESC, metrics.full_name
    )::bigint AS ranking_position
    FROM metrics
  )
  SELECT ranked.id, ranked.full_name, ranked.avatar_url, ranked.registrations,
    ranked.registrations, 0::bigint, 0::numeric, ranked.ranking_position, ranked.seller_type
  FROM ranked ORDER BY ranked.seller_type, ranked.ranking_position;
END;
$$;
REVOKE ALL ON FUNCTION public.ranking_vendedores(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ranking_vendedores(integer, integer) TO authenticated;
