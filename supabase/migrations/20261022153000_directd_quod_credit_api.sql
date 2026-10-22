-- Replace the browser-based Loft/CredPago worker with the official Direct Data
-- Score de Crédito - QUOD API. The old automation remains in the repository for
-- history/rollback, but its database claim is intentionally disabled.

ALTER TABLE public.credit_automation_config
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;

UPDATE public.credit_automation_config
SET enabled = false,
    updated_at = clock_timestamp()
WHERE config_key = 'default';

-- Stop all old browser jobs without deleting their history. A job that may have
-- reached Loft is quarantined instead of being retried or labelled as cancelled.
UPDATE public.consultas_credito
SET
  status = CASE
    WHEN provider_submission_state = 'not_submitted' THEN 'cancelada'
    ELSE 'requer_verificacao'
  END,
  technical_status = CASE
    WHEN provider_submission_state = 'not_submitted' THEN 'cancelled'
    ELSE 'requires_verification'
  END,
  resultado = NULL,
  mensagem = CASE
    WHEN provider_submission_state = 'not_submitted'
      THEN 'Automação anterior desativada sem envio. Faça uma nova consulta pela análise oficial.'
    ELSE 'A automação anterior foi desativada e este envio precisa de conferência antes de qualquer nova consulta.'
  END,
  error_message = NULL,
  automation_step = CASE
    WHEN provider_submission_state = 'not_submitted' THEN 'cancelada_sem_envio'
    ELSE 'requer_verificacao'
  END,
  automation_finished_at = clock_timestamp(),
  worker_id = NULL,
  lease_token = NULL,
  lease_expires_at = NULL,
  heartbeat_at = NULL,
  last_error_category = 'LEGACY_AUTOMATION_DISABLED',
  updated_at = clock_timestamp()
WHERE origem = 'nox_financa'
  AND coalesce(provider_credential_key, 'loft-primary') = 'loft-primary'
  AND technical_status IN ('queued', 'processing', 'waiting_provider');

CREATE TABLE IF NOT EXISTS public.credit_api_provider_config (
  provider_key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  unit_cost_cents integer NOT NULL CHECK (unit_cost_cents >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO public.credit_api_provider_config(provider_key, enabled, unit_cost_cents)
VALUES ('directd-quod', true, 198)
ON CONFLICT (provider_key) DO UPDATE SET
  enabled = EXCLUDED.enabled,
  unit_cost_cents = EXCLUDED.unit_cost_cents,
  updated_at = clock_timestamp();

CREATE TABLE IF NOT EXISTS public.directd_credit_requests (
  consultation_id uuid PRIMARY KEY REFERENCES public.consultas_credito(id) ON DELETE RESTRICT,
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'reserved' CHECK (
    status IN (
      'reserved', 'submitting', 'retry_ready', 'succeeded',
      'failed_no_charge', 'requires_verification'
    )
  ),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
  provider_http_status integer,
  provider_consulta_uid text,
  score integer,
  score_band text,
  decision text CHECK (decision IS NULL OR decision IN ('aprovado', 'recusado', 'em_analise')),
  billed_cents integer CHECK (billed_cents IS NULL OR billed_cents >= 0),
  error_code text,
  requested_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.credit_api_provider_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.directd_credit_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.credit_api_provider_config FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.directd_credit_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.credit_api_provider_config TO service_role;
GRANT ALL ON TABLE public.directd_credit_requests TO service_role;

CREATE INDEX IF NOT EXISTS idx_directd_credit_requests_status
  ON public.directd_credit_requests(status, updated_at);

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

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_official_credit_simulation(
  text, text, text, text, text, text, text, text, numeric, numeric, numeric, text, text, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_official_credit_simulation(
  text, text, text, text, text, text, text, text, numeric, numeric, numeric, text, text, uuid
) TO authenticated, service_role;

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
  v_request public.directd_credit_requests%ROWTYPE;
  v_enabled boolean;
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

CREATE OR REPLACE FUNCTION public.finish_official_credit_simulation(
  p_consultation_id uuid,
  p_worker_id text,
  p_execution_version bigint,
  p_credit_result text,
  p_message text,
  p_score integer,
  p_score_band text,
  p_provider_external_id text,
  p_sanitized_response jsonb,
  p_provider_http_status integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated uuid;
  v_cost integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  IF p_credit_result NOT IN ('aprovado', 'recusado', 'em_analise') THEN
    RAISE EXCEPTION 'Invalid credit result' USING ERRCODE = '22023';
  END IF;

  SELECT unit_cost_cents INTO v_cost
  FROM public.credit_api_provider_config
  WHERE provider_key = 'directd-quod';

  UPDATE public.consultas_credito
  SET
    status = p_credit_result,
    resultado = p_credit_result,
    substatus = NULL,
    technical_status = 'completed',
    provider_submission_state = 'confirmed',
    provider_external_id = nullif(btrim(p_provider_external_id), ''),
    external_provider = 'directd_quod',
    external_status = left(coalesce(p_score_band, ''), 255),
    external_request_id = nullif(btrim(p_provider_external_id), ''),
    external_response = coalesce(p_sanitized_response, '{}'::jsonb),
    automacao_credpago_status = p_credit_result,
    automacao_credpago_resultado = jsonb_build_object(
      'status', p_credit_result,
      'statusOriginal', p_score_band,
      'score', p_score,
      'protocolo', p_provider_external_id,
      'origem', 'api_oficial',
      'registradoEm', v_now
    ),
    automacao_origem = 'api_oficial',
    mensagem = left(coalesce(p_message, ''), 2000),
    error_message = NULL,
    raw_response = coalesce(p_sanitized_response, '{}'::jsonb),
    automation_step = NULL,
    automation_finished_at = v_now,
    provider_returned_at = v_now,
    automacao_processed_at = v_now,
    worker_id = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    heartbeat_at = NULL,
    last_error_category = NULL,
    updated_at = v_now
  WHERE id = p_consultation_id
    AND provider_credential_key = 'directd-quod'
    AND worker_id = p_worker_id
    AND execution_version = p_execution_version
    AND technical_status = 'processing'
    AND provider_submission_state = 'submitting'
  RETURNING id INTO v_updated;

  IF v_updated IS NULL THEN RETURN false; END IF;

  UPDATE public.directd_credit_requests
  SET
    status = 'succeeded',
    provider_http_status = p_provider_http_status,
    provider_consulta_uid = nullif(btrim(p_provider_external_id), ''),
    score = p_score,
    score_band = left(coalesce(p_score_band, ''), 255),
    decision = p_credit_result,
    billed_cents = coalesce(v_cost, 198),
    error_code = NULL,
    completed_at = v_now,
    updated_at = v_now
  WHERE consultation_id = p_consultation_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_official_credit_simulation(
  uuid, text, bigint, text, text, integer, text, text, jsonb, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_official_credit_simulation(
  uuid, text, bigint, text, text, integer, text, text, jsonb, integer
) TO service_role;

CREATE OR REPLACE FUNCTION public.fail_official_credit_simulation(
  p_consultation_id uuid,
  p_worker_id text,
  p_execution_version bigint,
  p_error_code text,
  p_user_message text,
  p_ambiguous_charge boolean,
  p_provider_http_status integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  UPDATE public.consultas_credito
  SET
    status = CASE WHEN p_ambiguous_charge THEN 'requer_verificacao' ELSE 'erro' END,
    resultado = NULL,
    technical_status = CASE WHEN p_ambiguous_charge THEN 'requires_verification' ELSE 'technical_failure' END,
    provider_submission_state = CASE WHEN p_ambiguous_charge THEN 'unknown' ELSE 'not_submitted' END,
    mensagem = left(coalesce(p_user_message, 'Não foi possível concluir a consulta oficial.'), 2000),
    error_message = left(coalesce(p_error_code, 'DIRECTD_ERROR'), 2000),
    raw_response = jsonb_build_object(
      'provider', 'directd_quod',
      'httpStatus', p_provider_http_status,
      'errorCode', p_error_code
    ),
    automation_step = CASE WHEN p_ambiguous_charge THEN 'requer_verificacao' ELSE NULL END,
    automation_finished_at = v_now,
    worker_id = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    heartbeat_at = NULL,
    last_error_category = left(coalesce(p_error_code, 'DIRECTD_ERROR'), 120),
    updated_at = v_now
  WHERE id = p_consultation_id
    AND provider_credential_key = 'directd-quod'
    AND worker_id = p_worker_id
    AND execution_version = p_execution_version
    AND technical_status = 'processing'
  RETURNING id INTO v_updated;

  IF v_updated IS NULL THEN RETURN false; END IF;

  UPDATE public.directd_credit_requests
  SET
    status = CASE WHEN p_ambiguous_charge THEN 'requires_verification' ELSE 'failed_no_charge' END,
    provider_http_status = p_provider_http_status,
    error_code = left(coalesce(p_error_code, 'DIRECTD_ERROR'), 120),
    billed_cents = NULL,
    completed_at = v_now,
    updated_at = v_now
  WHERE consultation_id = p_consultation_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_official_credit_simulation(
  uuid, text, bigint, text, text, boolean, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_official_credit_simulation(
  uuid, text, bigint, text, text, boolean, integer
) TO service_role;

CREATE OR REPLACE FUNCTION public.fail_official_credit_simulation_configuration(
  p_consultation_id uuid,
  p_error_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.consultas_credito%ROWTYPE;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  UPDATE public.consultas_credito
  SET
    status = 'erro',
    resultado = NULL,
    technical_status = 'technical_failure',
    provider_submission_state = 'not_submitted',
    mensagem = 'A API oficial de crédito ainda não está configurada.',
    error_message = left(coalesce(p_error_code, 'DIRECTD_CONFIGURATION_ERROR'), 2000),
    last_error_category = left(coalesce(p_error_code, 'DIRECTD_CONFIGURATION_ERROR'), 120),
    automation_finished_at = clock_timestamp(),
    updated_at = clock_timestamp()
  WHERE id = p_consultation_id
    AND provider_credential_key = 'directd-quod'
    AND technical_status = 'queued'
    AND provider_submission_state = 'not_submitted'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN RETURN false; END IF;

  INSERT INTO public.directd_credit_requests(
    consultation_id, requester_id, status, error_code, completed_at, updated_at
  ) VALUES (
    v_row.id, v_row.profile_id_solicitante, 'failed_no_charge',
    left(coalesce(p_error_code, 'DIRECTD_CONFIGURATION_ERROR'), 120),
    clock_timestamp(), clock_timestamp()
  )
  ON CONFLICT (consultation_id) DO UPDATE SET
    status = 'failed_no_charge',
    error_code = EXCLUDED.error_code,
    completed_at = EXCLUDED.completed_at,
    updated_at = EXCLUDED.updated_at;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_official_credit_simulation_configuration(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_official_credit_simulation_configuration(uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.retry_official_credit_simulation(p_consultation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_updated uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('nox:directd:' || p_consultation_id::text, 0));

  UPDATE public.consultas_credito AS consultation
  SET
    status = 'pendente',
    resultado = NULL,
    technical_status = 'queued',
    provider_submission_state = 'not_submitted',
    mensagem = NULL,
    error_message = NULL,
    raw_response = NULL,
    automation_step = NULL,
    automation_started_at = NULL,
    automation_finished_at = NULL,
    provider_submission_started_at = NULL,
    worker_id = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    heartbeat_at = NULL,
    last_error_category = NULL,
    updated_at = clock_timestamp()
  WHERE consultation.id = p_consultation_id
    AND consultation.provider_credential_key = 'directd-quod'
    AND consultation.technical_status = 'technical_failure'
    AND consultation.provider_submission_state = 'not_submitted'
    AND (
      consultation.profile_id_solicitante = v_caller
      OR public.eh_dono_ou_imobiliaria_da_consulta(consultation.profile_id_solicitante)
      OR public.eh_staff_interno_consultas()
    )
  RETURNING id INTO v_updated;

  IF v_updated IS NULL THEN RETURN false; END IF;

  UPDATE public.directd_credit_requests
  SET
    status = 'retry_ready',
    provider_http_status = NULL,
    error_code = NULL,
    completed_at = NULL,
    updated_at = clock_timestamp()
  WHERE consultation_id = p_consultation_id
    AND status = 'failed_no_charge';

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.retry_official_credit_simulation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_official_credit_simulation(uuid)
  TO authenticated, service_role;

-- Hard stop for the Playwright worker. Keeping the function with the same
-- signature lets an already-running process become idle without crashing.
CREATE OR REPLACE FUNCTION public.claim_next_credit_simulation(
  p_worker_id text,
  p_provider_credential_key text DEFAULT 'loft-primary'
)
RETURNS SETOF public.consultas_credito
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_credit_simulation(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_credit_simulation(text, text) TO service_role;

COMMENT ON TABLE public.directd_credit_requests IS
  'Idempotency and billing ledger for Direct Data QUOD score requests. One provider request per consultation.';
COMMENT ON COLUMN public.directd_credit_requests.billed_cents IS
  'Expected provider debit recorded only after a valid HTTP 200 score response.';
