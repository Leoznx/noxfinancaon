
-- Lookup function: returns a minimal corretor record by CPF or email, only for active corretores
CREATE OR REPLACE FUNCTION public.find_corretor(p_query text, p_by text)
RETURNS TABLE(
  corretor_id uuid,
  profile_id uuid,
  nome text,
  email text,
  telefone text,
  cpf text,
  creci text,
  status text,
  imobiliaria_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm text;
BEGIN
  IF p_by = 'cpf' THEN
    v_norm := regexp_replace(coalesce(p_query,''), '\D', '', 'g');
    IF length(v_norm) <> 11 THEN
      RETURN;
    END IF;
    RETURN QUERY
    SELECT c.id, p.id, p.nome, p.email, p.telefone, c.cpf, c.creci, p.status, c.imobiliaria_id
    FROM public.corretores c
    JOIN public.profiles p ON p.id = c.profile_id
    WHERE c.cpf = v_norm
      AND p.role = 'corretor'::user_role
    LIMIT 1;
  ELSIF p_by = 'email' THEN
    v_norm := lower(trim(coalesce(p_query,'')));
    IF v_norm = '' THEN
      RETURN;
    END IF;
    RETURN QUERY
    SELECT c.id, p.id, p.nome, p.email, p.telefone, c.cpf, c.creci, p.status, c.imobiliaria_id
    FROM public.corretores c
    JOIN public.profiles p ON p.id = c.profile_id
    WHERE lower(p.email) = v_norm
      AND p.role = 'corretor'::user_role
    LIMIT 1;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_corretor(text, text) TO anon, authenticated;

-- Ensure baseline SELECT grants so the existing listing keeps working
GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT SELECT ON public.corretores TO anon, authenticated;
GRANT SELECT ON public.imobiliarias TO anon, authenticated;
GRANT UPDATE (imobiliaria_id, vinculado_imobiliaria, updated_at) ON public.corretores TO anon, authenticated;
