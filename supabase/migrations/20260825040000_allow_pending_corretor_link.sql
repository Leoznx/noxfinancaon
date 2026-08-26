-- Permite organizar a equipe antes da ativação final da conta do corretor.
-- O vínculo apenas associa o corretor à imobiliária; ele não ativa a conta nem
-- contorna as demais regras de acesso da plataforma.

CREATE OR REPLACE FUNCTION public.is_corretor_linkable_status(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT lower(trim(coalesce(p_status, ''))) IN (
    'ativo',
    'pendente',
    'pendente_aprovacao'
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
    RAISE EXCEPTION 'Este corretor já possui vínculo com outra imobiliária.';
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

REVOKE ALL ON FUNCTION public.is_corretor_linkable_status(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.link_my_corretor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_my_corretor(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.is_corretor_linkable_status(text) IS
  'Regra compartilhada de status que permite vínculo sem ativar a conta do corretor.';
COMMENT ON FUNCTION public.link_my_corretor(uuid) IS
  'Vincula um corretor elegível à imobiliária da sessão sem alterar o status da conta.';

NOTIFY pgrst, 'reload schema';
