-- Corrige o contrato de retorno da listagem administrativa de carteiras.
-- internal_users.status e um enum; funcoes RETURNS TABLE exigem que a coluna
-- retornada seja exatamente text, nao apenas implicitamente conversivel.

CREATE OR REPLACE FUNCTION public.admin_list_seller_client_portfolios()
RETURNS TABLE (
  seller_id uuid,
  seller_name text,
  seller_email text,
  seller_type text,
  seller_status text,
  client_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (
    public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  ) THEN
    RAISE EXCEPTION 'Somente administradores podem consultar as carteiras dos vendedores.';
  END IF;

  RETURN QUERY
  SELECT
    seller.id,
    coalesce(nullif(trim(seller.full_name), ''), seller.email, 'Vendedor NOX'),
    coalesce(seller.email, ''),
    seller.seller_type,
    seller.status::text,
    count(credit.credit_id)::bigint
  FROM public.internal_users AS seller
  LEFT JOIN LATERAL public.seller_registration_credits_for(seller.id) AS credit ON true
  WHERE seller.role = 'vendedor'
    AND seller.seller_type IN ('sdr', 'closer')
    AND seller.status <> 'excluido'
  GROUP BY seller.id, seller.full_name, seller.email, seller.seller_type, seller.status
  ORDER BY seller.seller_type, lower(coalesce(seller.full_name, seller.email, ''));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_seller_client_portfolios() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_seller_client_portfolios() TO authenticated;

NOTIFY pgrst, 'reload schema';
