-- A Direct Data documenta HTTP 500 como falha ao processar a consulta. Quando
-- não existe consultaUid nem débito confirmado, a operação pode ser repetida
-- com segurança. Mantemos a identificação cadastral já paga no ledger para que
-- o retry execute somente o produto Score QUOD.

UPDATE public.consultas_credito AS consultation
SET
  status = 'erro',
  resultado = NULL,
  technical_status = 'technical_failure',
  provider_submission_state = 'not_submitted',
  mensagem = 'O provedor de score ficou temporariamente indisponível. Tente novamente.',
  automation_step = NULL,
  worker_id = NULL,
  lease_token = NULL,
  lease_expires_at = NULL,
  heartbeat_at = NULL,
  updated_at = clock_timestamp()
FROM public.directd_credit_requests AS request
WHERE request.consultation_id = consultation.id
  AND consultation.provider_credential_key = 'directd-quod'
  AND consultation.technical_status = 'requires_verification'
  AND consultation.provider_submission_state = 'unknown'
  AND consultation.last_error_category = 'DIRECTD_HTTP_500'
  AND request.status = 'requires_verification'
  AND request.provider_http_status = 500
  AND request.provider_consulta_uid IS NULL
  AND request.billed_cents IS NULL;
UPDATE public.directd_credit_requests AS request
SET
  status = 'failed_no_charge',
  updated_at = clock_timestamp()
FROM public.consultas_credito AS consultation
WHERE consultation.id = request.consultation_id
  AND consultation.provider_credential_key = 'directd-quod'
  AND consultation.technical_status = 'technical_failure'
  AND consultation.provider_submission_state = 'not_submitted'
  AND consultation.last_error_category = 'DIRECTD_HTTP_500'
  AND request.status = 'requires_verification'
  AND request.provider_http_status = 500
  AND request.provider_consulta_uid IS NULL
  AND request.billed_cents IS NULL;
