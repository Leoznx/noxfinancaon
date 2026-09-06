-- Simplifica o cadastro definitivo do cliente para o fluxo solicitado:
-- o SDR ou Closer localiza uma conta NOX pelo e-mail e confirma o vinculo.
-- O vinculo continua isolado por seller_type, portanto o mesmo cliente pode
-- contabilizar um cadastro para um SDR e outro para um Closer.

CREATE OR REPLACE FUNCTION public.lookup_seller_client_by_email(p_email text)
RETURNS TABLE (
  profile_id uuid,
  full_name text,
  email text,
  partner_type text,
  partner_name text,
  phone text,
  city text,
  link_status text,
  linked_seller_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_id uuid;
  v_seller_type text;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_profile public.profiles%ROWTYPE;
  v_corretor public.corretores%ROWTYPE;
  v_imobiliaria public.imobiliarias%ROWTYPE;
  v_partner_type text;
  v_partner_name text;
  v_phone text;
  v_city text;
  v_link_status text := 'available';
  v_linked_seller_name text;
BEGIN
  SELECT seller.id, seller.seller_type
  INTO v_seller_id, v_seller_type
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid()
    AND seller.role = 'vendedor'
    AND seller.seller_type IN ('sdr', 'closer')
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_seller_id IS NULL THEN
    RAISE EXCEPTION 'Somente SDRs e Closers ativos podem localizar clientes.';
  END IF;
  IF v_email = '' OR position('@' IN v_email) <= 1 THEN
    RAISE EXCEPTION 'Informe um e-mail valido.';
  END IF;

  SELECT profile.*
  INTO v_profile
  FROM public.profiles AS profile
  WHERE lower(profile.email) = v_email
    AND coalesce(profile.status, 'ativo') = 'ativo'
  LIMIT 1;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'Nenhum login ativo foi encontrado para este e-mail.';
  END IF;

  IF v_profile.role::text = 'corretor' THEN
    SELECT corretor.*
    INTO v_corretor
    FROM public.corretores AS corretor
    WHERE corretor.profile_id = v_profile.id
    LIMIT 1;

    IF v_corretor.id IS NULL THEN
      RAISE EXCEPTION 'O login informado ainda nao possui cadastro profissional de corretor.';
    END IF;

    IF v_corretor.imobiliaria_id IS NULL THEN
      v_partner_type := 'corretor_autonomo';
      v_partner_name := coalesce(nullif(trim(v_profile.nome), ''), v_profile.email);
      v_city := v_corretor.cidade;
    ELSE
      SELECT imobiliaria.*
      INTO v_imobiliaria
      FROM public.imobiliarias AS imobiliaria
      WHERE imobiliaria.id = v_corretor.imobiliaria_id;

      IF v_imobiliaria.id IS NULL THEN
        RAISE EXCEPTION 'A imobiliaria deste corretor nao foi encontrada.';
      END IF;

      v_partner_type := 'imobiliaria';
      v_partner_name := coalesce(
        nullif(trim(v_imobiliaria.nome_fantasia), ''),
        nullif(trim(v_imobiliaria.razao_social), ''),
        nullif(trim(v_profile.nome), ''),
        v_profile.email
      );
      v_city := coalesce(v_corretor.cidade, v_imobiliaria.cidade);
    END IF;
  ELSIF v_profile.role::text = 'imobiliaria' THEN
    SELECT imobiliaria.*
    INTO v_imobiliaria
    FROM public.imobiliarias AS imobiliaria
    WHERE lower(imobiliaria.contato_email) = v_email
    LIMIT 1;

    IF v_imobiliaria.id IS NULL THEN
      RAISE EXCEPTION 'O login informado ainda nao possui cadastro de imobiliaria.';
    END IF;

    v_partner_type := 'imobiliaria';
    v_partner_name := coalesce(
      nullif(trim(v_imobiliaria.nome_fantasia), ''),
      nullif(trim(v_imobiliaria.razao_social), ''),
      nullif(trim(v_profile.nome), ''),
      v_profile.email
    );
    v_city := v_imobiliaria.cidade;
  ELSE
    RAISE EXCEPTION 'Localize apenas logins de corretor ou imobiliaria.';
  END IF;

  v_phone := coalesce(v_profile.telefone, v_imobiliaria.contato_telefone);

  IF EXISTS (
    SELECT 1
    FROM public.seller_client_partnerships AS partnership
    WHERE partnership.seller_id = v_seller_id
      AND (
        (v_partner_type = 'imobiliaria' AND partnership.imobiliaria_id = v_imobiliaria.id)
        OR (v_partner_type = 'corretor_autonomo' AND partnership.client_profile_id = v_profile.id)
      )
  ) THEN
    v_link_status := 'already_mine';
  ELSE
    SELECT owner.full_name
    INTO v_linked_seller_name
    FROM public.seller_client_partnerships AS partnership
    JOIN public.internal_users AS owner ON owner.id = partnership.seller_id
    WHERE partnership.seller_type = v_seller_type
      AND partnership.seller_id <> v_seller_id
      AND (
        (v_partner_type = 'imobiliaria' AND partnership.imobiliaria_id = v_imobiliaria.id)
        OR (v_partner_type = 'corretor_autonomo' AND partnership.client_profile_id = v_profile.id)
      )
    ORDER BY partnership.created_at
    LIMIT 1;

    IF v_linked_seller_name IS NOT NULL THEN
      v_link_status := 'linked_to_other';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    v_profile.id,
    coalesce(nullif(trim(v_profile.nome), ''), v_partner_name),
    v_profile.email,
    v_partner_type,
    v_partner_name,
    v_phone,
    v_city,
    v_link_status,
    v_linked_seller_name;
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_seller_client_by_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lookup_seller_client_by_email(text) TO authenticated;

COMMENT ON FUNCTION public.lookup_seller_client_by_email(text) IS
  'Localiza com seguranca uma conta NOX de corretor/imobiliaria para confirmacao por um SDR ou Closer e informa o estado do vinculo na funcao comercial atual.';
