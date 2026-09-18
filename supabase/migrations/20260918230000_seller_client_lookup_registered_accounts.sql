-- Corrige a busca manual de clientes para consultar a conta real em auth.users.
-- Contas comerciais ja cadastradas podem permanecer em pendente/pendente_aprovacao
-- ate a revisao administrativa; isso nao deve impedir o vinculo comercial.
-- A aprovacao da conta continua separada e nenhum status e alterado aqui.

CREATE OR REPLACE FUNCTION private.resolve_seller_client_profile_id(p_email text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_email text := lower(trim(coalesce(p_email, '')));
  v_profile_id uuid;
  v_profile_status text;
BEGIN
  IF v_email = '' OR position('@' IN v_email) <= 1 THEN
    RAISE EXCEPTION 'Informe um e-mail valido.';
  END IF;

  SELECT profile.id, lower(trim(coalesce(profile.status, 'ativo')))
  INTO v_profile_id, v_profile_status
  FROM public.profiles AS profile
  JOIN auth.users AS account
    ON account.id = profile.id
   AND account.deleted_at IS NULL
  WHERE lower(trim(account.email)) = v_email
     OR lower(trim(profile.email)) = v_email
     OR EXISTS (
       SELECT 1
       FROM public.proprietarios AS owner
       WHERE owner.profile_id = profile.id
         AND lower(trim(owner.email)) = v_email
     )
  ORDER BY
    CASE
      WHEN lower(trim(account.email)) = v_email THEN 0
      WHEN lower(trim(profile.email)) = v_email THEN 1
      ELSE 2
    END,
    profile.created_at
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Nenhum cadastro NOX foi encontrado para este e-mail.';
  END IF;

  IF v_profile_status NOT IN ('ativo', 'pendente', 'pendente_aprovacao') THEN
    RAISE EXCEPTION 'Este cadastro nao esta disponivel para vinculo. Verifique o status no painel administrativo.';
  END IF;

  RETURN v_profile_id;
END;
$$;

REVOKE ALL ON FUNCTION private.resolve_seller_client_profile_id(text)
  FROM PUBLIC, anon, authenticated;

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
  v_login_email text;
  v_profile public.profiles%ROWTYPE;
  v_corretor public.corretores%ROWTYPE;
  v_imobiliaria public.imobiliarias%ROWTYPE;
  v_proprietario public.proprietarios%ROWTYPE;
  v_partner_type text;
  v_partner_name text;
  v_phone text;
  v_city text;
  v_link_status text := 'available';
  v_linked_seller_id uuid;
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

  SELECT profile.*
  INTO v_profile
  FROM public.profiles AS profile
  WHERE profile.id = private.resolve_seller_client_profile_id(v_email);

  SELECT lower(trim(account.email))
  INTO v_login_email
  FROM auth.users AS account
  WHERE account.id = v_profile.id
    AND account.deleted_at IS NULL;

  v_login_email := coalesce(v_login_email, lower(trim(v_profile.email)), v_email);

  IF v_profile.role::text NOT IN ('proprietario', 'imobiliaria', 'corretor')
     AND EXISTS (
       SELECT 1
       FROM public.internal_users AS employee
       WHERE employee.auth_user_id = v_profile.id
         AND employee.status <> 'excluido'
     ) THEN
    RAISE EXCEPTION 'Este login pertence a equipe interna e nao pode ser cadastrado como cliente.';
  END IF;

  IF v_profile.role::text = 'proprietario' THEN
    SELECT owner.*
    INTO v_proprietario
    FROM public.proprietarios AS owner
    WHERE owner.profile_id = v_profile.id
       OR lower(trim(owner.email)) IN (v_email, v_login_email, lower(trim(v_profile.email)))
    ORDER BY (owner.profile_id = v_profile.id) DESC, owner.created_at
    LIMIT 1;

    v_partner_type := 'proprietario';
    v_partner_name := coalesce(
      nullif(trim(v_proprietario.nome), ''),
      nullif(trim(v_profile.nome), ''),
      v_login_email
    );
    v_phone := coalesce(v_profile.telefone, v_proprietario.telefone);

    SELECT property.cidade
    INTO v_city
    FROM public.imoveis AS property
    WHERE property.proprietario_id = v_proprietario.id
      AND nullif(trim(property.cidade), '') IS NOT NULL
    ORDER BY property.created_at DESC
    LIMIT 1;
  ELSIF v_profile.role::text = 'corretor' THEN
    SELECT broker.*
    INTO v_corretor
    FROM public.corretores AS broker
    WHERE broker.profile_id = v_profile.id
    LIMIT 1;

    IF v_corretor.id IS NULL OR v_corretor.imobiliaria_id IS NULL THEN
      v_partner_type := 'corretor_autonomo';
      v_partner_name := coalesce(nullif(trim(v_profile.nome), ''), v_login_email);
      v_city := v_corretor.cidade;
    ELSE
      SELECT agency.*
      INTO v_imobiliaria
      FROM public.imobiliarias AS agency
      WHERE agency.id = v_corretor.imobiliaria_id;

      v_partner_type := 'imobiliaria';
      v_partner_name := coalesce(
        nullif(trim(v_imobiliaria.nome_fantasia), ''),
        nullif(trim(v_imobiliaria.razao_social), ''),
        nullif(trim(v_profile.nome), ''),
        v_login_email
      );
      v_city := coalesce(v_corretor.cidade, v_imobiliaria.cidade);
    END IF;
    v_phone := coalesce(v_profile.telefone, v_imobiliaria.contato_telefone);
  ELSIF v_profile.role::text = 'imobiliaria' THEN
    SELECT agency.*
    INTO v_imobiliaria
    FROM public.imobiliarias AS agency
    WHERE lower(trim(agency.contato_email)) IN (
      v_email,
      v_login_email,
      lower(trim(v_profile.email))
    )
    ORDER BY
      CASE WHEN lower(trim(agency.contato_email)) = v_login_email THEN 0 ELSE 1 END,
      agency.created_at
    LIMIT 1;

    v_partner_type := 'imobiliaria';
    v_partner_name := coalesce(
      nullif(trim(v_imobiliaria.nome_fantasia), ''),
      nullif(trim(v_imobiliaria.razao_social), ''),
      nullif(trim(v_profile.nome), ''),
      v_login_email
    );
    v_phone := coalesce(v_profile.telefone, v_imobiliaria.contato_telefone);
    v_city := v_imobiliaria.cidade;
  ELSE
    v_partner_type := 'cliente';
    v_partner_name := coalesce(nullif(trim(v_profile.nome), ''), v_login_email);
    v_phone := v_profile.telefone;
  END IF;

  SELECT attribution.seller_id, owner.full_name
  INTO v_linked_seller_id, v_linked_seller_name
  FROM public.seller_signup_attributions AS attribution
  JOIN public.internal_users AS owner ON owner.id = attribution.seller_id
  WHERE attribution.registered_profile_id = v_profile.id
    AND attribution.seller_type = v_seller_type
  ORDER BY attribution.created_at
  LIMIT 1;

  IF v_linked_seller_id = v_seller_id THEN
    v_link_status := 'already_mine';
    v_linked_seller_name := NULL;
  ELSIF v_linked_seller_id IS NOT NULL THEN
    v_link_status := 'linked_to_other';
  ELSE
    SELECT partnership.seller_id, owner.full_name
    INTO v_linked_seller_id, v_linked_seller_name
    FROM public.seller_client_partnerships AS partnership
    JOIN public.internal_users AS owner ON owner.id = partnership.seller_id
    WHERE partnership.seller_type = v_seller_type
      AND (
        (v_partner_type = 'imobiliaria' AND partnership.imobiliaria_id = v_imobiliaria.id)
        OR
        (v_partner_type = 'corretor_autonomo' AND partnership.client_profile_id = v_profile.id)
      )
    ORDER BY partnership.created_at
    LIMIT 1;

    IF v_linked_seller_id = v_seller_id THEN
      v_link_status := 'already_mine';
      v_linked_seller_name := NULL;
    ELSIF v_linked_seller_id IS NOT NULL THEN
      v_link_status := 'linked_to_other';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    v_profile.id,
    coalesce(nullif(trim(v_profile.nome), ''), v_partner_name),
    v_login_email,
    v_partner_type,
    v_partner_name,
    v_phone,
    v_city,
    v_link_status,
    v_linked_seller_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_my_seller_client(p_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller public.internal_users%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_login_email text;
  v_attribution_id uuid;
  v_partnership_id uuid;
  v_legacy_partnership_id uuid;
  v_existing_seller_id uuid;
  v_existing_seller_name text;
  v_corretor public.corretores%ROWTYPE;
  v_imobiliaria public.imobiliarias%ROWTYPE;
  v_partner_type text;
BEGIN
  SELECT seller.*
  INTO v_seller
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid()
    AND seller.role = 'vendedor'
    AND seller.seller_type IN ('sdr', 'closer')
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_seller.id IS NULL THEN
    RAISE EXCEPTION 'Somente SDRs e Closers ativos podem cadastrar clientes.';
  END IF;

  SELECT profile.*
  INTO v_profile
  FROM public.profiles AS profile
  WHERE profile.id = private.resolve_seller_client_profile_id(v_email);

  SELECT lower(trim(account.email))
  INTO v_login_email
  FROM auth.users AS account
  WHERE account.id = v_profile.id
    AND account.deleted_at IS NULL;

  v_login_email := coalesce(v_login_email, lower(trim(v_profile.email)), v_email);

  IF v_profile.role::text NOT IN ('proprietario', 'imobiliaria', 'corretor')
     AND EXISTS (
       SELECT 1
       FROM public.internal_users AS employee
       WHERE employee.auth_user_id = v_profile.id
         AND employee.status <> 'excluido'
     ) THEN
    RAISE EXCEPTION 'Este login pertence a equipe interna e nao pode ser cadastrado como cliente.';
  END IF;

  IF v_profile.role::text = 'corretor' THEN
    SELECT broker.*
    INTO v_corretor
    FROM public.corretores AS broker
    WHERE broker.profile_id = v_profile.id
    LIMIT 1;

    IF v_corretor.id IS NULL OR v_corretor.imobiliaria_id IS NULL THEN
      v_partner_type := 'corretor_autonomo';
    ELSE
      v_partner_type := 'imobiliaria';
      SELECT agency.*
      INTO v_imobiliaria
      FROM public.imobiliarias AS agency
      WHERE agency.id = v_corretor.imobiliaria_id;
    END IF;
  ELSIF v_profile.role::text = 'imobiliaria' THEN
    v_partner_type := 'imobiliaria';
    SELECT agency.*
    INTO v_imobiliaria
    FROM public.imobiliarias AS agency
    WHERE lower(trim(agency.contato_email)) IN (
      v_email,
      v_login_email,
      lower(trim(v_profile.email))
    )
    ORDER BY
      CASE WHEN lower(trim(agency.contato_email)) = v_login_email THEN 0 ELSE 1 END,
      agency.created_at
    LIMIT 1;
  ELSIF v_profile.role::text = 'proprietario' THEN
    v_partner_type := 'proprietario';
  ELSE
    v_partner_type := 'cliente';
  END IF;

  SELECT attribution.id, attribution.seller_id, owner.full_name
  INTO v_attribution_id, v_existing_seller_id, v_existing_seller_name
  FROM public.seller_signup_attributions AS attribution
  JOIN public.internal_users AS owner ON owner.id = attribution.seller_id
  WHERE attribution.registered_profile_id = v_profile.id
    AND attribution.seller_type = v_seller.seller_type
  LIMIT 1
  FOR UPDATE OF attribution;

  IF v_existing_seller_id IS NOT NULL AND v_existing_seller_id <> v_seller.id THEN
    RAISE EXCEPTION 'Este cliente ja esta vinculado a outro %: %.',
      upper(v_seller.seller_type), v_existing_seller_name;
  END IF;

  SELECT partnership.id, partnership.seller_id, owner.full_name
  INTO v_legacy_partnership_id, v_existing_seller_id, v_existing_seller_name
  FROM public.seller_client_partnerships AS partnership
  JOIN public.internal_users AS owner ON owner.id = partnership.seller_id
  WHERE partnership.seller_type = v_seller.seller_type
    AND (
      (v_partner_type = 'imobiliaria' AND partnership.imobiliaria_id = v_imobiliaria.id)
      OR
      (v_partner_type = 'corretor_autonomo' AND partnership.client_profile_id = v_profile.id)
    )
  ORDER BY partnership.created_at
  LIMIT 1;

  IF v_existing_seller_id IS NOT NULL AND v_existing_seller_id <> v_seller.id THEN
    RAISE EXCEPTION 'Este cliente ja esta vinculado a outro %: %.',
      upper(v_seller.seller_type), v_existing_seller_name;
  END IF;

  IF v_attribution_id IS NULL THEN
    INSERT INTO public.seller_signup_attributions (
      link_id,
      seller_id,
      seller_type,
      registered_profile_id,
      profile_role,
      registered_email,
      source
    ) VALUES (
      NULL,
      v_seller.id,
      v_seller.seller_type,
      v_profile.id,
      v_profile.role::text,
      v_login_email,
      'manual'
    )
    ON CONFLICT (registered_profile_id, seller_type) DO NOTHING
    RETURNING id INTO v_attribution_id;

    IF v_attribution_id IS NULL THEN
      SELECT attribution.id, attribution.seller_id, owner.full_name
      INTO v_attribution_id, v_existing_seller_id, v_existing_seller_name
      FROM public.seller_signup_attributions AS attribution
      JOIN public.internal_users AS owner ON owner.id = attribution.seller_id
      WHERE attribution.registered_profile_id = v_profile.id
        AND attribution.seller_type = v_seller.seller_type
      LIMIT 1;

      IF v_existing_seller_id IS DISTINCT FROM v_seller.id THEN
        RAISE EXCEPTION 'Este cliente ja esta vinculado a outro %: %.',
          upper(v_seller.seller_type), coalesce(v_existing_seller_name, 'responsavel');
      END IF;
    END IF;
  END IF;

  IF v_profile.role::text IN ('corretor', 'imobiliaria') THEN
    v_partnership_id := public.ensure_seller_signup_partnership(
      v_seller.id,
      v_profile.id,
      v_profile.role::text,
      v_login_email
    );
  END IF;

  RETURN coalesce(v_partnership_id, v_legacy_partnership_id, v_attribution_id);
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_seller_client_by_email(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.register_my_seller_client(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lookup_seller_client_by_email(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_my_seller_client(text) TO authenticated;

COMMENT ON FUNCTION private.resolve_seller_client_profile_id(text) IS
  'Resolve um cliente pelo e-mail real de auth.users ou pelos dados publicos associados e aceita contas ativas ou aguardando aprovacao.';
COMMENT ON FUNCTION public.lookup_seller_client_by_email(text) IS
  'Localiza com seguranca uma conta NOX cadastrada, inclusive pendente de aprovacao, sem permitir contas bloqueadas, reprovadas ou excluidas.';
COMMENT ON FUNCTION public.register_my_seller_client(text) IS
  'Atribui uma conta NOX cadastrada ao SDR/Closer atual sem alterar seu status de aprovacao e sem criar duplicidades.';

NOTIFY pgrst, 'reload schema';
