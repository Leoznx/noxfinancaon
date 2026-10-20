-- Keep credit simulations flowing when a confirmed Loft submission did not
-- return a proposal id. The cancellation remains isolated by tenant document;
-- only an unconfirmed preparation can still block the shared portal globally.

CREATE OR REPLACE FUNCTION public.claim_next_loft_proposal_cancellation(p_worker_id text)
RETURNS SETOF public.loft_proposal_cancellations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_job public.loft_proposal_cancellations%ROWTYPE;
  v_now timestamptz;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF length(trim(coalesce(p_worker_id, ''))) < 2 OR length(p_worker_id) > 160 THEN
    RAISE EXCEPTION 'Worker invalido.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('nox:loft-cancellation-claim', 0));
  v_now := clock_timestamp();

  SELECT * INTO v_job
  FROM public.loft_proposal_cancellations
  WHERE status IN ('scheduled', 'retry')
    AND proposal_id IS NOT NULL
    AND next_attempt_at <= v_now
    AND attempt_count < max_attempts
  ORDER BY next_attempt_at, created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1
      FROM public.loft_proposal_cancellations
      WHERE status = 'prepared'
         OR (
           status IN ('scheduled', 'retry')
           AND proposal_id IS NULL
           AND submitted_at IS NULL
         )
    ) THEN
      RAISE EXCEPTION 'A fila possui submissao sem confirmacao ou identidade exata; reconciliacao necessaria.'
        USING ERRCODE = '55000';
    END IF;
    RETURN;
  END IF;

  UPDATE public.loft_proposal_cancellations
  SET status = 'processing',
      worker_id = p_worker_id,
      lease_expires_at = v_now + interval '10 minutes',
      attempt_count = attempt_count + 1,
      updated_at = v_now
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN NEXT v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_loft_proposal_cancellation(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_next_loft_proposal_cancellation(text)
  TO service_role;

COMMENT ON FUNCTION public.claim_next_loft_proposal_cancellation(text) IS
  'Claims due cancellations with an exact id; only unconfirmed submissions require global reconciliation.';

CREATE OR REPLACE FUNCTION public.claim_next_credit_simulation(
  p_worker_id text,
  p_provider_credential_key text DEFAULT 'loft-primary'
)
RETURNS SETOF public.consultas_credito
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_config public.credit_automation_config%ROWTYPE;
  v_row public.consultas_credito%ROWTYPE;
  v_circuit_open_until timestamptz;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_worker_id, ''))) < 2 OR length(p_worker_id) > 160 THEN
    RAISE EXCEPTION 'Invalid worker id' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(coalesce(p_provider_credential_key, ''))) < 2
    OR length(p_provider_credential_key) > 160 THEN
    RAISE EXCEPTION 'Invalid provider credential key' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('nox:credit-claim:' || p_provider_credential_key, 0)
  );

  SELECT * INTO v_config
  FROM public.credit_automation_config
  WHERE config_key = 'default';

  UPDATE public.consultas_credito
  SET
    status = 'requer_verificacao',
    technical_status = 'requires_verification',
    resultado = NULL,
    mensagem = 'A consulta pode ter sido recebida pelo parceiro e precisa de conferência antes de qualquer novo envio.',
    error_message = 'Execução interrompida após o início do envio; reenvio automático bloqueado.',
    automation_step = 'requer_verificacao',
    automation_finished_at = v_now,
    worker_id = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    heartbeat_at = NULL,
    provider_submission_state = CASE
      WHEN provider_submission_state = 'not_submitted' THEN 'unknown'
      ELSE provider_submission_state
    END
  WHERE technical_status IN ('processing', 'waiting_provider')
    AND lease_expires_at <= v_now
    AND provider_submission_state IN ('submitting', 'submitted', 'unknown');

  UPDATE public.consultas_credito
  SET
    status = 'pendente',
    technical_status = 'queued',
    resultado = NULL,
    mensagem = 'A execução foi interrompida antes do envio e será retomada automaticamente.',
    error_message = NULL,
    automation_step = 'recuperada_automaticamente',
    automation_started_at = NULL,
    automation_finished_at = NULL,
    worker_id = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    heartbeat_at = NULL,
    next_attempt_at = v_now + make_interval(
      secs => least(600, v_config.retry_base_seconds * (2 ^ greatest(attempt_count - 1, 0)))
        + floor(random() * greatest(2, v_config.retry_base_seconds / 2))::integer
    )
  WHERE technical_status IN ('processing', 'waiting_provider')
    AND lease_expires_at <= v_now
    AND provider_submission_state = 'not_submitted'
    AND attempt_count < max_attempts;

  UPDATE public.consultas_credito
  SET
    status = 'erro',
    technical_status = 'technical_failure',
    resultado = NULL,
    mensagem = 'Não foi possível concluir a consulta após as tentativas seguras.',
    error_message = coalesce(error_message, 'Limite de tentativas automáticas atingido.'),
    automation_step = NULL,
    automation_finished_at = v_now,
    worker_id = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    heartbeat_at = NULL
  WHERE technical_status IN ('processing', 'waiting_provider')
    AND lease_expires_at <= v_now
    AND provider_submission_state = 'not_submitted'
    AND attempt_count >= max_attempts;

  SELECT state.circuit_open_until INTO v_circuit_open_until
  FROM public.credit_automation_provider_state AS state
  WHERE state.provider_key = p_provider_credential_key;

  IF v_circuit_open_until IS NOT NULL AND v_circuit_open_until > v_now THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.consultas_credito AS active
    WHERE active.provider_credential_key = p_provider_credential_key
      AND active.technical_status IN ('processing', 'waiting_provider')
      AND active.lease_expires_at > v_now
  ) THEN
    RETURN;
  END IF;

  SELECT consultation.* INTO v_row
  FROM public.consultas_credito AS consultation
  CROSS JOIN LATERAL (
    SELECT regexp_replace(
      coalesce(consultation.documento, consultation.tenant_document, ''),
      '\D', '', 'g'
    ) AS document_value
  ) AS consultation_document
  WHERE consultation.origem = 'nox_financa'
    AND consultation.provider_credential_key = p_provider_credential_key
    AND consultation.technical_status = 'queued'
    AND consultation.status = 'pendente'
    AND consultation.next_attempt_at <= v_now
    AND consultation.attempt_count < consultation.max_attempts
    AND NOT EXISTS (
      SELECT 1
      FROM public.loft_proposal_cancellations AS ambiguous
      JOIN public.consultas_credito AS ambiguous_consultation
        ON ambiguous_consultation.id = ambiguous.consultation_id
      CROSS JOIN LATERAL (
        SELECT regexp_replace(
          coalesce(ambiguous_consultation.documento, ambiguous_consultation.tenant_document, ''),
          '\D', '', 'g'
        ) AS document_value
      ) AS ambiguous_document
      WHERE ambiguous.status IN ('scheduled', 'retry')
        AND ambiguous.proposal_id IS NULL
        AND ambiguous.submitted_at IS NOT NULL
        AND ambiguous_document.document_value <> ''
        AND ambiguous_document.document_value = consultation_document.document_value
    )
  ORDER BY consultation.next_attempt_at, consultation.queue_enqueued_at, consultation.created_at
  FOR UPDATE OF consultation SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.consultas_credito
  SET
    status = 'processando',
    technical_status = 'processing',
    automation_step = 'abrindo',
    automation_started_at = v_now,
    automation_finished_at = NULL,
    mensagem = NULL,
    error_message = NULL,
    worker_id = p_worker_id,
    lease_token = gen_random_uuid(),
    lease_expires_at = v_now + make_interval(secs => v_config.lease_seconds),
    heartbeat_at = v_now,
    execution_version = execution_version + 1,
    attempt_count = attempt_count + 1,
    provider_submission_state = 'not_submitted',
    provider_submission_started_at = NULL
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN NEXT v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_credit_simulation(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_credit_simulation(text, text) TO service_role;

COMMENT ON FUNCTION public.claim_next_credit_simulation(text, text) IS
  'Claims the next safe simulation while isolating confirmed missing-id cancellation reconciliation to the same document.';
