-- Reuse the latest completed QUOD decision for the same CPF/CNPJ. The score
-- product is document-based, so property and rent changes must not trigger a
-- second paid request after a real decision has already been recorded.

ALTER TABLE public.directd_credit_requests
  ADD COLUMN IF NOT EXISTS reused_from_consultation_id uuid
    REFERENCES public.consultas_credito(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reused_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_consultas_credito_official_result_by_document
  ON public.consultas_credito(documento, updated_at DESC)
  WHERE provider_credential_key = 'directd-quod'
    AND technical_status = 'completed'
    AND resultado IN ('aprovado', 'recusado', 'em_analise');

CREATE INDEX IF NOT EXISTS idx_directd_credit_requests_reused_from
  ON public.directd_credit_requests(reused_from_consultation_id)
  WHERE reused_from_consultation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_official_credit_simulation(
  p_consultation_id uuid,
  p_worker_id text
)
RETURNS SETOF public.consultas_credito
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.consultas_credito%ROWTYPE;
  v_source public.consultas_credito%ROWTYPE;
  v_request public.directd_credit_requests%ROWTYPE;
  v_source_request public.directd_credit_requests%ROWTYPE;
  v_enabled boolean;
  v_document text;
  v_source_name text;
  v_source_root_id uuid;
  v_cached_response jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_worker_id, ''))) < 2 OR length(p_worker_id) > 160 THEN
    RAISE EXCEPTION 'Invalid worker id' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('nox:directd:' || p_consultation_id::text, 0));

  SELECT enabled INTO v_enabled
  FROM public.credit_api_provider_config
  WHERE provider_key = 'directd-quod';
  IF coalesce(v_enabled, false) IS NOT TRUE THEN RETURN; END IF;

  SELECT * INTO v_row
  FROM public.consultas_credito
  WHERE id = p_consultation_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_row.provider_credential_key IS DISTINCT FROM 'directd-quod'
    OR v_row.technical_status IS DISTINCT FROM 'queued'
    OR v_row.status IS DISTINCT FROM 'pendente'
    OR v_row.provider_submission_state IS DISTINCT FROM 'not_submitted' THEN
    RETURN;
  END IF;

  v_document := regexp_replace(
    coalesce(v_row.documento, v_row.tenant_document, ''),
    '\D', '', 'g'
  );
  IF length(v_document) IN (11, 14) THEN
    -- Serialize the cache check for the document. A finished request is always
    -- reused, while technical/in-flight states are intentionally ignored.
    PERFORM pg_advisory_xact_lock(hashtextextended('nox:directd-document:' || v_document, 0));

    SELECT source.* INTO v_source
    FROM public.consultas_credito source
    JOIN public.directd_credit_requests source_request
      ON source_request.consultation_id = source.id
     AND source_request.status = 'succeeded'
    WHERE source.id <> v_row.id
      AND source.provider_credential_key = 'directd-quod'
      AND source.external_provider = 'directd_quod'
      AND source.technical_status = 'completed'
      AND source.resultado IN ('aprovado', 'recusado', 'em_analise')
      AND regexp_replace(
        coalesce(source.documento, source.tenant_document, ''),
        '\D', '', 'g'
      ) = v_document
      AND coalesce(source.origem, '') <> 'demo'
      AND coalesce(source.raw_response ->> 'demo', 'false') <> 'true'
    ORDER BY
      (coalesce(source_request.billed_cents, 0) > 0) DESC,
      source.provider_returned_at DESC NULLS LAST,
      source.updated_at DESC
    LIMIT 1;

    IF FOUND THEN
      SELECT * INTO v_source_request
      FROM public.directd_credit_requests
      WHERE consultation_id = v_source.id;

      v_source_name := public.normalize_official_credit_customer_name(v_source.tenant_name);
      v_source_root_id := coalesce(
        v_source_request.reused_from_consultation_id,
        v_source.id
      );
      v_cached_response := (
        CASE
          WHEN jsonb_typeof(v_source.raw_response) = 'object' THEN v_source.raw_response
          ELSE '{}'::jsonb
        END
      ) || jsonb_build_object(
        'cache', jsonb_build_object(
          'reused', true,
          'sourceConsultationId', v_source_root_id,
          'sourceCompletedAt', coalesce(v_source.provider_returned_at, v_source.updated_at),
          'reusedAt', v_now
        )
      );

      UPDATE public.consultas_credito
      SET
        tenant_name = coalesce(v_source_name, tenant_name),
        tenant_data_nascimento = CASE
          WHEN upper(coalesce(tipo_pessoa, tenant_type, '')) = 'PF'
            THEN coalesce(v_source.tenant_data_nascimento, tenant_data_nascimento)
          ELSE tenant_data_nascimento
        END,
        status = v_source.resultado,
        resultado = v_source.resultado,
        substatus = v_source.substatus,
        technical_status = 'completed',
        provider_submission_state = 'confirmed',
        provider_external_id = v_source.provider_external_id,
        external_provider = 'directd_quod',
        external_status = v_source.external_status,
        external_request_id = v_source.external_request_id,
        external_response = v_cached_response,
        automacao_credpago_status = v_source.resultado,
        automacao_credpago_resultado = coalesce(
          v_source.automacao_credpago_resultado,
          '{}'::jsonb
        ) || jsonb_build_object(
          'reutilizado', true,
          'consultaOrigem', v_source_root_id,
          'registradoEm', v_now
        ),
        automacao_origem = 'api_oficial_cache',
        mensagem = v_source.mensagem,
        error_message = NULL,
        raw_response = v_cached_response,
        automation_step = 'resultado_reutilizado',
        automation_started_at = v_now,
        automation_finished_at = v_now,
        provider_returned_at = v_now,
        automacao_processed_at = v_now,
        worker_id = NULL,
        lease_token = NULL,
        lease_expires_at = NULL,
        heartbeat_at = NULL,
        last_error_category = NULL,
        updated_at = v_now
      WHERE id = v_row.id;

      IF v_source_name IS NOT NULL THEN
        UPDATE public.inquilinos
        SET
          nome = v_source_name,
          razao_social = CASE
            WHEN upper(coalesce(v_row.tipo_pessoa, v_row.tenant_type, '')) = 'PJ'
              THEN v_source_name
            ELSE razao_social
          END,
          data_nascimento = CASE
            WHEN upper(coalesce(v_row.tipo_pessoa, v_row.tenant_type, '')) = 'PF'
              THEN coalesce(v_source.tenant_data_nascimento, data_nascimento)
            ELSE data_nascimento
          END,
          updated_at = v_now
        WHERE id = v_row.inquilino_id;
      END IF;

      INSERT INTO public.directd_credit_requests(
        consultation_id,
        requester_id,
        status,
        attempt_count,
        provider_http_status,
        provider_consulta_uid,
        score,
        score_band,
        decision,
        billed_cents,
        error_code,
        requested_at,
        completed_at,
        identity_status,
        identity_attempt_count,
        identity_provider_http_status,
        identity_provider_consulta_uid,
        identity_customer_name,
        identity_birth_date,
        identity_billed_cents,
        identity_error_code,
        identity_response,
        identity_requested_at,
        identity_completed_at,
        reused_from_consultation_id,
        reused_at,
        created_at,
        updated_at
      ) VALUES (
        v_row.id,
        v_row.profile_id_solicitante,
        'succeeded',
        0,
        v_source_request.provider_http_status,
        v_source_request.provider_consulta_uid,
        v_source_request.score,
        v_source_request.score_band,
        v_source.resultado,
        0,
        NULL,
        v_now,
        v_now,
        v_source_request.identity_status,
        0,
        v_source_request.identity_provider_http_status,
        v_source_request.identity_provider_consulta_uid,
        coalesce(v_source_name, v_source_request.identity_customer_name),
        v_source_request.identity_birth_date,
        0,
        v_source_request.identity_error_code,
        v_source_request.identity_response,
        v_now,
        v_now,
        v_source_root_id,
        v_now,
        v_now,
        v_now
      )
      ON CONFLICT (consultation_id) DO UPDATE SET
        status = 'succeeded',
        provider_http_status = EXCLUDED.provider_http_status,
        provider_consulta_uid = EXCLUDED.provider_consulta_uid,
        score = EXCLUDED.score,
        score_band = EXCLUDED.score_band,
        decision = EXCLUDED.decision,
        billed_cents = coalesce(public.directd_credit_requests.billed_cents, 0),
        error_code = NULL,
        completed_at = v_now,
        identity_status = coalesce(
          public.directd_credit_requests.identity_status,
          EXCLUDED.identity_status
        ),
        identity_provider_http_status = coalesce(
          public.directd_credit_requests.identity_provider_http_status,
          EXCLUDED.identity_provider_http_status
        ),
        identity_provider_consulta_uid = coalesce(
          public.directd_credit_requests.identity_provider_consulta_uid,
          EXCLUDED.identity_provider_consulta_uid
        ),
        identity_customer_name = coalesce(
          public.directd_credit_requests.identity_customer_name,
          EXCLUDED.identity_customer_name
        ),
        identity_birth_date = coalesce(
          public.directd_credit_requests.identity_birth_date,
          EXCLUDED.identity_birth_date
        ),
        identity_billed_cents = coalesce(
          public.directd_credit_requests.identity_billed_cents,
          0
        ),
        identity_error_code = coalesce(
          public.directd_credit_requests.identity_error_code,
          EXCLUDED.identity_error_code
        ),
        identity_response = coalesce(
          public.directd_credit_requests.identity_response,
          EXCLUDED.identity_response
        ),
        identity_completed_at = coalesce(
          public.directd_credit_requests.identity_completed_at,
          v_now
        ),
        reused_from_consultation_id = v_source_root_id,
        reused_at = v_now,
        updated_at = v_now;

      -- No row is returned: the Edge Function reads the now-completed target
      -- and exits idempotently without contacting Direct Data.
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.directd_credit_requests(consultation_id, requester_id)
  VALUES (v_row.id, v_row.profile_id_solicitante)
  ON CONFLICT (consultation_id) DO NOTHING;

  SELECT * INTO v_request
  FROM public.directd_credit_requests
  WHERE consultation_id = v_row.id
  FOR UPDATE;

  IF v_request.status NOT IN ('reserved', 'retry_ready') THEN RETURN; END IF;

  UPDATE public.directd_credit_requests
  SET
    status = 'submitting',
    attempt_count = attempt_count + 1,
    requested_at = clock_timestamp(),
    provider_http_status = NULL,
    error_code = NULL,
    updated_at = clock_timestamp()
  WHERE consultation_id = v_row.id;

  UPDATE public.consultas_credito
  SET
    status = 'processando',
    technical_status = 'processing',
    provider_submission_state = 'submitting',
    provider_submission_started_at = clock_timestamp(),
    automation_step = 'enviando',
    automation_started_at = coalesce(automation_started_at, clock_timestamp()),
    automation_finished_at = NULL,
    mensagem = NULL,
    error_message = NULL,
    worker_id = p_worker_id,
    lease_token = gen_random_uuid(),
    lease_expires_at = clock_timestamp() + interval '2 minutes',
    heartbeat_at = clock_timestamp(),
    execution_version = execution_version + 1,
    attempt_count = attempt_count + 1,
    updated_at = clock_timestamp()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN NEXT v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_official_credit_simulation(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_official_credit_simulation(uuid, text) TO service_role;

-- Earlier CNPJ calls may have paid only for the cadastral lookup and stopped
-- because the provider returned a successful response without a company name.
-- Mark only the unpaid Score step as retryable; keep the identity debit intact.
UPDATE public.directd_credit_requests request
SET
  status = 'failed_no_charge',
  error_code = 'DIRECTD_IDENTITY_NAME_MISSING',
  billed_cents = NULL,
  identity_status = 'failed_billed',
  updated_at = clock_timestamp()
FROM public.consultas_credito consultation
WHERE consultation.id = request.consultation_id
  AND consultation.provider_credential_key = 'directd-quod'
  AND consultation.technical_status = 'requires_verification'
  AND consultation.last_error_category = 'DIRECTD_IDENTITY_NAME_MISSING'
  AND request.status = 'requires_verification'
  AND request.billed_cents IS NULL;

UPDATE public.consultas_credito consultation
SET
  status = 'erro',
  resultado = NULL,
  technical_status = 'technical_failure',
  provider_submission_state = 'not_submitted',
  mensagem = 'A razão social não foi fornecida pela fonte cadastral. Tente novamente para concluir o Score sem repetir essa cobrança.',
  error_message = 'DIRECTD_IDENTITY_NAME_MISSING',
  raw_response = jsonb_build_object(
    'provider', 'directd_quod',
    'identity', jsonb_build_object(
      'status', 'unavailable',
      'errorCode', 'DIRECTD_IDENTITY_NAME_MISSING'
    )
  ),
  automation_step = NULL,
  automation_finished_at = clock_timestamp(),
  worker_id = NULL,
  lease_token = NULL,
  lease_expires_at = NULL,
  heartbeat_at = NULL,
  updated_at = clock_timestamp()
WHERE consultation.provider_credential_key = 'directd-quod'
  AND consultation.technical_status = 'requires_verification'
  AND consultation.last_error_category = 'DIRECTD_IDENTITY_NAME_MISSING'
  AND EXISTS (
    SELECT 1
    FROM public.directd_credit_requests request
    WHERE request.consultation_id = consultation.id
      AND request.status = 'failed_no_charge'
      AND request.identity_status = 'failed_billed'
  );

COMMENT ON COLUMN public.directd_credit_requests.reused_from_consultation_id IS
  'Original paid consultation whose completed QUOD result was reused without a new provider charge.';
COMMENT ON COLUMN public.directd_credit_requests.reused_at IS
  'Timestamp when this consultation was completed from the internal result cache.';
