-- Permite que SDRs e Closers atribuam manualmente qualquer conta comercial
-- existente (proprietario, imobiliaria ou corretor), sem depender de um link.
-- O credito continua unico por perfil e etapa comercial, evitando duplicidade.

ALTER TABLE public.seller_signup_attributions
  ALTER COLUMN link_id DROP NOT NULL;

ALTER TABLE public.seller_signup_attributions
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'link';

ALTER TABLE public.seller_signup_attributions
  DROP CONSTRAINT IF EXISTS seller_signup_attributions_source_check;
ALTER TABLE public.seller_signup_attributions
  ADD CONSTRAINT seller_signup_attributions_source_check
  CHECK (source IN ('link', 'manual'));

ALTER TABLE public.seller_signup_attributions
  DROP CONSTRAINT IF EXISTS seller_signup_attributions_profile_role_check;
ALTER TABLE public.seller_signup_attributions
  ADD CONSTRAINT seller_signup_attributions_profile_role_check
  CHECK (
    (source = 'link' AND profile_role IN ('proprietario', 'imobiliaria', 'corretor'))
    OR
    (source = 'manual' AND profile_role IN (
      'admin', 'analista', 'financeiro', 'corretor',
      'imobiliaria', 'proprietario', 'inquilino'
    ))
  );

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
  IF v_email = '' OR position('@' IN v_email) <= 1 THEN
    RAISE EXCEPTION 'Informe um e-mail valido.';
  END IF;

  SELECT profile.*
  INTO v_profile
  FROM public.profiles AS profile
  WHERE lower(trim(profile.email)) = v_email
    AND coalesce(profile.status, 'ativo') = 'ativo'
  LIMIT 1;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'Nenhum login ativo foi encontrado para este e-mail.';
  END IF;
  IF v_profile.role::text NOT IN ('proprietario', 'imobiliaria', 'corretor')
     AND EXISTS (
       SELECT 1
       FROM public.internal_users AS employee
       WHERE employee.auth_user_id = v_profile.id
         AND employee.status = 'ativo'
     ) THEN
    RAISE EXCEPTION 'Este login pertence a equipe interna e nao pode ser cadastrado como cliente.';
  END IF;

  IF v_profile.role::text = 'proprietario' THEN
    SELECT owner.*
    INTO v_proprietario
    FROM public.proprietarios AS owner
    WHERE owner.profile_id = v_profile.id
       OR lower(trim(owner.email)) = v_email
    ORDER BY (owner.profile_id = v_profile.id) DESC, owner.created_at
    LIMIT 1;

    v_partner_type := 'proprietario';
    v_partner_name := coalesce(
      nullif(trim(v_proprietario.nome), ''),
      nullif(trim(v_profile.nome), ''),
      v_profile.email
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
      v_partner_name := coalesce(nullif(trim(v_profile.nome), ''), v_profile.email);
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
        v_profile.email
      );
      v_city := coalesce(v_corretor.cidade, v_imobiliaria.cidade);
    END IF;
    v_phone := coalesce(v_profile.telefone, v_imobiliaria.contato_telefone);
  ELSIF v_profile.role::text = 'imobiliaria' THEN
    SELECT agency.*
    INTO v_imobiliaria
    FROM public.imobiliarias AS agency
    WHERE lower(trim(agency.contato_email)) = v_email
    LIMIT 1;

    v_partner_type := 'imobiliaria';
    v_partner_name := coalesce(
      nullif(trim(v_imobiliaria.nome_fantasia), ''),
      nullif(trim(v_imobiliaria.razao_social), ''),
      nullif(trim(v_profile.nome), ''),
      v_profile.email
    );
    v_phone := coalesce(v_profile.telefone, v_imobiliaria.contato_telefone);
    v_city := v_imobiliaria.cidade;
  ELSE
    v_partner_type := 'cliente';
    v_partner_name := coalesce(nullif(trim(v_profile.nome), ''), v_profile.email);
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
    v_profile.email,
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
  IF v_email = '' OR position('@' IN v_email) <= 1 THEN
    RAISE EXCEPTION 'Informe um e-mail valido.';
  END IF;

  SELECT profile.*
  INTO v_profile
  FROM public.profiles AS profile
  WHERE lower(trim(profile.email)) = v_email
    AND coalesce(profile.status, 'ativo') = 'ativo'
  LIMIT 1;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'Nenhum login ativo foi encontrado para este e-mail.';
  END IF;
  IF v_profile.role::text NOT IN ('proprietario', 'imobiliaria', 'corretor')
     AND EXISTS (
       SELECT 1
       FROM public.internal_users AS employee
       WHERE employee.auth_user_id = v_profile.id
         AND employee.status = 'ativo'
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
    WHERE lower(trim(agency.contato_email)) = v_email
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

  -- Respeita tambem os vinculos criados antes da tabela de atribuicoes.
  -- Para imobiliarias, a trava vale para toda a empresa, inclusive corretores
  -- ligados a ela; para autonomos, vale para o perfil individual.
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
      v_email,
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
      v_email
    );
  END IF;

  RETURN coalesce(v_partnership_id, v_legacy_partnership_id, v_attribution_id);
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_seller_client_by_email(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.register_my_seller_client(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lookup_seller_client_by_email(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_my_seller_client(text) TO authenticated;

COMMENT ON FUNCTION public.lookup_seller_client_by_email(text) IS
  'Localiza uma conta NOX ativa de cliente, bloqueia identidades internas e informa a atribuicao na etapa SDR/Closer atual.';
COMMENT ON FUNCTION public.register_my_seller_client(text) IS
  'Atribui manualmente uma conta NOX de cliente ao SDR/Closer atual, com deduplicacao atomica por perfil e etapa comercial.';
COMMENT ON COLUMN public.seller_signup_attributions.source IS
  'Origem do credito comercial: cadastro concluido por link ou atribuicao manual por e-mail.';
