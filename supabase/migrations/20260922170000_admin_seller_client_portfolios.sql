-- Carteiras comerciais visiveis e editaveis somente por Admin/Admin Master.
-- A remocao abaixo desfaz apenas a atribuicao entre vendedor e cliente; a
-- conta, o perfil, consultas, contratos e demais dados do cliente permanecem.

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

CREATE OR REPLACE FUNCTION public.admin_list_seller_portfolio_clients(p_seller_id uuid)
RETURNS TABLE (
  seller_id uuid,
  client_profile_id uuid,
  client_name text,
  client_email text,
  client_phone text,
  profile_role text,
  registered_at timestamptz,
  attribution_source text
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
    RAISE EXCEPTION 'Somente administradores podem consultar os clientes dos vendedores.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.internal_users AS seller
    WHERE seller.id = p_seller_id
      AND seller.role = 'vendedor'
      AND seller.seller_type IN ('sdr', 'closer')
  ) THEN
    RAISE EXCEPTION 'Vendedor nao encontrado.';
  END IF;

  RETURN QUERY
  SELECT
    p_seller_id,
    credit.registered_profile_id,
    coalesce(nullif(trim(profile.nome), ''), 'Cliente NOX'),
    lower(credit.registered_email),
    profile.telefone,
    credit.profile_role,
    credit.credited_at,
    coalesce(attribution.source, 'legado')
  FROM public.seller_registration_credits_for(p_seller_id) AS credit
  JOIN public.profiles AS profile ON profile.id = credit.registered_profile_id
  LEFT JOIN public.seller_signup_attributions AS attribution
    ON attribution.id = credit.credit_id
   AND attribution.seller_id = p_seller_id
  ORDER BY credit.credited_at DESC, lower(coalesce(profile.nome, credit.registered_email));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_unlink_seller_client(
  p_seller_id uuid,
  p_client_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller public.internal_users%ROWTYPE;
  v_client public.profiles%ROWTYPE;
  v_partnership_ids uuid[] := ARRAY[]::uuid[];
  v_attributions_removed integer := 0;
  v_partnerships_removed integer := 0;
  v_phone_contacts_removed integer := 0;
BEGIN
  IF NOT (
    public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  ) THEN
    RAISE EXCEPTION 'Somente administradores podem remover clientes das carteiras.';
  END IF;

  SELECT seller.* INTO v_seller
  FROM public.internal_users AS seller
  WHERE seller.id = p_seller_id
    AND seller.role = 'vendedor'
    AND seller.seller_type IN ('sdr', 'closer');

  IF v_seller.id IS NULL THEN
    RAISE EXCEPTION 'Vendedor nao encontrado.';
  END IF;

  SELECT profile.* INTO v_client
  FROM public.profiles AS profile
  WHERE profile.id = p_client_profile_id;

  IF v_client.id IS NULL THEN
    RAISE EXCEPTION 'Cliente nao encontrado.';
  END IF;

  SELECT coalesce(array_agg(partnership.id), ARRAY[]::uuid[])
  INTO v_partnership_ids
  FROM public.seller_client_partnerships AS partnership
  WHERE partnership.seller_id = p_seller_id
    AND partnership.client_profile_id = p_client_profile_id;

  DELETE FROM public.seller_client_phone_contacts AS contact
  WHERE contact.seller_id = p_seller_id
    AND (
      contact.partnership_id = ANY(v_partnership_ids)
      OR lower(coalesce(contact.client_email, '')) = lower(coalesce(v_client.email, ''))
    );
  GET DIAGNOSTICS v_phone_contacts_removed = ROW_COUNT;

  DELETE FROM public.seller_signup_attributions AS attribution
  WHERE attribution.seller_id = p_seller_id
    AND attribution.registered_profile_id = p_client_profile_id;
  GET DIAGNOSTICS v_attributions_removed = ROW_COUNT;

  DELETE FROM public.seller_client_partnerships AS partnership
  WHERE partnership.seller_id = p_seller_id
    AND partnership.client_profile_id = p_client_profile_id;
  GET DIAGNOSTICS v_partnerships_removed = ROW_COUNT;

  IF v_attributions_removed = 0 AND v_partnerships_removed = 0 THEN
    RAISE EXCEPTION 'Este cliente nao esta mais vinculado ao vendedor selecionado.';
  END IF;

  INSERT INTO public.internal_audit_logs (
    actor_user_id,
    actor_role,
    action,
    table_name,
    record_id,
    before,
    after
  ) VALUES (
    auth.uid(),
    'admin',
    'remover_cliente_da_carteira_do_vendedor',
    'seller_client_portfolios',
    p_client_profile_id,
    jsonb_build_object(
      'seller_id', p_seller_id,
      'seller_name', coalesce(v_seller.full_name, v_seller.email),
      'seller_type', v_seller.seller_type,
      'client_profile_id', p_client_profile_id,
      'client_name', coalesce(v_client.nome, v_client.email),
      'client_email', v_client.email
    ),
    jsonb_build_object(
      'account_preserved', true,
      'attributions_removed', v_attributions_removed,
      'partnerships_removed', v_partnerships_removed,
      'phone_contacts_removed', v_phone_contacts_removed
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'account_preserved', true,
    'attributions_removed', v_attributions_removed,
    'partnerships_removed', v_partnerships_removed,
    'phone_contacts_removed', v_phone_contacts_removed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_seller_client_portfolios() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_seller_portfolio_clients(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_unlink_seller_client(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_list_seller_client_portfolios() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_seller_portfolio_clients(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unlink_seller_client(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_unlink_seller_client(uuid, uuid) IS
  'Remove somente a atribuicao comercial entre vendedor e cliente; preserva integralmente a conta do cliente.';

NOTIFY pgrst, 'reload schema';
