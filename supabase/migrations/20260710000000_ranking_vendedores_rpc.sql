-- sales_leads RLS restringe cada vendedor a ver só os proprios leads (correto,
-- protege PII de cliente de outro vendedor) — mas isso tambem impede montar
-- um ranking entre vendedores com uma query direta na tabela. Esta RPC roda
-- com privilegio elevado so pra AGREGAR contagens por vendedor (sem retornar
-- nenhum dado individual de lead/cliente), e qualquer vendedor autenticado
-- pode chama-la pra ver o ranking geral da equipe.
CREATE OR REPLACE FUNCTION public.ranking_vendedores()
RETURNS TABLE (
  vendedor_id uuid,
  nome text,
  total_leads bigint,
  contratos_fechados bigint,
  em_atendimento bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id AS vendedor_id,
    u.full_name AS nome,
    COUNT(l.id) AS total_leads,
    COUNT(*) FILTER (WHERE l.status = 'convertido') AS contratos_fechados,
    COUNT(*) FILTER (WHERE l.status = 'em_atendimento') AS em_atendimento
  FROM public.internal_users u
  LEFT JOIN public.sales_leads l ON l.assigned_seller_id = u.id
  WHERE u.role = 'vendedor' AND u.status = 'ativo'
  GROUP BY u.id, u.full_name
  ORDER BY contratos_fechados DESC, total_leads DESC;
$$;

GRANT EXECUTE ON FUNCTION public.ranking_vendedores() TO authenticated;
