-- Preserve the customer name entered in every new official simulation and
-- reconcile paid QUOD HTTP 200 responses that an older parser left quarantined.

CREATE OR REPLACE FUNCTION public.normalize_official_credit_customer_name(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  normalized text;
BEGIN
  normalized := btrim(
    regexp_replace(replace(coalesce(p_value, ''), chr(160), ' '), '\s+', ' ', 'g'),
    E' \t\n\r:;|,.-'
  );

  IF char_length(normalized) < 2
    OR char_length(normalized) > 120
    OR normalized ~ '[0-9]'
    OR normalized !~ '[[:alpha:]]'
    OR normalized ~* '\m(cpf|cnpj|cliente|inquilin[oa]|locat[aá]ri[oa]|proponente|nome|resultado|an[aá]lise|cr[eé]dito|aprovad[oa]|recusad[oa]|valor|aluguel|simula[cç][aã]o|pendente|dados)\M'
  THEN
    RETURN NULL;
  END IF;

  RETURN normalized;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_official_credit_customer_name(text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_official_credit_simulation(
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
  p_correlation_id text,
  p_idempotency_key uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_id uuid;
  v_enabled boolean;
  v_valid_name text := public.normalize_official_credit_customer_name(p_tenant_name);
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT enabled INTO v_enabled
  FROM public.credit_api_provider_config
  WHERE provider_key = 'directd-quod';

  IF coalesce(v_enabled, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Official credit provider is disabled' USING ERRCODE = 'P0001';
  END IF;

  v_id := public.enqueue_credit_simulation(
    p_tenant_type, p_tenant_name, p_tenant_document, p_property_type,
    p_property_zip, p_property_city, p_property_state, p_property_address,
    p_rent_value, p_condominium_value, p_fee_value, p_operational_zip,
    p_correlation_id, p_idempotency_key
  );

  UPDATE public.consultas_credito
  SET
    provider_credential_key = 'directd-quod',
    external_provider = 'directd_quod',
    automacao_origem = 'api_oficial',
    max_attempts = 1,
    updated_at = clock_timestamp()
  WHERE id = v_id
    AND profile_id_solicitante = v_caller
    AND technical_status = 'queued'
    AND provider_submission_state = 'not_submitted';

  -- Never replace a real name with a CPF/CNPJ placeholder. A newly supplied
  -- valid name repairs the shared tenant record as well as the consultation.
  IF v_valid_name IS NOT NULL THEN
    UPDATE public.consultas_credito
    SET tenant_name = v_valid_name,
        updated_at = clock_timestamp()
    WHERE id = v_id
      AND profile_id_solicitante = v_caller;

    UPDATE public.inquilinos AS tenant
    SET nome = v_valid_name,
        razao_social = CASE
          WHEN upper(coalesce(p_tenant_type, '')) = 'PJ' THEN v_valid_name
          ELSE tenant.razao_social
        END,
        updated_at = clock_timestamp()
    FROM public.consultas_credito AS consultation
    WHERE consultation.id = v_id
      AND consultation.inquilino_id = tenant.id
      AND public.normalize_official_credit_customer_name(tenant.nome) IS NULL;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_official_credit_simulation(
  text, text, text, text, text, text, text, text, numeric, numeric, numeric, text, text, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_official_credit_simulation(
  text, text, text, text, text, text, text, text, numeric, numeric, numeric, text, text, uuid
) TO authenticated, service_role;

-- Recover names from earlier consultations of the same CPF/CNPJ. This repairs
-- rows created after the API migration without inventing data.
WITH valid_names AS (
  SELECT DISTINCT ON (regexp_replace(coalesce(tenant_document, documento, ''), '\D', '', 'g'))
    regexp_replace(coalesce(tenant_document, documento, ''), '\D', '', 'g') AS document,
    public.normalize_official_credit_customer_name(tenant_name) AS customer_name
  FROM public.consultas_credito
  WHERE public.normalize_official_credit_customer_name(tenant_name) IS NOT NULL
  ORDER BY regexp_replace(coalesce(tenant_document, documento, ''), '\D', '', 'g'), updated_at DESC
)
UPDATE public.consultas_credito AS consultation
SET tenant_name = names.customer_name,
    updated_at = clock_timestamp()
FROM valid_names AS names
WHERE regexp_replace(coalesce(consultation.tenant_document, consultation.documento, ''), '\D', '', 'g') = names.document
  AND public.normalize_official_credit_customer_name(consultation.tenant_name) IS NULL;

WITH valid_names AS (
  SELECT DISTINCT ON (regexp_replace(coalesce(tenant_document, documento, ''), '\D', '', 'g'))
    regexp_replace(coalesce(tenant_document, documento, ''), '\D', '', 'g') AS document,
    public.normalize_official_credit_customer_name(tenant_name) AS customer_name
  FROM public.consultas_credito
  WHERE public.normalize_official_credit_customer_name(tenant_name) IS NOT NULL
  ORDER BY regexp_replace(coalesce(tenant_document, documento, ''), '\D', '', 'g'), updated_at DESC
)
UPDATE public.inquilinos AS tenant
SET nome = names.customer_name,
    updated_at = clock_timestamp()
FROM valid_names AS names
WHERE regexp_replace(coalesce(tenant.cnpj, tenant.cpf, ''), '\D', '', 'g') = names.document
  AND public.normalize_official_credit_customer_name(tenant.nome) IS NULL;

-- Older versions treated an unrecognized/missing score label as an endless
-- technical wait even though the provider had already returned HTTP 200 and
-- charged the request. The honest terminal state is complementary analysis.
UPDATE public.consultas_credito AS consultation
SET status = 'em_analise',
    resultado = 'em_analise',
    technical_status = 'completed',
    provider_submission_state = 'confirmed',
    automation_step = NULL,
    mensagem = 'A análise oficial precisa de conferência complementar.',
    error_message = NULL,
    last_error_category = NULL,
    external_provider = 'directd_quod',
    external_status = 'Faixa não informada',
    automacao_credpago_status = 'em_analise',
    automacao_credpago_resultado = jsonb_build_object(
      'status', 'em_analise',
      'statusOriginal', 'Faixa não informada',
      'score', request.score,
      'protocolo', request.provider_consulta_uid,
      'origem', 'api_oficial',
      'reconciliadoEm', clock_timestamp()
    ),
    automation_finished_at = coalesce(consultation.automation_finished_at, request.completed_at, clock_timestamp()),
    provider_returned_at = coalesce(consultation.provider_returned_at, request.completed_at, clock_timestamp()),
    automacao_processed_at = clock_timestamp(),
    updated_at = clock_timestamp()
FROM public.directd_credit_requests AS request
WHERE request.consultation_id = consultation.id
  AND consultation.provider_credential_key = 'directd-quod'
  AND consultation.technical_status = 'requires_verification'
  AND consultation.error_message = 'DIRECTD_UNKNOWN_SCORE_RANGE'
  AND request.provider_http_status = 200
  AND request.billed_cents IS NOT NULL;

UPDATE public.directd_credit_requests
SET status = 'succeeded',
    decision = 'em_analise',
    score_band = coalesce(nullif(score_band, ''), 'Faixa não informada'),
    error_code = 'DIRECTD_UNKNOWN_SCORE_RANGE_RECONCILED',
    completed_at = coalesce(completed_at, clock_timestamp()),
    updated_at = clock_timestamp()
WHERE status = 'requires_verification'
  AND error_code = 'DIRECTD_UNKNOWN_SCORE_RANGE'
  AND provider_http_status = 200
  AND billed_cents IS NOT NULL;
