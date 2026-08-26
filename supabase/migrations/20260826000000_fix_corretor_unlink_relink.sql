-- Garante que um desvínculo libere o corretor de forma definitiva e permite
-- recuperar vínculos órfãos, isto é, apontando para uma imobiliária que não
-- possui mais uma conta de imobiliária correspondente na plataforma.

CREATE OR REPLACE FUNCTION public.has_registered_imobiliaria_owner(
  p_imobiliaria_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_imobiliaria_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.imobiliarias AS imobiliaria
      JOIN public.profiles AS profile
        ON lower(profile.email) = lower(imobiliaria.contato_email)
      WHERE imobiliaria.id = p_imobiliaria_id
        AND profile.role::text = 'imobiliaria'
    );
$$;

CREATE OR REPLACE FUNCTION public.is_my_imobiliaria(
  p_imobiliaria_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_imobiliaria_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.imobiliarias AS imobiliaria
      JOIN public.profiles AS profile
        ON lower(profile.email) = lower(imobiliaria.contato_email)
      WHERE imobiliaria.id = p_imobiliaria_id
        AND profile.id = auth.uid()
        AND profile.role::text = 'imobiliaria'
    );
$$;

CREATE OR REPLACE FUNCTION public.link_my_corretor(p_corretor_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_imobiliaria_id uuid;
  v_linked_imobiliaria_id uuid;
  v_status text;
BEGIN
  v_imobiliaria_id := public.current_imobiliaria_id();
  IF v_imobiliaria_id IS NULL THEN
    RAISE EXCEPTION 'Não foi possível identificar a imobiliária vinculada à sua conta.';
  END IF;

  SELECT corretor.imobiliaria_id, profile.status
  INTO v_linked_imobiliaria_id, v_status
  FROM public.corretores AS corretor
  JOIN public.profiles AS profile ON profile.id = corretor.profile_id
  WHERE corretor.id = p_corretor_id
    AND profile.role::text = 'corretor'
  FOR UPDATE OF corretor;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Corretor não encontrado.';
  END IF;
  IF NOT public.is_corretor_linkable_status(v_status) THEN
    RAISE EXCEPTION 'Este corretor está bloqueado ou indisponível para vínculo.';
  END IF;

  IF v_linked_imobiliaria_id IS NOT NULL
    AND v_linked_imobiliaria_id <> v_imobiliaria_id THEN
    -- Mais de uma linha de imobiliária pode compartilhar o mesmo e-mail
    -- legado. Se a linha atual também pertence à sessão, preserve-a.
    IF public.is_my_imobiliaria(v_linked_imobiliaria_id) THEN
      v_imobiliaria_id := v_linked_imobiliaria_id;
    ELSIF public.has_registered_imobiliaria_owner(v_linked_imobiliaria_id) THEN
      RAISE EXCEPTION 'Este corretor já possui vínculo com outra imobiliária.';
    END IF;
    -- Sem uma conta proprietária, o ID antigo é órfão e pode ser substituído
    -- pela imobiliária autenticada. Isso não transfere vínculos válidos.
  END IF;

  UPDATE public.corretores AS corretor
  SET
    imobiliaria_id = v_imobiliaria_id,
    vinculado_imobiliaria = true,
    updated_at = now()
  WHERE corretor.id = p_corretor_id;

  RETURN p_corretor_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.unlink_my_corretor(p_corretor_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_linked_imobiliaria_id uuid;
  v_cleared_id uuid;
BEGIN
  SELECT corretor.imobiliaria_id
  INTO v_linked_imobiliaria_id
  FROM public.corretores AS corretor
  WHERE corretor.id = p_corretor_id
  FOR UPDATE;

  IF NOT FOUND OR v_linked_imobiliaria_id IS NULL THEN
    RAISE EXCEPTION 'Este corretor não está vinculado à sua imobiliária.';
  END IF;
  IF NOT public.is_my_imobiliaria(v_linked_imobiliaria_id) THEN
    RAISE EXCEPTION 'Este corretor não está vinculado à sua imobiliária.';
  END IF;

  UPDATE public.corretores AS corretor
  SET
    imobiliaria_id = NULL,
    vinculado_imobiliaria = false,
    updated_at = now()
  WHERE corretor.id = p_corretor_id
    AND corretor.imobiliaria_id = v_linked_imobiliaria_id
  RETURNING corretor.id INTO v_cleared_id;

  IF v_cleared_id IS NULL THEN
    RAISE EXCEPTION 'Não foi possível concluir o desvínculo do corretor.';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.has_registered_imobiliaria_owner(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_my_imobiliaria(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.link_my_corretor(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unlink_my_corretor(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.link_my_corretor(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unlink_my_corretor(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.has_registered_imobiliaria_owner(uuid) IS
  'Indica se o vínculo aponta para uma imobiliária que ainda possui conta correspondente.';
COMMENT ON FUNCTION public.is_my_imobiliaria(uuid) IS
  'Confirma que uma linha de imobiliária pertence à sessão autenticada, inclusive em duplicatas legadas.';
COMMENT ON FUNCTION public.link_my_corretor(uuid) IS
  'Vincula um corretor elegível, preserva vínculos válidos e recupera vínculos órfãos.';
COMMENT ON FUNCTION public.unlink_my_corretor(uuid) IS
  'Remove e confirma atomicamente o vínculo do corretor com qualquer linha de imobiliária pertencente à sessão.';

NOTIFY pgrst, 'reload schema';
