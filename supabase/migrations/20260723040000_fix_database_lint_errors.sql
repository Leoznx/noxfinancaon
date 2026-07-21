-- Remove a RPC legada que ficou inválida quando niveis_comissao foi substituída
-- por niveis_perfil. O frontend atual calcula o nível por niveis_perfil e não usa
-- mais esta função.
DROP FUNCTION IF EXISTS public.get_nivel_corretor_info(uuid);

-- O projeto instala pgcrypto no schema extensions. Qualificar a função evita que
-- a geração de códigos dependa do search_path restrito da SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.generate_referral_code(_profile_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_base text;
  v_code text;
  v_suffix text;
  v_attempt integer := 0;
BEGIN
  SELECT regexp_replace(upper(coalesce(split_part(nome, ' ', 1), 'USER')), '[^A-Z0-9]', '', 'g')
    INTO v_base
  FROM public.profiles
  WHERE id = _profile_id;

  IF v_base IS NULL OR length(v_base) = 0 THEN
    v_base := 'USER';
  END IF;
  v_base := substr(v_base, 1, 10);

  LOOP
    v_suffix := upper(substr(encode(extensions.gen_random_bytes(3), 'hex'), 1, 4));
    v_code := 'NOX-' || v_base || '-' || v_suffix;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = v_code) THEN
      RETURN v_code;
    END IF;

    v_attempt := v_attempt + 1;
    IF v_attempt > 10 THEN
      RETURN 'NOX-' || encode(extensions.gen_random_bytes(5), 'hex');
    END IF;
  END LOOP;
END;
$$;

-- As variáveis dos FOR são declaradas automaticamente pelo PL/pgSQL; retirar a
-- declaração duplicada elimina shadowing e mantém exatamente a mesma validação.
CREATE OR REPLACE FUNCTION public.is_valid_cpf(_value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  v text := regexp_replace(coalesce(_value, ''), '\D', '', 'g');
  total integer;
  digit integer;
BEGIN
  IF length(v) <> 11 OR v ~ '^(\d)\1{10}$' THEN RETURN false; END IF;

  total := 0;
  FOR i IN 1..9 LOOP total := total + substr(v, i, 1)::integer * (11 - i); END LOOP;
  digit := (total * 10) % 11;
  IF digit = 10 THEN digit := 0; END IF;
  IF digit <> substr(v, 10, 1)::integer THEN RETURN false; END IF;

  total := 0;
  FOR i IN 1..10 LOOP total := total + substr(v, i, 1)::integer * (12 - i); END LOOP;
  digit := (total * 10) % 11;
  IF digit = 10 THEN digit := 0; END IF;
  RETURN digit = substr(v, 11, 1)::integer;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_valid_cnpj(_value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  v text := regexp_replace(coalesce(_value, ''), '\D', '', 'g');
  weights1 integer[] := ARRAY[5,4,3,2,9,8,7,6,5,4,3,2];
  weights2 integer[] := ARRAY[6,5,4,3,2,9,8,7,6,5,4,3,2];
  total integer := 0;
  remainder integer;
  digit integer;
BEGIN
  IF length(v) <> 14 OR v ~ '^(\d)\1{13}$' THEN RETURN false; END IF;

  FOR i IN 1..12 LOOP total := total + substr(v, i, 1)::integer * weights1[i]; END LOOP;
  remainder := total % 11;
  digit := CASE WHEN remainder < 2 THEN 0 ELSE 11 - remainder END;
  IF digit <> substr(v, 13, 1)::integer THEN RETURN false; END IF;

  total := 0;
  FOR i IN 1..13 LOOP total := total + substr(v, i, 1)::integer * weights2[i]; END LOOP;
  remainder := total % 11;
  digit := CASE WHEN remainder < 2 THEN 0 ELSE 11 - remainder END;
  RETURN digit = substr(v, 14, 1)::integer;
END;
$$;
