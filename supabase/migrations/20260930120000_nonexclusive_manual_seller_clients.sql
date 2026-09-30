-- Permite que um cliente seja adicionado manualmente por mais de um SDR ou
-- Closer sem retirar os vinculos anteriores. A origem declarada pelo vendedor
-- (apresentou/captou) fica auditavel no proprio credito comercial.

BEGIN;

ALTER TABLE public.seller_signup_attributions
  ADD COLUMN IF NOT EXISTS manual_relationship text;

ALTER TABLE public.seller_signup_attributions
  DROP CONSTRAINT IF EXISTS seller_signup_attributions_manual_relationship_check;
ALTER TABLE public.seller_signup_attributions
  ADD CONSTRAINT seller_signup_attributions_manual_relationship_check
  CHECK (
    manual_relationship IS NULL
    OR (
      source = 'manual'
      AND manual_relationship IN ('apresentou', 'captou')
    )
  );

-- O credito deixa de ser exclusivo por etapa. Cada vendedor pode manter um
-- unico credito por cliente e funcao, enquanto outros responsaveis preservam
-- os seus proprios registros.
ALTER TABLE public.seller_signup_attributions
  DROP CONSTRAINT IF EXISTS seller_signup_attributions_registered_profile_id_seller_type_key;

CREATE UNIQUE INDEX IF NOT EXISTS seller_signup_attributions_profile_seller_type_key
  ON public.seller_signup_attributions (registered_profile_id, seller_id, seller_type);

COMMENT ON COLUMN public.seller_signup_attributions.manual_relationship IS
  'No cadastro manual, informa se o SDR/Closer apresentou ou captou o cliente.';

-- Mantem os links permanentes idempotentes com a nova chave por vendedor.
CREATE OR REPLACE FUNCTION public.claim_seller_signup_link(
  p_token text,
  p_profile_id uuid,
  p_profile_role text,
  p_email text,
  p_display_name text
)
RETURNS TABLE (recipient_email text, recipient_name text, credited_seller_type text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_link record;
  v_profile_email text;
  v_profile_role text;
  v_role_label text;
  v_inserted integer := 0;
  v_any_inserted boolean := false;
  v_seller_credited boolean := false;
  v_sdr_credited boolean := false;
BEGIN
  SELECT lower(profile.email), profile.role::text
    INTO v_profile_email, v_profile_role
  FROM public.profiles AS profile
  WHERE profile.id = p_profile_id;

  IF v_profile_email IS NULL
     OR v_profile_email <> lower(trim(p_email))
     OR v_profile_role <> p_profile_role
     OR p_profile_role NOT IN ('proprietario', 'imobiliaria', 'corretor') THEN
    RAISE EXCEPTION 'Os dados do cadastro nao correspondem ao perfil criado.';
  END IF;

  SELECT link.id, link.seller_id, link.source_sdr_id,
    seller.seller_type, seller.auth_user_id, seller.email, seller.full_name,
    source_sdr.auth_user_id AS source_auth_user_id,
    source_sdr.email AS source_email,
    source_sdr.full_name AS source_name
  INTO v_link
  FROM public.seller_signup_links AS link
  JOIN public.internal_users AS seller ON seller.id = link.seller_id
  LEFT JOIN public.internal_users AS source_sdr ON source_sdr.id = link.source_sdr_id
  WHERE link.token = trim(p_token)
    AND link.profile_role = p_profile_role
    AND link.active
    AND seller.role = 'vendedor'
    AND seller.seller_type IN ('sdr', 'closer')
    AND seller.status = 'ativo'
    AND (
      link.source_sdr_id IS NULL
      OR (
        seller.seller_type = 'closer'
        AND source_sdr.role = 'vendedor'
        AND source_sdr.seller_type = 'sdr'
        AND source_sdr.status = 'ativo'
        AND EXISTS (
          SELECT 1 FROM public.seller_appointments AS appointment
          WHERE appointment.assigned_closer_id = seller.id
            AND appointment.sdr_id = source_sdr.id
            AND appointment.source = 'sdr_handoff'
        )
      )
    )
  LIMIT 1
  FOR UPDATE OF link;

  IF v_link.id IS NULL THEN
    RAISE EXCEPTION 'Link de cadastro invalido ou inativo.';
  END IF;

  v_role_label := CASE p_profile_role
    WHEN 'proprietario' THEN 'proprietario'
    WHEN 'imobiliaria' THEN 'imobiliaria'
    ELSE 'corretor'
  END;

  INSERT INTO public.seller_signup_attributions (
    link_id, seller_id, seller_type, registered_profile_id, profile_role, registered_email
  ) VALUES (
    v_link.id, v_link.seller_id, v_link.seller_type,
    p_profile_id, p_profile_role, lower(trim(p_email))
  )
  ON CONFLICT (registered_profile_id, seller_id, seller_type) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  PERFORM public.ensure_seller_signup_partnership(
    v_link.seller_id, p_profile_id, p_profile_role, p_email
  );

  IF v_inserted > 0 THEN
    v_any_inserted := true;
    INSERT INTO public.notificacoes (
      user_id, titulo, mensagem, tipo, icone, cor_destaque, link
    ) VALUES (
      v_link.auth_user_id,
      'Novo cadastro pelo seu link',
      trim(coalesce(p_display_name, 'Um novo cliente')) || ' concluiu o cadastro como ' ||
        v_role_label || '. O cadastro ja entrou no seu ranking e na sua carteira.',
      'cadastro_link', 'user-plus', 'amarelo', '/vendedor/ranking'
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.seller_signup_attributions AS attribution
    WHERE attribution.registered_profile_id = p_profile_id
      AND attribution.seller_id = v_link.seller_id
      AND attribution.link_id = v_link.id
  ) INTO v_seller_credited;

  IF v_link.source_sdr_id IS NOT NULL THEN
    INSERT INTO public.seller_signup_attributions (
      link_id, seller_id, seller_type, registered_profile_id, profile_role, registered_email
    ) VALUES (
      v_link.id, v_link.source_sdr_id, 'sdr',
      p_profile_id, p_profile_role, lower(trim(p_email))
    )
    ON CONFLICT (registered_profile_id, seller_id, seller_type) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    PERFORM public.ensure_seller_signup_partnership(
      v_link.source_sdr_id, p_profile_id, p_profile_role, p_email
    );

    IF v_inserted > 0 THEN
      v_any_inserted := true;
      INSERT INTO public.notificacoes (
        user_id, titulo, mensagem, tipo, icone, cor_destaque, link
      ) VALUES (
        v_link.source_auth_user_id,
        'Novo cadastro compartilhado',
        trim(coalesce(p_display_name, 'Um novo cliente')) || ' concluiu o cadastro como ' ||
          v_role_label || ' apos sua reuniao. O cliente esta vinculado ao SDR e ao Closer.',
        'cadastro_link', 'user-plus', 'amarelo', '/vendedor/ranking'
      );
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.seller_signup_attributions AS attribution
      WHERE attribution.registered_profile_id = p_profile_id
        AND attribution.seller_id = v_link.source_sdr_id
        AND attribution.link_id = v_link.id
    ) INTO v_sdr_credited;
  END IF;

  IF v_any_inserted THEN
    UPDATE public.seller_signup_links
    SET usage_count = usage_count + 1, last_used_at = now(), updated_at = now()
    WHERE id = v_link.id;
  END IF;

  IF v_seller_credited THEN
    RETURN QUERY SELECT v_link.email::text, v_link.full_name::text, v_link.seller_type::text;
  END IF;
  IF v_sdr_credited THEN
    RETURN QUERY SELECT v_link.source_email::text, v_link.source_name::text, 'sdr'::text;
  END IF;
END;
$$;

-- A busca especifica do fluxo manual prioriza o vinculo do usuario atual. A
-- resposta antiga e preservada para os demais consumidores do contrato.
CREATE OR REPLACE FUNCTION public.lookup_manual_seller_client_by_email(p_email text)
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
  v_client record;
BEGIN
  SELECT seller.id
  INTO v_seller_id
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid()
    AND seller.role = 'vendedor'
    AND seller.seller_type IN ('sdr', 'closer')
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_seller_id IS NULL THEN
    RAISE EXCEPTION 'Somente SDRs e Closers ativos podem localizar clientes.';
  END IF;

  SELECT lookup.*
  INTO v_client
  FROM public.lookup_seller_client_by_email(p_email) AS lookup;

  IF EXISTS (
    SELECT 1
    FROM public.seller_signup_attributions AS attribution
    WHERE attribution.registered_profile_id = v_client.profile_id
      AND attribution.seller_id = v_seller_id
  ) THEN
    v_client.link_status := 'already_mine';
    v_client.linked_seller_name := NULL;
  END IF;

  RETURN QUERY
  SELECT
    v_client.profile_id::uuid,
    v_client.full_name::text,
    v_client.email::text,
    v_client.partner_type::text,
    v_client.partner_name::text,
    v_client.phone::text,
    v_client.city::text,
    v_client.link_status::text,
    v_client.linked_seller_name::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_my_manual_seller_client(
  p_email text,
  p_relationship text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller public.internal_users%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_relationship text := lower(trim(coalesce(p_relationship, '')));
  v_login_email text;
  v_attribution_id uuid;
  v_partnership_id uuid;
BEGIN
  IF v_relationship NOT IN ('apresentou', 'captou') THEN
    RAISE EXCEPTION 'Selecione se voce apresentou ou captou o cliente.';
  END IF;

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

  SELECT attribution.id
  INTO v_attribution_id
  FROM public.seller_signup_attributions AS attribution
  WHERE attribution.registered_profile_id = v_profile.id
    AND attribution.seller_id = v_seller.id
  ORDER BY attribution.created_at
  LIMIT 1
  FOR UPDATE OF attribution;

  IF v_attribution_id IS NULL THEN
    INSERT INTO public.seller_signup_attributions (
      link_id,
      seller_id,
      seller_type,
      registered_profile_id,
      profile_role,
      registered_email,
      source,
      manual_relationship
    ) VALUES (
      NULL,
      v_seller.id,
      v_seller.seller_type,
      v_profile.id,
      v_profile.role::text,
      v_login_email,
      'manual',
      v_relationship
    )
    ON CONFLICT (registered_profile_id, seller_id, seller_type) DO NOTHING
    RETURNING id INTO v_attribution_id;

    IF v_attribution_id IS NULL THEN
      SELECT attribution.id
      INTO v_attribution_id
      FROM public.seller_signup_attributions AS attribution
      WHERE attribution.registered_profile_id = v_profile.id
        AND attribution.seller_id = v_seller.id
      ORDER BY attribution.created_at
      LIMIT 1;
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

  RETURN coalesce(v_partnership_id, v_attribution_id);
END;
$$;

-- Compatibilidade para versoes anteriores dos clientes. O fluxo novo sempre
-- usa a assinatura de dois parametros e exige a escolha explicita.
CREATE OR REPLACE FUNCTION public.register_my_seller_client(p_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.register_my_manual_seller_client(p_email, 'captou');
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_manual_seller_client_by_email(text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.register_my_manual_seller_client(text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lookup_manual_seller_client_by_email(text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_my_manual_seller_client(text, text)
  TO authenticated;

COMMENT ON FUNCTION public.lookup_manual_seller_client_by_email(text) IS
  'Localiza uma conta NOX para cadastro manual e informa o vinculo do SDR/Closer atual sem ocultar outros responsaveis.';
COMMENT ON FUNCTION public.register_my_manual_seller_client(text, text) IS
  'Adiciona um credito manual nao exclusivo, preserva responsaveis anteriores e registra se o cliente foi apresentado ou captado.';
COMMENT ON FUNCTION public.register_my_seller_client(text) IS
  'Compatibilidade com clientes antigos; novos clientes usam register_my_manual_seller_client com a origem declarada.';

NOTIFY pgrst, 'reload schema';

COMMIT;
