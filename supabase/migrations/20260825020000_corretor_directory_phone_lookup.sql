-- Diretório canônico de corretores para vínculo com imobiliárias.
--
-- Corrige três falhas do fluxo legado:
--   1. CPF era salvo com máscara, mas comparado com apenas dígitos;
--   2. perfis antigos de corretor podiam não ter linha em public.corretores;
--   3. o vínculo era alterado diretamente pelo cliente, sem operação atômica.

CREATE OR REPLACE FUNCTION public.normalize_cpf_lookup(p_cpf text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN length(regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g')) = 11
      THEN regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g')
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_br_phone_lookup(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
BEGIN
  IF length(v_digits) IN (12, 13) AND left(v_digits, 2) = '55' THEN
    v_digits := substring(v_digits FROM 3);
  END IF;

  IF length(v_digits) NOT IN (10, 11) OR left(v_digits, 1) = '0' THEN
    RETURN NULL;
  END IF;

  RETURN v_digits;
END;
$$;

-- Normaliza os CPFs válidos que já existem sem apagar valores legados
-- incompletos. Novas escritas passam a ser validadas pelo trigger abaixo.
UPDATE public.corretores AS corretor
SET cpf = public.normalize_cpf_lookup(corretor.cpf)
WHERE public.normalize_cpf_lookup(corretor.cpf) IS NOT NULL
  AND corretor.cpf IS DISTINCT FROM public.normalize_cpf_lookup(corretor.cpf);

CREATE OR REPLACE FUNCTION public.normalize_corretor_directory_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cpf text;
BEGIN
  IF nullif(trim(coalesce(NEW.cpf, '')), '') IS NOT NULL THEN
    v_cpf := public.normalize_cpf_lookup(NEW.cpf);
    IF v_cpf IS NULL THEN
      RAISE EXCEPTION 'Informe um CPF válido com 11 dígitos.';
    END IF;
    NEW.cpf := v_cpf;
  ELSE
    NEW.cpf := NULL;
  END IF;

  NEW.vinculado_imobiliaria := NEW.imobiliaria_id IS NOT NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_corretor_directory_row ON public.corretores;
CREATE TRIGGER normalize_corretor_directory_row
  BEFORE INSERT OR UPDATE OF cpf, imobiliaria_id, vinculado_imobiliaria
  ON public.corretores
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_corretor_directory_row();

-- Todo profile com role corretor recebe automaticamente a linha profissional.
-- Metadados são usados apenas para recuperar cadastros antigos ou tolerar uma
-- falha intermediária entre a criação do usuário e o upsert profissional.
CREATE OR REPLACE FUNCTION public.sync_corretor_directory_from_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_metadata jsonb := '{}'::jsonb;
BEGIN
  IF NEW.role::text <> 'corretor' THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(auth_user.raw_user_meta_data, '{}'::jsonb)
  INTO v_metadata
  FROM auth.users AS auth_user
  WHERE auth_user.id = NEW.id;

  INSERT INTO public.corretores AS directory (
    profile_id,
    cpf,
    creci,
    cidade,
    estado
  ) VALUES (
    NEW.id,
    public.normalize_cpf_lookup(v_metadata->>'cpf'),
    nullif(trim(v_metadata->>'creci'), ''),
    nullif(trim(v_metadata->>'cidade'), ''),
    nullif(trim(v_metadata->>'estado'), '')
  )
  ON CONFLICT (profile_id) DO UPDATE
  SET
    cpf = coalesce(directory.cpf, EXCLUDED.cpf),
    creci = coalesce(directory.creci, EXCLUDED.creci),
    cidade = coalesce(directory.cidade, EXCLUDED.cidade),
    estado = coalesce(directory.estado, EXCLUDED.estado),
    updated_at = CASE
      WHEN directory.cpf IS NULL AND EXCLUDED.cpf IS NOT NULL THEN now()
      WHEN directory.creci IS NULL AND EXCLUDED.creci IS NOT NULL THEN now()
      WHEN directory.cidade IS NULL AND EXCLUDED.cidade IS NOT NULL THEN now()
      WHEN directory.estado IS NULL AND EXCLUDED.estado IS NOT NULL THEN now()
      ELSE directory.updated_at
    END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_corretor_directory_from_profile ON public.profiles;
CREATE TRIGGER sync_corretor_directory_from_profile
  AFTER INSERT OR UPDATE OF role, email, telefone
  ON public.profiles
  FOR EACH ROW
  WHEN (NEW.role::text = 'corretor')
  EXECUTE FUNCTION public.sync_corretor_directory_from_profile();

-- Recupera imediatamente todos os perfis antigos que ficaram sem diretório.
INSERT INTO public.corretores AS directory (
  profile_id,
  cpf,
  creci,
  cidade,
  estado
)
SELECT
  profile.id,
  public.normalize_cpf_lookup(auth_user.raw_user_meta_data->>'cpf'),
  nullif(trim(auth_user.raw_user_meta_data->>'creci'), ''),
  nullif(trim(auth_user.raw_user_meta_data->>'cidade'), ''),
  nullif(trim(auth_user.raw_user_meta_data->>'estado'), '')
FROM public.profiles AS profile
LEFT JOIN auth.users AS auth_user ON auth_user.id = profile.id
WHERE profile.role::text = 'corretor'
ON CONFLICT (profile_id) DO UPDATE
SET
  cpf = coalesce(directory.cpf, EXCLUDED.cpf),
  creci = coalesce(directory.creci, EXCLUDED.creci),
  cidade = coalesce(directory.cidade, EXCLUDED.cidade),
  estado = coalesce(directory.estado, EXCLUDED.estado);

CREATE INDEX IF NOT EXISTS corretores_cpf_normalized_lookup_idx
  ON public.corretores (public.normalize_cpf_lookup(cpf))
  WHERE cpf IS NOT NULL;

CREATE INDEX IF NOT EXISTS profiles_corretor_email_lookup_idx
  ON public.profiles (lower(trim(email)))
  WHERE role = 'corretor'::public.user_role;

CREATE INDEX IF NOT EXISTS profiles_corretor_phone_lookup_idx
  ON public.profiles (public.normalize_br_phone_lookup(telefone))
  WHERE role = 'corretor'::public.user_role AND telefone IS NOT NULL;

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
SET search_path = public, pg_temp
AS $$
DECLARE
  v_query text;
  v_role text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    SELECT profile.role::text
    INTO v_role
    FROM public.profiles AS profile
    WHERE profile.id = auth.uid();

    IF v_role IS NULL OR v_role NOT IN ('imobiliaria', 'admin', 'admin_master', 'analista') THEN
      RAISE EXCEPTION 'Apenas imobiliárias e usuários autorizados podem buscar corretores.'
        USING ERRCODE = '42501';
    END IF;

    IF v_role = 'imobiliaria' AND public.current_imobiliaria_id() IS NULL THEN
      RAISE EXCEPTION 'Não foi possível identificar a imobiliária vinculada à sua conta.';
    END IF;
  END IF;

  CASE lower(trim(coalesce(p_by, '')))
    WHEN 'cpf' THEN
      v_query := public.normalize_cpf_lookup(p_query);
    WHEN 'email' THEN
      v_query := lower(trim(coalesce(p_query, '')));
      IF v_query = '' OR position('@' IN v_query) <= 1 THEN
        v_query := NULL;
      END IF;
    WHEN 'telefone' THEN
      v_query := public.normalize_br_phone_lookup(p_query);
    ELSE
      RAISE EXCEPTION 'Tipo de busca inválido. Use cpf, email ou telefone.';
  END CASE;

  IF v_query IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    corretor.id,
    profile.id,
    profile.nome,
    profile.email,
    profile.telefone,
    corretor.cpf,
    corretor.creci,
    profile.status,
    corretor.imobiliaria_id
  FROM public.corretores AS corretor
  JOIN public.profiles AS profile ON profile.id = corretor.profile_id
  WHERE profile.role::text = 'corretor'
    AND CASE lower(trim(p_by))
      WHEN 'cpf' THEN public.normalize_cpf_lookup(corretor.cpf) = v_query
      WHEN 'email' THEN lower(trim(profile.email)) = v_query
      WHEN 'telefone' THEN public.normalize_br_phone_lookup(profile.telefone) = v_query
      ELSE false
    END
  ORDER BY (profile.status = 'ativo') DESC, corretor.created_at ASC
  LIMIT 1;
END;
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
  IF v_status IS DISTINCT FROM 'ativo' THEN
    RAISE EXCEPTION 'Este corretor ainda não está ativo na plataforma.';
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

CREATE OR REPLACE FUNCTION public.unlink_my_corretor(p_corretor_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_imobiliaria_id uuid;
BEGIN
  v_imobiliaria_id := public.current_imobiliaria_id();
  IF v_imobiliaria_id IS NULL THEN
    RAISE EXCEPTION 'Não foi possível identificar a imobiliária vinculada à sua conta.';
  END IF;

  UPDATE public.corretores AS corretor
  SET
    imobiliaria_id = NULL,
    vinculado_imobiliaria = false,
    updated_at = now()
  WHERE corretor.id = p_corretor_id
    AND corretor.imobiliaria_id = v_imobiliaria_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Este corretor não está vinculado à sua imobiliária.';
  END IF;

  RETURN true;
END;
$$;

-- A busca revela dados pessoais e o vínculo altera a equipe: somente sessões
-- autenticadas podem executar essas operações. O service_role segue disponível
-- para rotinas administrativas confiáveis.
REVOKE ALL ON FUNCTION public.normalize_cpf_lookup(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.normalize_br_phone_lookup(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.find_corretor(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.link_my_corretor(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unlink_my_corretor(uuid) FROM PUBLIC, anon;
REVOKE UPDATE (imobiliaria_id, vinculado_imobiliaria, updated_at)
  ON public.corretores FROM anon;

GRANT EXECUTE ON FUNCTION public.find_corretor(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.link_my_corretor(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unlink_my_corretor(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.find_corretor(text, text) IS
  'Busca autenticada de corretor por CPF, e-mail ou telefone normalizados.';
COMMENT ON FUNCTION public.link_my_corretor(uuid) IS
  'Vincula atomicamente um corretor ativo à imobiliária da sessão autenticada.';
COMMENT ON FUNCTION public.unlink_my_corretor(uuid) IS
  'Remove atomicamente um corretor da imobiliária da sessão autenticada.';
