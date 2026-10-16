-- Durable, versioned queue for the Loft credit automation.
--
-- The business row remains consultas_credito so existing Realtime/RLS consumers
-- keep working. Queue ownership, provider submission state and the credit result
-- are now independent fields. All worker transitions happen through guarded RPCs;
-- a stale worker cannot overwrite a newer execution.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.credit_automation_config (
  config_key text PRIMARY KEY,
  max_queue_total integer NOT NULL DEFAULT 500 CHECK (max_queue_total BETWEEN 1 AND 10000),
  max_queue_per_account integer NOT NULL DEFAULT 10 CHECK (max_queue_per_account BETWEEN 1 AND 1000),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  lease_seconds integer NOT NULL DEFAULT 120 CHECK (lease_seconds BETWEEN 30 AND 900),
  retry_base_seconds integer NOT NULL DEFAULT 15 CHECK (retry_base_seconds BETWEEN 1 AND 600),
  circuit_failure_threshold integer NOT NULL DEFAULT 5 CHECK (circuit_failure_threshold BETWEEN 2 AND 50),
  circuit_open_seconds integer NOT NULL DEFAULT 120 CHECK (circuit_open_seconds BETWEEN 30 AND 3600),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO public.credit_automation_config(config_key)
VALUES ('default')
ON CONFLICT (config_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.credit_automation_provider_state (
  provider_key text PRIMARY KEY,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  circuit_open_until timestamptz,
  last_error_category text,
  last_failure_at timestamptz,
  last_success_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO public.credit_automation_provider_state(provider_key)
VALUES ('loft-primary')
ON CONFLICT (provider_key) DO NOTHING;

ALTER TABLE public.credit_automation_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_automation_provider_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.credit_automation_config FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.credit_automation_provider_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.credit_automation_config TO service_role;
GRANT ALL ON TABLE public.credit_automation_provider_state TO service_role;

ALTER TABLE public.consultas_credito
  ADD COLUMN IF NOT EXISTS technical_status text,
  ADD COLUMN IF NOT EXISTS idempotency_key uuid,
  ADD COLUMN IF NOT EXISTS request_fingerprint text,
  ADD COLUMN IF NOT EXISTS provider_credential_key text,
  ADD COLUMN IF NOT EXISTS provider_submission_state text,
  ADD COLUMN IF NOT EXISTS provider_submission_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_external_id text,
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS execution_version bigint,
  ADD COLUMN IF NOT EXISTS attempt_count integer,
  ADD COLUMN IF NOT EXISTS max_attempts integer,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS queue_enqueued_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_category text;

UPDATE public.consultas_credito
SET
  technical_status = coalesce(
    technical_status,
    CASE
      WHEN status = 'pendente' AND origem = 'nox_financa' THEN 'queued'
      WHEN status = 'processando' THEN 'processing'
      WHEN status = 'erro' OR resultado = 'erro' THEN 'technical_failure'
      ELSE 'completed'
    END
  ),
  idempotency_key = coalesce(idempotency_key, gen_random_uuid()),
  request_fingerprint = coalesce(
    request_fingerprint,
    encode(
      extensions.digest(
        convert_to(
          concat_ws('|',
            upper(coalesce(tipo_pessoa, tenant_type, '')),
            regexp_replace(coalesce(documento, tenant_document, ''), '\D', '', 'g'),
            lower(btrim(coalesce(tenant_name, ''))),
            lower(coalesce(tipo_imovel, '')),
            regexp_replace(coalesce(imovel_cep, ''), '\D', '', 'g'),
            lower(btrim(coalesce(property_address, imovel_endereco, ''))),
            coalesce(valor_aluguel, rent_value, 0)::text,
            coalesce(valor_condominio, 0)::text,
            coalesce(valor_taxas, 0)::text
          ),
          'utf8'
        ),
        'sha256'
      ),
      'hex'
    )
  ),
  provider_credential_key = coalesce(provider_credential_key, 'loft-primary'),
  provider_submission_state = coalesce(
    provider_submission_state,
    CASE
      WHEN resultado IN ('aprovado', 'recusado', 'em_analise') THEN 'confirmed'
      WHEN status = 'processando' THEN 'unknown'
      ELSE 'not_submitted'
    END
  ),
  execution_version = coalesce(execution_version, 0),
  attempt_count = coalesce(attempt_count, CASE WHEN status = 'processando' THEN 1 ELSE 0 END),
  max_attempts = coalesce(max_attempts, 3),
  lease_expires_at = coalesce(
    lease_expires_at,
    CASE WHEN status = 'processando' THEN clock_timestamp() ELSE NULL END
  ),
  next_attempt_at = coalesce(next_attempt_at, created_at, clock_timestamp()),
  queue_enqueued_at = coalesce(queue_enqueued_at, created_at, clock_timestamp());

-- Technical failures are not credit decisions. Preserve the historic status and
-- message, but clear the invalid credit result value for all future consumers.
UPDATE public.consultas_credito
SET resultado = NULL
WHERE resultado = 'erro';

ALTER TABLE public.consultas_credito
  ALTER COLUMN technical_status SET DEFAULT 'received',
  ALTER COLUMN technical_status SET NOT NULL,
  ALTER COLUMN idempotency_key SET DEFAULT gen_random_uuid(),
  ALTER COLUMN idempotency_key SET NOT NULL,
  ALTER COLUMN provider_credential_key SET DEFAULT 'loft-primary',
  ALTER COLUMN provider_credential_key SET NOT NULL,
  ALTER COLUMN provider_submission_state SET DEFAULT 'not_submitted',
  ALTER COLUMN provider_submission_state SET NOT NULL,
  ALTER COLUMN execution_version SET DEFAULT 0,
  ALTER COLUMN execution_version SET NOT NULL,
  ALTER COLUMN attempt_count SET DEFAULT 0,
  ALTER COLUMN attempt_count SET NOT NULL,
  ALTER COLUMN max_attempts SET DEFAULT 3,
  ALTER COLUMN max_attempts SET NOT NULL,
  ALTER COLUMN next_attempt_at SET DEFAULT clock_timestamp(),
  ALTER COLUMN next_attempt_at SET NOT NULL,
  ALTER COLUMN queue_enqueued_at SET DEFAULT clock_timestamp(),
  ALTER COLUMN queue_enqueued_at SET NOT NULL;

ALTER TABLE public.consultas_credito
  DROP CONSTRAINT IF EXISTS consultas_credito_technical_status_check,
  ADD CONSTRAINT consultas_credito_technical_status_check CHECK (
    technical_status IN (
      'received', 'queued', 'processing', 'waiting_provider', 'completed',
      'technical_failure', 'requires_verification'
    )
  ),
  DROP CONSTRAINT IF EXISTS consultas_credito_provider_submission_state_check,
  ADD CONSTRAINT consultas_credito_provider_submission_state_check CHECK (
    provider_submission_state IN ('not_submitted', 'submitting', 'submitted', 'confirmed', 'unknown')
  ),
  DROP CONSTRAINT IF EXISTS consultas_credito_attempt_count_check,
  ADD CONSTRAINT consultas_credito_attempt_count_check CHECK (
    attempt_count >= 0 AND max_attempts BETWEEN 1 AND 10
  );

ALTER TABLE public.consultas_credito DROP CONSTRAINT IF EXISTS consultas_credito_status_check;
ALTER TABLE public.consultas_credito ADD CONSTRAINT consultas_credito_status_check
  CHECK (status = ANY (ARRAY[
    'pendente'::text,
    'processando'::text,
    'aprovado'::text,
    'recusado'::text,
    'em_analise'::text,
    'erro'::text,
    'requer_verificacao'::text,
    'reprovado'::text,
    'pendente_documentacao'::text,
    'dados_complementares'::text,
    'finalizada'::text,
    'aguardando_ativacao'::text,
    'ativado'::text
  ]));

-- The same tenant may legitimately be simulated again for another property or
-- amount. Idempotency is scoped to the authenticated account and operation key,
-- never to CPF/CNPJ alone.
DROP INDEX IF EXISTS public.uniq_consulta_user_document;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_credit_simulation_idempotency
  ON public.consultas_credito(profile_id_solicitante, idempotency_key)
  WHERE profile_id_solicitante IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_credit_provider_external_id
  ON public.consultas_credito(provider_credential_key, provider_external_id)
  WHERE provider_external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_credit_simulation_durable_queue
  ON public.consultas_credito(provider_credential_key, next_attempt_at, queue_enqueued_at)
  WHERE technical_status = 'queued' AND origem = 'nox_financa';

CREATE INDEX IF NOT EXISTS idx_credit_simulation_active_lease
  ON public.consultas_credito(provider_credential_key, lease_expires_at)
  WHERE technical_status IN ('processing', 'waiting_provider');

-- The cancellation queue already reconciles a submission against the proposal
-- list by consultation_id + snapshot. Keep that reliable external identifier on
-- the credit job in the same transaction, so an interrupted simulation can be
-- inspected without searching again by CPF/CNPJ.
CREATE OR REPLACE FUNCTION public.sync_loft_proposal_id_to_credit_simulation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing text;
BEGIN
  IF NEW.proposal_id IS NULL OR NEW.consultation_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT provider_external_id INTO v_existing
  FROM public.consultas_credito
  WHERE id = NEW.consultation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cancellation job references an unknown credit simulation'
      USING ERRCODE = '23503';
  END IF;
  IF v_existing IS NOT NULL AND v_existing IS DISTINCT FROM NEW.proposal_id THEN
    RAISE EXCEPTION 'Credit simulation is already linked to another provider operation'
      USING ERRCODE = '23505';
  END IF;

  UPDATE public.consultas_credito
  SET
    provider_external_id = NEW.proposal_id,
    provider_submission_state = CASE
      WHEN provider_submission_state = 'confirmed' THEN 'confirmed'
      ELSE 'submitted'
    END,
    provider_submission_started_at = coalesce(
      provider_submission_started_at,
      NEW.submitted_at,
      NEW.created_at
    )
  WHERE id = NEW.consultation_id;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_loft_proposal_id_to_credit_simulation()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_loft_proposal_id_to_credit_simulation
  ON public.loft_proposal_cancellations;
CREATE TRIGGER trg_sync_loft_proposal_id_to_credit_simulation
AFTER INSERT OR UPDATE OF proposal_id ON public.loft_proposal_cancellations
FOR EACH ROW
WHEN (NEW.proposal_id IS NOT NULL)
EXECUTE FUNCTION public.sync_loft_proposal_id_to_credit_simulation();

WITH latest_provider_operation AS (
  SELECT DISTINCT ON (job.consultation_id)
    job.consultation_id,
    job.proposal_id,
    coalesce(job.submitted_at, job.created_at) AS submitted_at
  FROM public.loft_proposal_cancellations AS job
  WHERE job.proposal_id IS NOT NULL
  ORDER BY job.consultation_id, coalesce(job.submitted_at, job.created_at) DESC
)
UPDATE public.consultas_credito AS consultation
SET
  provider_external_id = operation.proposal_id,
  provider_submission_state = CASE
    WHEN consultation.provider_submission_state = 'confirmed' THEN 'confirmed'
    ELSE 'submitted'
  END,
  provider_submission_started_at = coalesce(
    consultation.provider_submission_started_at,
    operation.submitted_at
  )
FROM latest_provider_operation AS operation
WHERE consultation.id = operation.consultation_id
  AND consultation.provider_external_id IS NULL;

CREATE OR REPLACE FUNCTION public.credit_simulation_payload_fingerprint(
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
  p_fee_value numeric
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT encode(
    extensions.digest(
      convert_to(
        concat_ws('|',
          upper(coalesce(p_tenant_type, '')),
          regexp_replace(coalesce(p_tenant_document, ''), '\D', '', 'g'),
          lower(btrim(coalesce(p_tenant_name, ''))),
          lower(btrim(coalesce(p_property_type, ''))),
          regexp_replace(coalesce(p_property_zip, ''), '\D', '', 'g'),
          lower(btrim(coalesce(p_property_city, ''))),
          upper(btrim(coalesce(p_property_state, ''))),
          lower(btrim(coalesce(p_property_address, ''))),
          coalesce(p_rent_value, 0)::text,
          coalesce(p_condominium_value, 0)::text,
          coalesce(p_fee_value, 0)::text
        ),
        'utf8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

REVOKE ALL ON FUNCTION public.credit_simulation_payload_fingerprint(
  text, text, text, text, text, text, text, text, numeric, numeric, numeric
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_simulation_payload_fingerprint(
  text, text, text, text, text, text, text, text, numeric, numeric, numeric
) TO service_role;

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
  v_document text := regexp_replace(coalesce(p_tenant_document, ''), '\D', '', 'g');
  v_tenant_type text := upper(coalesce(p_tenant_type, ''));
  v_property_type text := initcap(lower(coalesce(p_property_type, '')));
  v_operational_zip text := regexp_replace(coalesce(p_operational_zip, ''), '\D', '', 'g');
  v_tenant_name text := nullif(btrim(p_tenant_name), '');
  v_fingerprint text;
  v_role text;
  v_tenant_id uuid;
  v_property_id uuid;
  v_existing public.consultas_credito%ROWTYPE;
  v_consultation_id uuid;
  v_config public.credit_automation_config%ROWTYPE;
  v_active_total integer;
  v_active_account integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Idempotency key is required' USING ERRCODE = '22023';
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

  v_fingerprint := public.credit_simulation_payload_fingerprint(
    v_tenant_type,
    coalesce(v_tenant_name, ''),
    v_document,
    v_property_type,
    p_property_zip,
    p_property_city,
    p_property_state,
    p_property_address,
    p_rent_value,
    p_condominium_value,
    p_fee_value
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended('nox:credit-enqueue:' || v_caller::text || ':' || p_idempotency_key::text, 0)
  );
  -- Different operation keys still share the configured admission capacity.
  PERFORM pg_advisory_xact_lock(hashtextextended('nox:credit-enqueue-capacity', 0));

  SELECT consultation.*
    INTO v_existing
  FROM public.consultas_credito AS consultation
  WHERE consultation.profile_id_solicitante = v_caller
    AND consultation.idempotency_key = p_idempotency_key
  LIMIT 1
  FOR UPDATE;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'Idempotency key already used with different simulation data'
        USING ERRCODE = '22023';
    END IF;
    RETURN v_existing.id;
  END IF;

  SELECT * INTO v_config
  FROM public.credit_automation_config
  WHERE config_key = 'default';

  SELECT count(*)::integer INTO v_active_total
  FROM public.consultas_credito
  WHERE origem = 'nox_financa'
    AND technical_status IN ('queued', 'processing', 'waiting_provider');

  SELECT count(*)::integer INTO v_active_account
  FROM public.consultas_credito
  WHERE origem = 'nox_financa'
    AND profile_id_solicitante = v_caller
    AND technical_status IN ('queued', 'processing', 'waiting_provider');

  IF v_active_total >= v_config.max_queue_total THEN
    RAISE EXCEPTION 'Credit simulation queue is temporarily full; request was not accepted'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_active_account >= v_config.max_queue_per_account THEN
    RAISE EXCEPTION 'Credit simulation queue limit reached for this account; request was not accepted'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT profile.role::text
    INTO v_role
  FROM public.profiles AS profile
  WHERE profile.id = v_caller;

  v_tenant_id := public.resolve_consultation_tenant(
    v_document,
    v_tenant_type,
    coalesce(v_tenant_name, v_document)
  );

  INSERT INTO public.imoveis (
    cep, cidade, estado, endereco, tipo,
    valor_aluguel, valor_condominio, valor_taxas
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

  INSERT INTO public.consultas_credito (
    correlation_id, idempotency_key, request_fingerprint,
    inquilino_id, imovel_id, profile_id_solicitante, role_solicitante,
    tenant_name, tenant_document, tenant_type, property_address, rent_value,
    tipo_pessoa, documento, documento_masked, tipo_imovel, cep,
    imovel_cep, imovel_cidade, imovel_estado, imovel_endereco,
    valor_aluguel, valor_condominio, valor_taxas,
    status, technical_status, provider_credential_key, provider_submission_state,
    attempt_count, max_attempts, next_attempt_at, queue_enqueued_at, origem
  )
  VALUES (
    p_correlation_id, p_idempotency_key, v_fingerprint,
    v_tenant_id, v_property_id, v_caller, v_role,
    coalesce(v_tenant_name, v_document), v_document, v_tenant_type,
    nullif(btrim(p_property_address), ''), p_rent_value,
    v_tenant_type, v_document,
    CASE
      WHEN v_tenant_type = 'PF' THEN substr(v_document, 1, 3) || '.***.***-' || right(v_document, 2)
      ELSE substr(v_document, 1, 2) || '.***.***/****-' || right(v_document, 2)
    END,
    v_property_type, v_operational_zip,
    nullif(btrim(p_property_zip), ''), p_property_city, p_property_state,
    nullif(btrim(p_property_address), ''),
    p_rent_value, coalesce(p_condominium_value, 0), coalesce(p_fee_value, 0),
    'pendente', 'queued', 'loft-primary', 'not_submitted',
    0, v_config.max_attempts, clock_timestamp(), clock_timestamp(), 'nox_financa'
  )
  RETURNING id INTO v_consultation_id;

  RETURN v_consultation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_credit_simulation(
  text, text, text, text, text, text, text, text, numeric, numeric, numeric, text, text, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_credit_simulation(
  text, text, text, text, text, text, text, text, numeric, numeric, numeric, text, text, uuid
) TO authenticated, service_role;

-- Compatibility wrapper for already deployed clients during the rolling release.
-- New clients always send p_idempotency_key. Legacy correlation ids still produce
-- a stable operation key if an HTTP response is lost and the same call is retried.
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
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.enqueue_credit_simulation(
    p_tenant_type, p_tenant_name, p_tenant_document, p_property_type,
    p_property_zip, p_property_city, p_property_state, p_property_address,
    p_rent_value, p_condominium_value, p_fee_value, p_operational_zip,
    p_correlation_id,
    (
      substr(md5(coalesce(auth.uid()::text, '') || ':' || coalesce(p_correlation_id, '')), 1, 8) || '-' ||
      substr(md5(coalesce(auth.uid()::text, '') || ':' || coalesce(p_correlation_id, '')), 9, 4) || '-' ||
      substr(md5(coalesce(auth.uid()::text, '') || ':' || coalesce(p_correlation_id, '')), 13, 4) || '-' ||
      substr(md5(coalesce(auth.uid()::text, '') || ':' || coalesce(p_correlation_id, '')), 17, 4) || '-' ||
      substr(md5(coalesce(auth.uid()::text, '') || ':' || coalesce(p_correlation_id, '')), 21, 12)
    )::uuid
  );
$$;

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

  -- A crashed worker is safe to retry only when the provider was definitely not
  -- contacted. Any submitted/submitting/unknown operation is quarantined for
  -- reconciliation instead of being sent again blindly.
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
  WHERE consultation.origem = 'nox_financa'
    AND consultation.provider_credential_key = p_provider_credential_key
    AND consultation.technical_status = 'queued'
    AND consultation.status = 'pendente'
    AND consultation.next_attempt_at <= v_now
    AND consultation.attempt_count < consultation.max_attempts
  ORDER BY consultation.next_attempt_at, consultation.queue_enqueued_at, consultation.created_at
  FOR UPDATE SKIP LOCKED
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

CREATE OR REPLACE FUNCTION public.heartbeat_credit_simulation(
  p_consultation_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_execution_version bigint,
  p_step text,
  p_provider_submission_state text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lease_seconds integer;
  v_updated uuid;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  IF p_provider_submission_state IS NOT NULL
    AND p_provider_submission_state NOT IN ('not_submitted', 'submitting', 'submitted', 'confirmed', 'unknown') THEN
    RAISE EXCEPTION 'Invalid provider submission state' USING ERRCODE = '22023';
  END IF;

  SELECT lease_seconds INTO v_lease_seconds
  FROM public.credit_automation_config
  WHERE config_key = 'default';

  UPDATE public.consultas_credito
  SET
    heartbeat_at = clock_timestamp(),
    lease_expires_at = clock_timestamp() + make_interval(secs => v_lease_seconds),
    automation_step = left(coalesce(nullif(p_step, ''), automation_step), 120),
    technical_status = CASE
      WHEN coalesce(p_provider_submission_state, provider_submission_state) IN ('submitting', 'submitted')
        OR p_step = 'aguardando_resultado'
      THEN 'waiting_provider'
      ELSE 'processing'
    END,
    provider_submission_started_at = CASE
      WHEN p_provider_submission_state IN ('submitting', 'submitted')
      THEN coalesce(provider_submission_started_at, clock_timestamp())
      ELSE provider_submission_started_at
    END,
    provider_submission_state = CASE
      WHEN p_provider_submission_state IS NULL THEN provider_submission_state
      WHEN provider_submission_state = 'confirmed' THEN provider_submission_state
      WHEN provider_submission_state = 'submitted' AND p_provider_submission_state IN ('not_submitted', 'submitting')
        THEN provider_submission_state
      WHEN provider_submission_state = 'submitting' AND p_provider_submission_state = 'not_submitted'
        THEN provider_submission_state
      ELSE p_provider_submission_state
    END
  WHERE id = p_consultation_id
    AND worker_id = p_worker_id
    AND lease_token = p_lease_token
    AND execution_version = p_execution_version
    AND technical_status IN ('processing', 'waiting_provider')
  RETURNING id INTO v_updated;

  RETURN v_updated IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.heartbeat_credit_simulation(uuid, text, uuid, bigint, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_credit_simulation(uuid, text, uuid, bigint, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finish_credit_simulation(
  p_consultation_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_execution_version bigint,
  p_credit_result text,
  p_message text,
  p_raw_response jsonb,
  p_customer_name text DEFAULT NULL,
  p_customer_document text DEFAULT NULL,
  p_provider_external_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated uuid;
  v_provider_key text;
  v_document text := regexp_replace(coalesce(p_customer_document, ''), '\D', '', 'g');
  v_now timestamptz := clock_timestamp();
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  IF p_credit_result NOT IN ('aprovado', 'recusado', 'em_analise') THEN
    RAISE EXCEPTION 'Invalid credit result' USING ERRCODE = '22023';
  END IF;

  UPDATE public.consultas_credito
  SET
    status = p_credit_result,
    technical_status = 'completed',
    resultado = p_credit_result,
    mensagem = left(coalesce(p_message, ''), 2000),
    error_message = NULL,
    raw_response = coalesce(p_raw_response, '{}'::jsonb),
    automacao_origem = 'automacao_local',
    automation_step = NULL,
    automation_finished_at = v_now,
    provider_submission_state = 'confirmed',
    provider_external_id = coalesce(nullif(btrim(p_provider_external_id), ''), provider_external_id),
    tenant_name = coalesce(nullif(btrim(p_customer_name), ''), tenant_name),
    documento = CASE WHEN length(v_document) IN (11, 14) THEN v_document ELSE documento END,
    documento_masked = CASE
      WHEN length(v_document) = 11 THEN substr(v_document, 1, 3) || '.***.***-' || right(v_document, 2)
      WHEN length(v_document) = 14 THEN substr(v_document, 1, 2) || '.***.***/****-' || right(v_document, 2)
      ELSE documento_masked
    END,
    worker_id = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    heartbeat_at = NULL,
    last_error_category = NULL
  WHERE id = p_consultation_id
    AND worker_id = p_worker_id
    AND lease_token = p_lease_token
    AND execution_version = p_execution_version
    AND technical_status IN ('processing', 'waiting_provider')
  RETURNING id, provider_credential_key INTO v_updated, v_provider_key;

  IF v_updated IS NOT NULL THEN
    INSERT INTO public.credit_automation_provider_state(
      provider_key, consecutive_failures, circuit_open_until,
      last_error_category, last_success_at, updated_at
    )
    VALUES (v_provider_key, 0, NULL, NULL, v_now, v_now)
    ON CONFLICT (provider_key) DO UPDATE SET
      consecutive_failures = 0,
      circuit_open_until = NULL,
      last_error_category = NULL,
      last_success_at = EXCLUDED.last_success_at,
      updated_at = EXCLUDED.updated_at;
  END IF;

  RETURN v_updated IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_credit_simulation(
  uuid, text, uuid, bigint, text, text, jsonb, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_credit_simulation(
  uuid, text, uuid, bigint, text, text, jsonb, text, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.fail_credit_simulation(
  p_consultation_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_execution_version bigint,
  p_error_category text,
  p_technical_detail text,
  p_user_message text,
  p_raw_response jsonb,
  p_retryable boolean,
  p_provider_submission_state text,
  p_affects_provider_health boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_row public.consultas_credito%ROWTYPE;
  v_config public.credit_automation_config%ROWTYPE;
  v_next_status text;
  v_failures integer;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  IF p_provider_submission_state NOT IN ('not_submitted', 'submitting', 'submitted', 'unknown') THEN
    RAISE EXCEPTION 'Invalid provider submission state' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_config
  FROM public.credit_automation_config
  WHERE config_key = 'default';

  SELECT * INTO v_row
  FROM public.consultas_credito
  WHERE id = p_consultation_id
    AND worker_id = p_worker_id
    AND lease_token = p_lease_token
    AND execution_version = p_execution_version
    AND technical_status IN ('processing', 'waiting_provider')
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'lease_lost';
  END IF;

  IF p_provider_submission_state <> 'not_submitted'
    OR v_row.provider_submission_state <> 'not_submitted' THEN
    v_next_status := 'requires_verification';
  ELSIF p_retryable AND v_row.attempt_count < v_row.max_attempts THEN
    v_next_status := 'queued';
  ELSE
    v_next_status := 'technical_failure';
  END IF;

  UPDATE public.consultas_credito
  SET
    status = CASE
      WHEN v_next_status = 'queued' THEN 'pendente'
      WHEN v_next_status = 'requires_verification' THEN 'requer_verificacao'
      ELSE 'erro'
    END,
    technical_status = v_next_status,
    resultado = NULL,
    mensagem = left(
      CASE
        WHEN v_next_status = 'requires_verification' THEN
          'A consulta pode ter sido recebida pelo parceiro e precisa de conferência antes de qualquer novo envio.'
        WHEN v_next_status = 'queued' THEN
          'Uma falha temporária ocorreu antes do envio. A consulta será retomada automaticamente.'
        ELSE coalesce(nullif(p_user_message, ''), 'Não foi possível concluir a consulta por uma falha técnica.')
      END,
      2000
    ),
    error_message = left(coalesce(p_technical_detail, ''), 2000),
    raw_response = coalesce(p_raw_response, '{}'::jsonb),
    automation_step = CASE
      WHEN v_next_status = 'queued' THEN 'aguardando_retentativa'
      WHEN v_next_status = 'requires_verification' THEN 'requer_verificacao'
      ELSE NULL
    END,
    automation_started_at = CASE WHEN v_next_status = 'queued' THEN NULL ELSE automation_started_at END,
    automation_finished_at = CASE WHEN v_next_status = 'queued' THEN NULL ELSE v_now END,
    next_attempt_at = CASE
      WHEN v_next_status = 'queued' THEN v_now + make_interval(
        secs => least(600, v_config.retry_base_seconds * (2 ^ greatest(v_row.attempt_count - 1, 0)))
          + floor(random() * greatest(2, v_config.retry_base_seconds / 2))::integer
      )
      ELSE next_attempt_at
    END,
    provider_submission_state = CASE
      WHEN v_next_status = 'requires_verification' AND p_provider_submission_state = 'not_submitted'
        THEN 'unknown'
      ELSE p_provider_submission_state
    END,
    last_error_category = left(coalesce(p_error_category, 'UNKNOWN_ERROR'), 120),
    worker_id = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    heartbeat_at = NULL
  WHERE id = p_consultation_id;

  IF p_affects_provider_health THEN
    INSERT INTO public.credit_automation_provider_state(
      provider_key, consecutive_failures, circuit_open_until,
      last_error_category, last_failure_at, updated_at
    )
    VALUES (
      v_row.provider_credential_key,
      1,
      NULL,
      left(coalesce(p_error_category, 'UNKNOWN_ERROR'), 120),
      v_now,
      v_now
    )
    ON CONFLICT (provider_key) DO UPDATE SET
      consecutive_failures = public.credit_automation_provider_state.consecutive_failures + 1,
      circuit_open_until = CASE
        WHEN public.credit_automation_provider_state.consecutive_failures + 1
          >= v_config.circuit_failure_threshold
        THEN v_now + make_interval(secs => v_config.circuit_open_seconds)
        ELSE public.credit_automation_provider_state.circuit_open_until
      END,
      last_error_category = EXCLUDED.last_error_category,
      last_failure_at = EXCLUDED.last_failure_at,
      updated_at = EXCLUDED.updated_at
    RETURNING consecutive_failures INTO v_failures;
  END IF;

  RETURN v_next_status;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_credit_simulation(
  uuid, text, uuid, bigint, text, text, text, jsonb, boolean, text, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_credit_simulation(
  uuid, text, uuid, bigint, text, text, text, jsonb, boolean, text, boolean
) TO service_role;

CREATE OR REPLACE FUNCTION public.retry_credit_simulation(p_consultation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_config public.credit_automation_config%ROWTYPE;
  v_updated uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_config
  FROM public.credit_automation_config
  WHERE config_key = 'default';

  UPDATE public.consultas_credito AS consultation
  SET
    status = 'pendente',
    technical_status = 'queued',
    resultado = NULL,
    mensagem = NULL,
    error_message = NULL,
    raw_response = NULL,
    automation_step = NULL,
    automation_started_at = NULL,
    automation_finished_at = NULL,
    attempt_count = 0,
    max_attempts = v_config.max_attempts,
    next_attempt_at = clock_timestamp(),
    queue_enqueued_at = clock_timestamp(),
    provider_submission_state = 'not_submitted',
    provider_submission_started_at = NULL,
    provider_external_id = NULL,
    worker_id = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    heartbeat_at = NULL,
    last_error_category = NULL
  WHERE consultation.id = p_consultation_id
    AND consultation.technical_status = 'technical_failure'
    AND consultation.provider_submission_state = 'not_submitted'
    AND (
      consultation.profile_id_solicitante = v_caller
      OR public.eh_dono_ou_imobiliaria_da_consulta(consultation.profile_id_solicitante)
      OR public.eh_staff_interno_consultas()
    )
  RETURNING id INTO v_updated;

  RETURN v_updated IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.retry_credit_simulation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_credit_simulation(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_credit_automation_metrics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_state public.credit_automation_provider_state%ROWTYPE;
  v_result jsonb;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_state
  FROM public.credit_automation_provider_state
  WHERE provider_key = 'loft-primary';

  SELECT jsonb_build_object(
    'queued', count(*) FILTER (WHERE technical_status = 'queued'),
    'processing', count(*) FILTER (WHERE technical_status IN ('processing', 'waiting_provider')),
    'retrying', count(*) FILTER (
      WHERE technical_status = 'queued' AND attempt_count > 0 AND next_attempt_at > v_now
    ),
    'requiresVerification', count(*) FILTER (WHERE technical_status = 'requires_verification'),
    'expiredLeases', count(*) FILTER (
      WHERE technical_status IN ('processing', 'waiting_provider') AND lease_expires_at <= v_now
    ),
    'oldestQueueAgeSeconds', coalesce(
      extract(epoch FROM (v_now - min(queue_enqueued_at) FILTER (WHERE technical_status = 'queued')))::bigint,
      0
    ),
    'providerConsecutiveFailures', coalesce(v_state.consecutive_failures, 0),
    'circuitOpenUntil', v_state.circuit_open_until,
    'circuitOpen', coalesce(v_state.circuit_open_until > v_now, false),
    'lastProviderErrorCategory', v_state.last_error_category
  ) INTO v_result
  FROM public.consultas_credito
  WHERE origem = 'nox_financa';

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_credit_automation_metrics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_credit_automation_metrics() TO service_role;

COMMENT ON COLUMN public.consultas_credito.technical_status IS
  'Technical execution state, independent from the credit decision stored in resultado.';
COMMENT ON COLUMN public.consultas_credito.idempotency_key IS
  'Client operation key scoped by profile_id_solicitante; reuse with a different payload is rejected.';
COMMENT ON COLUMN public.consultas_credito.lease_token IS
  'Exclusive worker lease token. Final writes require token + execution_version.';
COMMENT ON COLUMN public.consultas_credito.provider_submission_state IS
  'Tracks whether retrying is safe. submitting/submitted/unknown are never resent automatically after interruption.';
