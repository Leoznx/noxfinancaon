-- Direct Data's cadastral endpoint can return HTTP 200 with resultadoId = 6
-- when a valid CPF/CNPJ is absent from its base. This is a terminal lookup
-- failure, not an ambiguous credit decision. Keep the paid identity lookup
-- auditable, do not run Score, and do not allow a retry to charge it again.

ALTER TABLE public.directd_credit_requests
  DROP CONSTRAINT IF EXISTS directd_credit_requests_identity_status_check;

ALTER TABLE public.directd_credit_requests
  ADD CONSTRAINT directd_credit_requests_identity_status_check
  CHECK (
    identity_status IS NULL OR identity_status IN (
      'submitting', 'succeeded', 'failed_no_charge', 'failed_billed', 'requires_verification'
    )
  );

UPDATE public.directd_credit_requests AS request
SET
  identity_status = 'failed_billed',
  identity_error_code = 'DIRECTD_IDENTITY_NOT_FOUND',
  status = 'failed_no_charge',
  error_code = 'DIRECTD_IDENTITY_NOT_FOUND',
  completed_at = coalesce(completed_at, identity_completed_at, clock_timestamp()),
  updated_at = clock_timestamp()
WHERE request.identity_customer_name IS NULL
  AND request.identity_billed_cents IS NOT NULL
  AND (
    request.identity_response #>> '{metaDados,resultadoId}' = '6'
    OR lower(coalesce(request.identity_response #>> '{metaDados,resultado}', '')) LIKE '%não encontrad%'
    OR lower(coalesce(request.identity_response #>> '{metaDados,resultado}', '')) LIKE '%nao encontrad%'
    OR lower(coalesce(request.identity_response #>> '{metaDados,mensagem}', '')) LIKE '%não encontrad%'
    OR lower(coalesce(request.identity_response #>> '{metaDados,mensagem}', '')) LIKE '%nao encontrad%'
  );

WITH not_found_documents AS (
  SELECT DISTINCT
    regexp_replace(coalesce(consultation.tenant_document, consultation.documento, ''), '\D', '', 'g')
      AS document
  FROM public.consultas_credito AS consultation
  JOIN public.directd_credit_requests AS request
    ON request.consultation_id = consultation.id
  WHERE request.identity_status = 'failed_billed'
    AND request.identity_error_code = 'DIRECTD_IDENTITY_NOT_FOUND'
)
UPDATE public.consultas_credito AS consultation
SET
  status = 'erro',
  resultado = NULL,
  technical_status = 'technical_failure',
  provider_submission_state = 'not_submitted',
  mensagem = CASE
    WHEN length(regexp_replace(coalesce(consultation.tenant_document, consultation.documento, ''), '\D', '', 'g')) = 14
      THEN 'CNPJ não localizado na base cadastral. Confira o documento antes de tentar novamente.'
    ELSE 'CPF não localizado na base cadastral. Confira o documento antes de tentar novamente.'
  END,
  error_message = 'DIRECTD_IDENTITY_NOT_FOUND',
  automation_step = NULL,
  automation_finished_at = coalesce(consultation.automation_finished_at, clock_timestamp()),
  worker_id = NULL,
  lease_token = NULL,
  lease_expires_at = NULL,
  heartbeat_at = NULL,
  last_error_category = 'DIRECTD_IDENTITY_NOT_FOUND',
  updated_at = clock_timestamp()
FROM not_found_documents
WHERE not_found_documents.document <> ''
  AND regexp_replace(coalesce(consultation.tenant_document, consultation.documento, ''), '\D', '', 'g') =
    not_found_documents.document
  AND public.normalize_official_credit_customer_name(consultation.tenant_name) IS NULL
  AND consultation.origem = 'nox_financa'
  AND consultation.technical_status IN ('technical_failure', 'requires_verification');

COMMENT ON COLUMN public.directd_credit_requests.identity_status IS
  'Cadastral lookup state. failed_billed is terminal: the provider charged the lookup but did not find the document.';
