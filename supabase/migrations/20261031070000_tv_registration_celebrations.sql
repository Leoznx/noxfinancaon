-- Expõe ao painel de TV somente os dados necessários para comemorar um novo
-- cadastro comercial. O evento em tempo real continua sendo o INSERT imutável
-- em seller_signup_attributions; esta RPC resolve nome e foto sem ampliar RLS.

CREATE OR REPLACE FUNCTION public.get_tv_registration_celebration(
  p_attribution_id uuid
)
RETURNS TABLE (
  attribution_id uuid,
  seller_id uuid,
  seller_name text,
  seller_type text,
  avatar_url text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  ) THEN
    RAISE EXCEPTION 'Acesso restrito ao painel administrativo da TV.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    attribution.id,
    seller.id,
    coalesce(nullif(trim(seller.full_name), ''), 'Time NOX')::text,
    seller.seller_type::text,
    nullif(trim(profile.avatar_url), '')::text,
    attribution.created_at
  FROM public.seller_signup_attributions AS attribution
  JOIN public.internal_users AS seller
    ON seller.id = attribution.seller_id
  LEFT JOIN public.profiles AS profile
    ON profile.id = seller.auth_user_id
  WHERE attribution.id = p_attribution_id
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_tv_registration_celebration(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tv_registration_celebration(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.get_tv_registration_celebration(uuid) IS
  'Retorna nome, especialidade e avatar do vendedor creditado em um novo cadastro para a celebracao ao vivo de 15 segundos no painel TV; acesso exclusivo de Admin/Admin Master.';
