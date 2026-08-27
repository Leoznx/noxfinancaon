-- Cadastro de imovel pelo proprietario autenticado.
-- Os novos encargos ficam discriminados, enquanto valor_taxas e encargos
-- continuam preenchidos para compatibilidade com os fluxos de consulta atuais.

ALTER TABLE public.imoveis
  ADD COLUMN IF NOT EXISTS tem_condominio boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS valor_fundo_reserva numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_taxa_lixo numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tem_iptu boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS valor_iptu numeric(15,2) NOT NULL DEFAULT 0;

UPDATE public.imoveis
SET tem_condominio = true
WHERE coalesce(valor_condominio, 0) > 0
  AND tem_condominio = false;

ALTER TABLE public.imoveis
  DROP CONSTRAINT IF EXISTS imoveis_valor_fundo_reserva_nonnegative,
  ADD CONSTRAINT imoveis_valor_fundo_reserva_nonnegative
    CHECK (valor_fundo_reserva >= 0),
  DROP CONSTRAINT IF EXISTS imoveis_valor_taxa_lixo_nonnegative,
  ADD CONSTRAINT imoveis_valor_taxa_lixo_nonnegative
    CHECK (valor_taxa_lixo >= 0),
  DROP CONSTRAINT IF EXISTS imoveis_valor_iptu_nonnegative,
  ADD CONSTRAINT imoveis_valor_iptu_nonnegative
    CHECK (valor_iptu >= 0);

CREATE OR REPLACE FUNCTION public.create_my_property(
  p_cep text,
  p_logradouro text,
  p_numero text,
  p_complemento text,
  p_bairro text,
  p_cidade text,
  p_estado text,
  p_valor_aluguel numeric,
  p_tem_condominio boolean,
  p_valor_condominio numeric,
  p_valor_fundo_reserva numeric,
  p_valor_taxa_lixo numeric,
  p_tem_iptu boolean,
  p_valor_iptu numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_owner_id uuid;
  v_property_id uuid;
  v_cep text := regexp_replace(coalesce(p_cep, ''), '[^0-9]', '', 'g');
  v_logradouro text := trim(coalesce(p_logradouro, ''));
  v_numero text := trim(coalesce(p_numero, ''));
  v_complemento text := nullif(trim(coalesce(p_complemento, '')), '');
  v_bairro text := trim(coalesce(p_bairro, ''));
  v_cidade text := trim(coalesce(p_cidade, ''));
  v_estado text := upper(trim(coalesce(p_estado, '')));
  v_valor_aluguel numeric := coalesce(p_valor_aluguel, 0);
  v_tem_condominio boolean := coalesce(p_tem_condominio, false);
  v_valor_condominio numeric := coalesce(p_valor_condominio, 0);
  v_valor_fundo_reserva numeric := coalesce(p_valor_fundo_reserva, 0);
  v_valor_taxa_lixo numeric := coalesce(p_valor_taxa_lixo, 0);
  v_tem_iptu boolean := coalesce(p_tem_iptu, false);
  v_valor_iptu numeric := coalesce(p_valor_iptu, 0);
  v_valor_taxas numeric;
  v_encargos numeric;
  v_endereco text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'OWNER_PROPERTY_UNAUTHENTICATED';
  END IF;

  SELECT lower(p.role::text)
  INTO v_role
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_role IS DISTINCT FROM 'proprietario' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'OWNER_PROPERTY_FORBIDDEN';
  END IF;

  SELECT prop.id
  INTO v_owner_id
  FROM public.proprietarios prop
  WHERE prop.profile_id = v_uid
  ORDER BY prop.created_at
  LIMIT 1;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OWNER_PROPERTY_OWNER_NOT_FOUND';
  END IF;

  IF length(v_cep) <> 8 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'OWNER_PROPERTY_INVALID_CEP';
  END IF;
  IF v_logradouro = '' OR v_numero = '' OR v_bairro = '' OR v_cidade = '' OR length(v_estado) <> 2 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'OWNER_PROPERTY_INVALID_ADDRESS';
  END IF;
  IF v_valor_aluguel <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'OWNER_PROPERTY_INVALID_RENT';
  END IF;
  IF v_valor_condominio < 0 OR v_valor_fundo_reserva < 0 OR v_valor_taxa_lixo < 0 OR v_valor_iptu < 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'OWNER_PROPERTY_INVALID_FEES';
  END IF;
  IF v_tem_condominio AND v_valor_condominio <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'OWNER_PROPERTY_INVALID_CONDOMINIUM';
  END IF;
  IF v_tem_iptu AND v_valor_iptu <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'OWNER_PROPERTY_INVALID_IPTU';
  END IF;

  IF NOT v_tem_condominio THEN
    v_valor_condominio := 0;
    v_valor_fundo_reserva := 0;
    v_valor_taxa_lixo := 0;
  END IF;
  IF NOT v_tem_iptu THEN
    v_valor_iptu := 0;
  END IF;

  v_valor_taxas := v_valor_fundo_reserva + v_valor_taxa_lixo + v_valor_iptu;
  v_encargos := v_valor_condominio + v_valor_taxas;
  v_endereco := concat_ws(', ', v_logradouro, v_numero, v_complemento)
    || ' - ' || v_bairro || ', ' || v_cidade || '/' || v_estado
    || ' - CEP ' || substring(v_cep from 1 for 5) || '-' || substring(v_cep from 6 for 3);

  INSERT INTO public.imoveis (
    proprietario_id,
    endereco,
    tipo,
    valor_aluguel,
    encargos,
    logradouro,
    numero,
    complemento,
    bairro,
    cidade,
    estado,
    cep,
    valor_condominio,
    valor_taxas,
    tem_condominio,
    valor_fundo_reserva,
    valor_taxa_lixo,
    tem_iptu,
    valor_iptu
  ) VALUES (
    v_owner_id,
    v_endereco,
    'residencial',
    v_valor_aluguel,
    v_encargos,
    v_logradouro,
    v_numero,
    v_complemento,
    v_bairro,
    v_cidade,
    v_estado,
    v_cep,
    v_valor_condominio,
    v_valor_taxas,
    v_tem_condominio,
    v_valor_fundo_reserva,
    v_valor_taxa_lixo,
    v_tem_iptu,
    v_valor_iptu
  )
  RETURNING id INTO v_property_id;

  RETURN v_property_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_my_property(
  text, text, text, text, text, text, text, numeric, boolean, numeric, numeric, numeric, boolean, numeric
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_my_property(
  text, text, text, text, text, text, text, numeric, boolean, numeric, numeric, numeric, boolean, numeric
) TO authenticated, service_role;

COMMENT ON FUNCTION public.create_my_property(
  text, text, text, text, text, text, text, numeric, boolean, numeric, numeric, numeric, boolean, numeric
) IS 'Cadastra um imovel no patrimonio do proprietario autenticado e mantem os encargos discriminados.';
