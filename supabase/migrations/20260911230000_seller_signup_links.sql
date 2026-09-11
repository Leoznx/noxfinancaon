-- Links permanentes de cadastro para SDRs e Closers.
-- O vínculo acontece no servidor no mesmo momento em que o perfil é criado,
-- alimenta o ranking mensal e gera notificação/push para todos os responsáveis.

CREATE TABLE IF NOT EXISTS public.seller_signup_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES public.internal_users(id) ON DELETE CASCADE,
  profile_role text NOT NULL CHECK (profile_role IN ('proprietario', 'imobiliaria', 'corretor')),
  source_sdr_id uuid REFERENCES public.internal_users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  active boolean NOT NULL DEFAULT true,
  usage_count integer NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_sdr_id IS NULL OR source_sdr_id <> seller_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS seller_signup_links_direct_key
  ON public.seller_signup_links (seller_id, profile_role)
  WHERE source_sdr_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS seller_signup_links_shared_key
  ON public.seller_signup_links (seller_id, source_sdr_id, profile_role)
  WHERE source_sdr_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS seller_signup_links_token_active_idx
  ON public.seller_signup_links (token) WHERE active;

CREATE TABLE IF NOT EXISTS public.seller_signup_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.seller_signup_links(id) ON DELETE RESTRICT,
  seller_id uuid NOT NULL REFERENCES public.internal_users(id) ON DELETE CASCADE,
  seller_type text NOT NULL CHECK (seller_type IN ('sdr', 'closer')),
  registered_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  profile_role text NOT NULL CHECK (profile_role IN ('proprietario', 'imobiliaria', 'corretor')),
  registered_email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (registered_profile_id, seller_type)
);

CREATE INDEX IF NOT EXISTS seller_signup_attributions_seller_created_idx
  ON public.seller_signup_attributions (seller_id, created_at DESC);

ALTER TABLE public.seller_signup_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_signup_attributions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_signup_links, public.seller_signup_attributions
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.seller_signup_links, public.seller_signup_attributions TO authenticated;
GRANT ALL ON public.seller_signup_links, public.seller_signup_attributions TO service_role;

DROP POLICY IF EXISTS "Equipe comercial visualiza seus links de cadastro" ON public.seller_signup_links;
CREATE POLICY "Equipe comercial visualiza seus links de cadastro"
  ON public.seller_signup_links FOR SELECT TO authenticated
  USING (
    seller_id = public.internal_user_id(auth.uid())
    OR source_sdr_id = public.internal_user_id(auth.uid())
    OR public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  );

DROP POLICY IF EXISTS "Equipe comercial visualiza suas atribuicoes de cadastro" ON public.seller_signup_attributions;
CREATE POLICY "Equipe comercial visualiza suas atribuicoes de cadastro"
  ON public.seller_signup_attributions FOR SELECT TO authenticated
  USING (
    seller_id = public.internal_user_id(auth.uid())
    OR public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  );

-- Um closer só pode compartilhar crédito com SDRs que realmente encaminharam
-- pelo menos uma reunião para ele. Isso mantém a seleção curta e auditável.
CREATE OR REPLACE FUNCTION public.get_my_signup_link_sdrs()
RETURNS TABLE (sdr_id uuid, sdr_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_closer_id uuid;
BEGIN
  SELECT seller.id INTO v_closer_id
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid()
    AND seller.role = 'vendedor'
    AND seller.seller_type = 'closer'
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_closer_id IS NULL THEN
    RAISE EXCEPTION 'Somente Closers ativos podem consultar SDRs de origem.';
  END IF;

  RETURN QUERY
  SELECT DISTINCT sdr.id, sdr.full_name
  FROM public.seller_appointments AS appointment
  JOIN public.internal_users AS sdr ON sdr.id = appointment.sdr_id
  WHERE appointment.assigned_closer_id = v_closer_id
    AND appointment.source = 'sdr_handoff'
    AND sdr.role = 'vendedor'
    AND sdr.seller_type = 'sdr'
    AND sdr.status = 'ativo'
  ORDER BY sdr.full_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_seller_signup_links(p_source_sdr_id uuid DEFAULT NULL)
RETURNS TABLE (profile_role text, token text, source_sdr_id uuid, source_sdr_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_id uuid;
  v_seller_type text;
BEGIN
  SELECT seller.id, seller.seller_type INTO v_seller_id, v_seller_type
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid()
    AND seller.role = 'vendedor'
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_seller_id IS NULL OR coalesce(v_seller_type, '') NOT IN ('sdr', 'closer') THEN
    RAISE EXCEPTION 'Somente SDRs e Closers ativos podem gerar links de cadastro.';
  END IF;

  IF p_source_sdr_id IS NOT NULL THEN
    IF v_seller_type <> 'closer' THEN
      RAISE EXCEPTION 'Apenas Closers podem compartilhar um cadastro com um SDR.';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.seller_appointments AS appointment
      JOIN public.internal_users AS sdr ON sdr.id = appointment.sdr_id
      WHERE appointment.assigned_closer_id = v_seller_id
        AND appointment.sdr_id = p_source_sdr_id
        AND appointment.source = 'sdr_handoff'
        AND sdr.role = 'vendedor'
        AND sdr.seller_type = 'sdr'
        AND sdr.status = 'ativo'
    ) THEN
      RAISE EXCEPTION 'Este SDR não possui reunião encaminhada para o Closer atual.';
    END IF;

    INSERT INTO public.seller_signup_links (seller_id, profile_role, source_sdr_id)
    SELECT v_seller_id, role_name, p_source_sdr_id
    FROM unnest(ARRAY['proprietario', 'imobiliaria', 'corretor']) AS role_name
    ON CONFLICT (seller_id, source_sdr_id, profile_role) WHERE source_sdr_id IS NOT NULL
    DO UPDATE SET active = true, updated_at = now();
  ELSE
    INSERT INTO public.seller_signup_links (seller_id, profile_role, source_sdr_id)
    SELECT v_seller_id, role_name, NULL::uuid
    FROM unnest(ARRAY['proprietario', 'imobiliaria', 'corretor']) AS role_name
    ON CONFLICT (seller_id, profile_role) WHERE source_sdr_id IS NULL
    DO UPDATE SET active = true, updated_at = now();
  END IF;

  RETURN QUERY
  SELECT link.profile_role, link.token, link.source_sdr_id, source_sdr.full_name
  FROM public.seller_signup_links AS link
  LEFT JOIN public.internal_users AS source_sdr ON source_sdr.id = link.source_sdr_id
  WHERE link.seller_id = v_seller_id
    AND link.source_sdr_id IS NOT DISTINCT FROM p_source_sdr_id
    AND link.active
  ORDER BY array_position(ARRAY['proprietario', 'imobiliaria', 'corretor'], link.profile_role);
END;
$$;

-- Chamadas exclusivas do backend com service_role. O token nunca é aceito se
-- o dono estiver inativo, a função não bater ou o vínculo compartilhado perder validade.
CREATE OR REPLACE FUNCTION public.resolve_seller_signup_link(p_token text, p_profile_role text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.seller_signup_links AS link
    JOIN public.internal_users AS seller ON seller.id = link.seller_id
    LEFT JOIN public.internal_users AS source_sdr ON source_sdr.id = link.source_sdr_id
    WHERE link.token = p_token
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
  );
$$;

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
BEGIN
  SELECT lower(profile.email), profile.role::text
    INTO v_profile_email, v_profile_role
  FROM public.profiles AS profile
  WHERE profile.id = p_profile_id;

  IF v_profile_email IS NULL
     OR v_profile_email <> lower(trim(p_email))
     OR v_profile_role <> p_profile_role
     OR p_profile_role NOT IN ('proprietario', 'imobiliaria', 'corretor') THEN
    RAISE EXCEPTION 'Os dados do cadastro não correspondem ao perfil criado.';
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
  WHERE link.token = p_token
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
    RAISE EXCEPTION 'Link de cadastro inválido ou inativo.';
  END IF;

  v_role_label := CASE p_profile_role
    WHEN 'proprietario' THEN 'proprietário'
    WHEN 'imobiliaria' THEN 'imobiliária'
    ELSE 'corretor'
  END;

  INSERT INTO public.seller_signup_attributions (
    link_id, seller_id, seller_type, registered_profile_id, profile_role, registered_email
  ) VALUES (
    v_link.id, v_link.seller_id, v_link.seller_type,
    p_profile_id, p_profile_role, lower(trim(p_email))
  )
  ON CONFLICT (registered_profile_id, seller_type) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted > 0 THEN
    v_any_inserted := true;
    INSERT INTO public.notificacoes (
      user_id, titulo, mensagem, tipo, icone, cor_destaque, link
    ) VALUES (
      v_link.auth_user_id,
      'Novo cadastro pelo seu link',
      trim(coalesce(p_display_name, 'Um novo cliente')) || ' concluiu o cadastro como ' ||
        v_role_label || '. O cadastro já entrou no seu ranking.',
      'cadastro_link', 'user-plus', 'amarelo', '/vendedor/ranking'
    );
    RETURN QUERY SELECT v_link.email::text, v_link.full_name::text, v_link.seller_type::text;
  END IF;

  IF v_link.source_sdr_id IS NOT NULL THEN
    INSERT INTO public.seller_signup_attributions (
      link_id, seller_id, seller_type, registered_profile_id, profile_role, registered_email
    ) VALUES (
      v_link.id, v_link.source_sdr_id, 'sdr',
      p_profile_id, p_profile_role, lower(trim(p_email))
    )
    ON CONFLICT (registered_profile_id, seller_type) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    IF v_inserted > 0 THEN
      v_any_inserted := true;
      INSERT INTO public.notificacoes (
        user_id, titulo, mensagem, tipo, icone, cor_destaque, link
      ) VALUES (
        v_link.source_auth_user_id,
        'Novo cadastro compartilhado',
        trim(coalesce(p_display_name, 'Um novo cliente')) || ' concluiu o cadastro como ' ||
          v_role_label || ' após sua reunião. O cadastro já entrou no ranking do SDR e do Closer.',
        'cadastro_link', 'user-plus', 'amarelo', '/vendedor/ranking'
      );
      RETURN QUERY SELECT v_link.source_email::text, v_link.source_name::text, 'sdr'::text;
    END IF;
  END IF;

  IF v_any_inserted THEN
    UPDATE public.seller_signup_links
    SET usage_count = usage_count + 1, last_used_at = now(), updated_at = now()
    WHERE id = v_link.id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_signup_link_sdrs() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_seller_signup_links(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_seller_signup_link(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_seller_signup_link(text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_signup_link_sdrs() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_seller_signup_links(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_seller_signup_link(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_seller_signup_link(text, uuid, text, text, text) TO service_role;

-- Ranking mensal: mantém os cadastros manuais existentes e soma os perfis que
-- concluíram o cadastro pelos links, sem duplicar o mesmo perfil para a mesma etapa.
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
  WITH registration_sources AS (
    SELECT partnership.seller_id,
      coalesce(partnership.client_profile_id::text, matched_profile.id::text, 'legacy:' || partnership.id::text) AS registration_key,
      partnership.created_at
    FROM public.seller_client_partnerships AS partnership
    LEFT JOIN public.imobiliarias AS agency ON agency.id = partnership.imobiliaria_id
    LEFT JOIN public.profiles AS matched_profile
      ON lower(matched_profile.email) = lower(agency.contato_email)
    UNION ALL
    SELECT attribution.seller_id, attribution.registered_profile_id::text, attribution.created_at
    FROM public.seller_signup_attributions AS attribution
  ), metrics AS (
    SELECT seller.id, seller.full_name, profile.avatar_url, seller.seller_type,
      count(DISTINCT source.registration_key)::bigint AS registrations
    FROM public.internal_users seller
    LEFT JOIN public.profiles profile ON profile.id = seller.auth_user_id
    LEFT JOIN registration_sources source
      ON source.seller_id = seller.id
     AND source.created_at >= v_start AND source.created_at < v_end
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

COMMENT ON TABLE public.seller_signup_links IS
  'Links permanentes de cadastro de proprietário, imobiliária e corretor por SDR/Closer.';
COMMENT ON TABLE public.seller_signup_attributions IS
  'Créditos imutáveis de cadastros concluídos via link comercial, um por perfil e etapa SDR/Closer.';
