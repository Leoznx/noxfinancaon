-- Make the NOX score thresholds authoritative and prevent any new official
-- credit simulation from being created without a real customer identity.

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

  IF v_valid_name IS NULL THEN
    RAISE EXCEPTION 'Nome completo ou razão social é obrigatório.' USING ERRCODE = '22023';
  END IF;

  SELECT enabled INTO v_enabled
  FROM public.credit_api_provider_config
  WHERE provider_key = 'directd-quod';

  IF coalesce(v_enabled, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Official credit provider is disabled' USING ERRCODE = 'P0001';
  END IF;

  v_id := public.enqueue_credit_simulation(
    p_tenant_type, v_valid_name, p_tenant_document, p_property_type,
    p_property_zip, p_property_city, p_property_state, p_property_address,
    p_rent_value, p_condominium_value, p_fee_value, p_operational_zip,
    p_correlation_id, p_idempotency_key
  );

  UPDATE public.consultas_credito
  SET
    tenant_name = v_valid_name,
    provider_credential_key = 'directd-quod',
    external_provider = 'directd_quod',
    automacao_origem = 'api_oficial',
    max_attempts = 1,
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
    AND consultation.profile_id_solicitante = v_caller
    AND consultation.inquilino_id = tenant.id
    AND public.normalize_official_credit_customer_name(tenant.nome) IS NULL;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_official_credit_simulation(
  text, text, text, text, text, text, text, text, numeric, numeric, numeric, text, text, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_official_credit_simulation(
  text, text, text, text, text, text, text, text, numeric, numeric, numeric, text, text, uuid
) TO authenticated, service_role;

-- Reapply the non-inventive name recovery so legacy rows created after the
-- previous migration can use a later real name supplied for the same document.
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

-- Reclassify every already-paid official response with the same rule that will
-- be used by the Edge Function. This repairs historical decisions in the two
-- ranges whose meaning changed (541-600 and 651-700) without another API call.
WITH scored AS (
  SELECT
    request.consultation_id,
    request.score,
    CASE
      WHEN request.score BETWEEN 0 AND 540 THEN 'recusado'
      WHEN request.score BETWEEN 541 AND 650 THEN 'em_analise'
      WHEN request.score BETWEEN 651 AND 1000 THEN 'aprovado'
    END AS decision,
    CASE
      WHEN request.score BETWEEN 0 AND 540 THEN 'Alto índice de inadimplência'
      WHEN request.score BETWEEN 541 AND 650 THEN 'Médio índice de inadimplência'
      WHEN request.score BETWEEN 651 AND 1000 THEN 'Baixo índice de inadimplência'
    END AS score_band,
    CASE
      WHEN request.score BETWEEN 0 AND 540 THEN 'Crédito reprovado pela análise oficial de risco.'
      WHEN request.score BETWEEN 541 AND 650 THEN 'Análise pendente. Envie o comprovante de renda para continuar.'
      WHEN request.score BETWEEN 651 AND 1000 THEN 'Crédito aprovado pela análise oficial de risco.'
    END AS message
  FROM public.directd_credit_requests AS request
  WHERE request.status = 'succeeded'
    AND request.provider_http_status = 200
    AND request.billed_cents IS NOT NULL
    AND request.score BETWEEN 0 AND 1000
)
UPDATE public.consultas_credito AS consultation
SET status = scored.decision,
    resultado = scored.decision,
    substatus = CASE WHEN scored.decision = 'em_analise' THEN consultation.substatus ELSE NULL END,
    technical_status = 'completed',
    provider_submission_state = 'confirmed',
    automation_step = NULL,
    mensagem = scored.message,
    error_message = NULL,
    last_error_category = NULL,
    external_provider = 'directd_quod',
    external_status = scored.score_band,
    automacao_credpago_status = scored.decision,
    automacao_credpago_resultado = coalesce(consultation.automacao_credpago_resultado, '{}'::jsonb)
      || jsonb_build_object(
        'status', scored.decision,
        'statusOriginal', scored.score_band,
        'score', scored.score,
        'regraScore', '0-540 recusado; 541-650 em_analise; 651-1000 aprovado',
        'reclassificadoEm', clock_timestamp()
      ),
    updated_at = clock_timestamp()
FROM scored
WHERE consultation.id = scored.consultation_id;

UPDATE public.directd_credit_requests AS request
SET decision = CASE
      WHEN request.score BETWEEN 0 AND 540 THEN 'recusado'
      WHEN request.score BETWEEN 541 AND 650 THEN 'em_analise'
      WHEN request.score BETWEEN 651 AND 1000 THEN 'aprovado'
    END,
    score_band = CASE
      WHEN request.score BETWEEN 0 AND 540 THEN 'Alto índice de inadimplência'
      WHEN request.score BETWEEN 541 AND 650 THEN 'Médio índice de inadimplência'
      WHEN request.score BETWEEN 651 AND 1000 THEN 'Baixo índice de inadimplência'
    END,
    updated_at = clock_timestamp()
WHERE request.status = 'succeeded'
  AND request.provider_http_status = 200
  AND request.billed_cents IS NOT NULL
  AND request.score BETWEEN 0 AND 1000;

-- A cached pre-API client created one legacy queue item after the Loft worker
-- had been disabled. If a later paid official result exists for the same user
-- and document, finish that stale row from the real result instead of leaving
-- it forever as "Consultando" or triggering a second paid request.
WITH later_official_result AS (
  SELECT DISTINCT ON (stale.id)
    stale.id AS stale_id,
    completed.id AS source_id,
    public.normalize_official_credit_customer_name(completed.tenant_name) AS customer_name,
    request.score,
    request.decision,
    request.score_band
  FROM public.consultas_credito AS stale
  JOIN public.consultas_credito AS completed
    ON completed.profile_id_solicitante = stale.profile_id_solicitante
   AND regexp_replace(coalesce(completed.tenant_document, completed.documento, ''), '\D', '', 'g')
       = regexp_replace(coalesce(stale.tenant_document, stale.documento, ''), '\D', '', 'g')
   AND completed.created_at > stale.created_at
  JOIN public.directd_credit_requests AS request
    ON request.consultation_id = completed.id
   AND request.status = 'succeeded'
   AND request.provider_http_status = 200
   AND request.billed_cents IS NOT NULL
   AND request.decision IN ('aprovado', 'recusado', 'em_analise')
  WHERE stale.status = 'pendente'
    AND stale.technical_status = 'queued'
    AND stale.provider_submission_state = 'not_submitted'
    AND stale.provider_credential_key = 'loft-primary'
    AND stale.created_at >= timestamptz '2026-10-22 00:00:00-03'
    AND public.normalize_official_credit_customer_name(completed.tenant_name) IS NOT NULL
  ORDER BY stale.id, completed.created_at DESC
)
UPDATE public.consultas_credito AS stale
SET tenant_name = source.customer_name,
    status = source.decision,
    resultado = source.decision,
    substatus = NULL,
    technical_status = 'completed',
    automation_step = NULL,
    mensagem = CASE
      WHEN source.decision = 'recusado' THEN 'Crédito reprovado pela análise oficial de risco.'
      WHEN source.decision = 'em_analise' THEN 'Análise pendente. Envie o comprovante de renda para continuar.'
      ELSE 'Crédito aprovado pela análise oficial de risco.'
    END,
    error_message = NULL,
    automacao_credpago_status = source.decision,
    automacao_credpago_resultado = jsonb_build_object(
      'status', source.decision,
      'statusOriginal', source.score_band,
      'score', source.score,
      'origem', 'conciliacao_mesmo_documento',
      'consultaFonte', source.source_id,
      'registradoEm', clock_timestamp()
    ),
    automation_finished_at = clock_timestamp(),
    automacao_processed_at = clock_timestamp(),
    updated_at = clock_timestamp()
FROM later_official_result AS source
WHERE stale.id = source.stale_id;

