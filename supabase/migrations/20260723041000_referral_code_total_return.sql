-- A saída de segurança torna explícito para o analisador do PostgreSQL que a
-- função sempre retorna texto, mesmo que o LOOP seja alterado no futuro.
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
    EXIT WHEN v_attempt > 10;
  END LOOP;

  RETURN 'NOX-' || encode(extensions.gen_random_bytes(5), 'hex');
END;
$$;
