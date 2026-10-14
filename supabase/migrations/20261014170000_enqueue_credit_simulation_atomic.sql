-- A criação de uma simulação fazia de 6 a 8 chamadas HTTP sequenciais do
-- navegador ao Supabase (sessão, perfil, consulta, inquilino, imóvel e fila).
-- Esta RPC preserva os mesmos vínculos e validações em uma única transação,
-- deixando a consulta visível ao worker somente quando o payload está completo.

CREATE OR REPLACE FUNCTION public.enqueue_credit_simulation(
  p_tenant_type text,
  p_tenant_name text,
  p_tenant_document text,
  p_property_type text,
  p_property_zip text,
  p_property_city text,
  p_property_state text,
  p_property_address text,
  p_rent_value numeric,
  p_condominium_value numeric,
  p_fee_value numeric,
  p_operational_zip text,
  p_correlation_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_document text := regexp_replace(coalesce(p_tenant_document, ''), '\D', '', 'g');
  v_tenant_type text := upper(coalesce(p_tenant_type, ''));
  v_property_type text := initcap(lower(coalesce(p_property_type, '')));
  v_operational_zip text := regexp_replace(coalesce(p_operational_zip, ''), '\D', '', 'g');
  v_tenant_name text := nullif(btrim(p_tenant_name), '');
  v_role text;
  v_tenant_id uuid;
  v_property_id uuid;
  v_consultation public.consultas_credito%ROWTYPE;
  v_consultation_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF v_tenant_type NOT IN ('PF', 'PJ') THEN
    RAISE EXCEPTION 'Invalid tenant type' USING ERRCODE = '22023';
  END IF;
  IF (v_tenant_type = 'PF' AND length(v_document) <> 11)
    OR (v_tenant_type = 'PJ' AND length(v_document) <> 14) THEN
    RAISE EXCEPTION 'Invalid tenant document' USING ERRCODE = '22023';
  END IF;
  IF v_property_type NOT IN ('Residencial', 'Comercial') THEN
    RAISE EXCEPTION 'Invalid property type' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_rent_value, 0) <= 0 THEN
    RAISE EXCEPTION 'Invalid rent value' USING ERRCODE = '22023';
  END IF;
  IF length(v_operational_zip) <> 8 THEN
    RAISE EXCEPTION 'Invalid operational zip code' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_correlation_id, '') !~ '^NOX-SIM-[0-9]{8}-[A-F0-9]{8}$' THEN
    RAISE EXCEPTION 'Invalid correlation id' USING ERRCODE = '22023';
  END IF;

  -- Serializa apenas o mesmo usuário/documento. Evita imóvel órfão e duas
  -- execuções quando duas abas enviarem o mesmo formulário simultaneamente.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_caller::text || ':' || v_document, 0));

  SELECT consultation.*
    INTO v_consultation
  FROM public.consultas_credito AS consultation
  WHERE consultation.profile_id_solicitante = v_caller
    AND consultation.tenant_document = v_document
  ORDER BY consultation.updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_consultation.id IS NOT NULL
    AND (
      v_consultation.status = 'processando'
      OR (v_consultation.status = 'pendente' AND v_consultation.origem = 'nox_financa')
    ) THEN
    RETURN v_consultation.id;
  END IF;

  SELECT profile.role::text
    INTO v_role
  FROM public.profiles AS profile
  WHERE profile.id = v_caller;

  v_tenant_id := v_consultation.inquilino_id;
  IF v_tenant_id IS NULL THEN
    v_tenant_id := public.resolve_consultation_tenant(
      v_document,
      v_tenant_type,
      coalesce(v_tenant_name, v_document)
    );
  ELSIF v_tenant_name IS NOT NULL THEN
    UPDATE public.inquilinos
    SET nome = v_tenant_name
    WHERE id = v_tenant_id;
  END IF;

  v_property_id := v_consultation.imovel_id;
  IF v_property_id IS NULL THEN
    INSERT INTO public.imoveis (
      cep,
      cidade,
      estado,
      endereco,
      tipo,
      valor_aluguel,
      valor_condominio,
      valor_taxas
    )
    VALUES (
      nullif(btrim(p_property_zip), ''),
      coalesce(p_property_city, ''),
      coalesce(p_property_state, ''),
      nullif(btrim(p_property_address), ''),
      v_property_type,
      p_rent_value,
      coalesce(p_condominium_value, 0),
      coalesce(p_fee_value, 0)
    )
    RETURNING id INTO v_property_id;
  ELSE
    UPDATE public.imoveis
    SET
      cep = nullif(btrim(p_property_zip), ''),
      cidade = coalesce(p_property_city, ''),
      estado = coalesce(p_property_state, ''),
      endereco = nullif(btrim(p_property_address), ''),
      tipo = v_property_type,
      valor_aluguel = p_rent_value,
      valor_condominio = coalesce(p_condominium_value, 0),
      valor_taxas = coalesce(p_fee_value, 0)
    WHERE id = v_property_id;
  END IF;

  IF v_consultation.id IS NULL THEN
    INSERT INTO public.consultas_credito (
      correlation_id,
      inquilino_id,
      imovel_id,
      profile_id_solicitante,
      role_solicitante,
      tenant_name,
      tenant_document,
      tenant_type,
      property_address,
      rent_value,
      tipo_pessoa,
      documento,
      documento_masked,
      tipo_imovel,
      cep,
      imovel_cep,
      imovel_cidade,
      imovel_estado,
      imovel_endereco,
      valor_aluguel,
      valor_condominio,
      valor_taxas,
      status,
      origem
    )
    VALUES (
      p_correlation_id,
      v_tenant_id,
      v_property_id,
      v_caller,
      v_role,
      coalesce(v_tenant_name, v_document),
      v_document,
      v_tenant_type,
      nullif(btrim(p_property_address), ''),
      p_rent_value,
      v_tenant_type,
      v_document,
      CASE
        WHEN v_tenant_type = 'PF' THEN substr(v_document, 1, 3) || '.***.***-' || right(v_document, 2)
        ELSE substr(v_document, 1, 2) || '.***.***/****-' || right(v_document, 2)
      END,
      v_property_type,
      v_operational_zip,
      nullif(btrim(p_property_zip), ''),
      p_property_city,
      p_property_state,
      nullif(btrim(p_property_address), ''),
      p_rent_value,
      coalesce(p_condominium_value, 0),
      coalesce(p_fee_value, 0),
      'pendente',
      'nox_financa'
    )
    RETURNING id INTO v_consultation_id;
  ELSE
    UPDATE public.consultas_credito
    SET
      correlation_id = p_correlation_id,
      inquilino_id = v_tenant_id,
      imovel_id = v_property_id,
      role_solicitante = v_role,
      tenant_name = coalesce(v_tenant_name, nullif(v_consultation.tenant_name, ''), v_document),
      tenant_type = v_tenant_type,
      property_address = nullif(btrim(p_property_address), ''),
      rent_value = p_rent_value,
      tipo_pessoa = v_tenant_type,
      documento = v_document,
      documento_masked = CASE
        WHEN v_tenant_type = 'PF' THEN substr(v_document, 1, 3) || '.***.***-' || right(v_document, 2)
        ELSE substr(v_document, 1, 2) || '.***.***/****-' || right(v_document, 2)
      END,
      tipo_imovel = v_property_type,
      cep = v_operational_zip,
      imovel_cep = nullif(btrim(p_property_zip), ''),
      imovel_cidade = p_property_city,
      imovel_estado = p_property_state,
      imovel_endereco = nullif(btrim(p_property_address), ''),
      valor_aluguel = p_rent_value,
      valor_condominio = coalesce(p_condominium_value, 0),
      valor_taxas = coalesce(p_fee_value, 0),
      status = 'pendente',
      origem = 'nox_financa',
      resultado = NULL,
      mensagem = NULL,
      error_message = NULL,
      automacao_origem = NULL,
      automation_started_at = NULL,
      automation_finished_at = NULL,
      automation_step = NULL,
      raw_response = NULL
    WHERE id = v_consultation.id
    RETURNING id INTO v_consultation_id;
  END IF;

  RETURN v_consultation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_credit_simulation(
  text, text, text, text, text, text, text, text, numeric, numeric, numeric, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_credit_simulation(
  text, text, text, text, text, text, text, text, numeric, numeric, numeric, text, text
) FROM anon;
GRANT EXECUTE ON FUNCTION public.enqueue_credit_simulation(
  text, text, text, text, text, text, text, text, numeric, numeric, numeric, text, text
) TO authenticated, service_role;

COMMENT ON FUNCTION public.enqueue_credit_simulation(
  text, text, text, text, text, text, text, text, numeric, numeric, numeric, text, text
) IS 'Creates or refreshes one authenticated credit simulation and queues it atomically.';
