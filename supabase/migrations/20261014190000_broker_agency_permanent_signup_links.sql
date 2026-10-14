-- Link permanente e reutilizável para cadastro de corretores por imobiliária.
-- O token não expira e pode vincular quantos novos corretores forem necessários.

CREATE TABLE IF NOT EXISTS public.broker_agency_signup_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  imobiliaria_id uuid NOT NULL UNIQUE
    REFERENCES public.imobiliarias(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE
    DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  active boolean NOT NULL DEFAULT true,
  usage_count integer NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  last_used_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT broker_agency_signup_links_token_check
    CHECK (token ~ '^[a-f0-9]{48}$')
);

CREATE INDEX IF NOT EXISTS broker_agency_signup_links_token_active_idx
  ON public.broker_agency_signup_links (token)
  WHERE active;

CREATE TABLE IF NOT EXISTS public.broker_agency_signup_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL
    REFERENCES public.broker_agency_signup_links(id) ON DELETE RESTRICT,
  registered_profile_id uuid NOT NULL UNIQUE
    REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS broker_agency_signup_attributions_link_idx
  ON public.broker_agency_signup_attributions (link_id, created_at DESC);

ALTER TABLE public.broker_agency_signup_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broker_agency_signup_attributions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.broker_agency_signup_links,
  public.broker_agency_signup_attributions
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.broker_agency_signup_links,
  public.broker_agency_signup_attributions
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_or_create_my_broker_agency_signup_link()
RETURNS TABLE (token text, agency_name text, usage_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_imobiliaria_id uuid;
BEGIN
  v_imobiliaria_id := public.current_imobiliaria_id();
  IF v_imobiliaria_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Somente uma imobiliária autenticada pode gerar este link.';
  END IF;

  INSERT INTO public.broker_agency_signup_links (
    imobiliaria_id,
    created_by
  )
  VALUES (
    v_imobiliaria_id,
    auth.uid()
  )
  ON CONFLICT (imobiliaria_id)
  DO UPDATE SET
    active = true,
    updated_at = now();

  RETURN QUERY
  SELECT
    link.token,
    coalesce(nullif(trim(agency.nome_fantasia), ''), agency.razao_social)::text,
    link.usage_count
  FROM public.broker_agency_signup_links AS link
  JOIN public.imobiliarias AS agency ON agency.id = link.imobiliaria_id
  WHERE link.imobiliaria_id = v_imobiliaria_id
    AND link.active;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_broker_agency_signup_link(p_token text)
RETURNS TABLE (agency_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    coalesce(nullif(trim(agency.nome_fantasia), ''), agency.razao_social)::text
  FROM public.broker_agency_signup_links AS link
  JOIN public.imobiliarias AS agency ON agency.id = link.imobiliaria_id
  WHERE link.token = lower(trim(p_token))
    AND link.active
    AND p_token ~* '^[a-f0-9]{48}$'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.claim_broker_agency_signup_link(
  p_token text,
  p_profile_id uuid
)
RETURNS TABLE (imobiliaria_id uuid, agency_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_link record;
  v_profile_role text;
  v_current_imobiliaria_id uuid;
  v_existing_link_id uuid;
  v_inserted integer := 0;
BEGIN
  SELECT link.*,
    coalesce(nullif(trim(agency.nome_fantasia), ''), agency.razao_social) AS agency_name
  INTO v_link
  FROM public.broker_agency_signup_links AS link
  JOIN public.imobiliarias AS agency ON agency.id = link.imobiliaria_id
  WHERE link.token = lower(trim(p_token))
    AND link.active
    AND p_token ~* '^[a-f0-9]{48}$'
  LIMIT 1
  FOR UPDATE OF link;

  IF v_link.id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Link de cadastro da imobiliária inválido.';
  END IF;

  SELECT profile.role::text
  INTO v_profile_role
  FROM public.profiles AS profile
  WHERE profile.id = p_profile_id;

  IF v_profile_role IS DISTINCT FROM 'corretor' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'O link da imobiliária só pode ser usado por uma conta de corretor.';
  END IF;

  SELECT broker.imobiliaria_id
  INTO v_current_imobiliaria_id
  FROM public.corretores AS broker
  WHERE broker.profile_id = p_profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'O cadastro profissional do corretor ainda não foi criado.';
  END IF;

  IF v_current_imobiliaria_id IS NOT NULL
     AND v_current_imobiliaria_id IS DISTINCT FROM v_link.imobiliaria_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Este corretor já está vinculado a outra imobiliária.';
  END IF;

  SELECT attribution.link_id
  INTO v_existing_link_id
  FROM public.broker_agency_signup_attributions AS attribution
  WHERE attribution.registered_profile_id = p_profile_id;

  IF v_existing_link_id IS NOT NULL
     AND v_existing_link_id IS DISTINCT FROM v_link.id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Este cadastro já foi atribuído a outro link de imobiliária.';
  END IF;

  UPDATE public.corretores
  SET
    imobiliaria_id = v_link.imobiliaria_id,
    vinculado_imobiliaria = true,
    updated_at = now()
  WHERE profile_id = p_profile_id;

  INSERT INTO public.broker_agency_signup_attributions (
    link_id,
    registered_profile_id
  )
  VALUES (
    v_link.id,
    p_profile_id
  )
  ON CONFLICT (registered_profile_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted > 0 THEN
    UPDATE public.broker_agency_signup_links
    SET
      usage_count = usage_count + 1,
      last_used_at = now(),
      updated_at = now()
    WHERE id = v_link.id;
  END IF;

  RETURN QUERY SELECT v_link.imobiliaria_id, v_link.agency_name::text;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_my_broker_agency_signup_link()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_my_broker_agency_signup_link()
  TO authenticated;

REVOKE ALL ON FUNCTION public.resolve_broker_agency_signup_link(text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_broker_agency_signup_link(text)
  TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.claim_broker_agency_signup_link(text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_broker_agency_signup_link(text, uuid)
  TO service_role;

COMMENT ON TABLE public.broker_agency_signup_links IS
  'Links permanentes e reutilizáveis para auto-vínculo de novos corretores à imobiliária emissora.';
COMMENT ON FUNCTION public.get_or_create_my_broker_agency_signup_link() IS
  'Retorna sempre o mesmo link ativo e sem expiração da imobiliária autenticada.';
COMMENT ON FUNCTION public.resolve_broker_agency_signup_link(text) IS
  'Valida um link público e revela somente o nome da imobiliária para preencher o cadastro.';
COMMENT ON FUNCTION public.claim_broker_agency_signup_link(text, uuid) IS
  'Vincula de forma idempotente um novo perfil de corretor ao link permanente usado no cadastro.';
