-- Central de Auto-Recuperacao da automacao de credito.
-- Estado persistente, RLS administrativo, jobs com lease/lock distribuido e
-- correlation id fim a fim. Nenhuma funcao aceita comandos arbitrarios.

CREATE OR REPLACE FUNCTION public.generate_nox_sim_correlation_id()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = pg_catalog, public, extensions
AS $$
  SELECT 'NOX-SIM-' || to_char(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo', 'YYYYMMDD')
    || '-' || upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 8));
$$;

ALTER TABLE public.consultas_credito
  ADD COLUMN IF NOT EXISTS correlation_id text;

UPDATE public.consultas_credito
SET correlation_id = public.generate_nox_sim_correlation_id()
WHERE correlation_id IS NULL OR correlation_id = '';

ALTER TABLE public.consultas_credito
  ALTER COLUMN correlation_id SET DEFAULT public.generate_nox_sim_correlation_id(),
  ALTER COLUMN correlation_id SET NOT NULL;

ALTER TABLE public.consultas_credito
  DROP CONSTRAINT IF EXISTS consultas_credito_correlation_id_format;
ALTER TABLE public.consultas_credito
  ADD CONSTRAINT consultas_credito_correlation_id_format
  CHECK (correlation_id ~ '^NOX-SIM-[0-9]{8}-[A-F0-9]{8}$');

CREATE UNIQUE INDEX IF NOT EXISTS consultas_credito_correlation_id_uidx
  ON public.consultas_credito(correlation_id);

COMMENT ON COLUMN public.consultas_credito.correlation_id IS
  'Identificador tecnico sem PII: NOX-SIM-YYYYMMDD-XXXXXXXX. Acompanha a simulacao do cliente ao worker.';

CREATE OR REPLACE FUNCTION public.is_automation_admin(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT _uid IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = _uid
        AND role::text IN ('admin', 'admin_master')
        AND coalesce(status, 'ativo') NOT IN ('bloqueado', 'excluido')
    )
    OR public.has_internal_role(_uid, 'admin_master'::public.internal_role)
  );
$$;

REVOKE ALL ON FUNCTION public.is_automation_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_automation_admin(uuid) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.automation_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id text NOT NULL,
  simulation_id uuid REFERENCES public.consultas_credito(id) ON DELETE SET NULL,
  initiating_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  environment text NOT NULL DEFAULT 'production',
  service text NOT NULL DEFAULT 'credit-automation',
  category text NOT NULL DEFAULT 'UNKNOWN_ERROR' CHECK (category IN (
    'SESSION_EXPIRED', 'BROWSER_CRASH', 'BROWSER_PROFILE_LOCKED',
    'PLAYWRIGHT_TIMEOUT', 'SELECTOR_NOT_FOUND', 'ELEMENT_NOT_VISIBLE',
    'CREDPAGO_UNAVAILABLE', 'AUTHENTICATION_ERROR', 'NETWORK_ERROR',
    'VPS_OFFLINE', 'VPS_HIGH_CPU', 'VPS_HIGH_MEMORY', 'VPS_LOW_DISK',
    'WORKER_OFFLINE', 'DATABASE_ERROR', 'DEPLOY_ERROR', 'DEPENDENCY_ERROR',
    'INTERNAL_SERVER_ERROR', 'UNKNOWN_ERROR'
  )),
  severity text NOT NULL DEFAULT 'ERROR' CHECK (severity IN ('INFO', 'WARNING', 'ERROR', 'CRITICAL')),
  status text NOT NULL DEFAULT 'NOVO' CHECK (status IN (
    'NOVO', 'ANALISANDO', 'CORRIGINDO', 'VALIDANDO', 'CORRIGIDO',
    'FALHOU', 'ROLLBACK_REALIZADO', 'INTERVENCAO_NECESSARIA'
  )),
  automation_step text,
  last_successful_step text,
  message_redacted text NOT NULL,
  stack_trace_redacted text,
  error_code text,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count >= 0),
  occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
  fingerprint text NOT NULL,
  initial_diagnosis text,
  deploy_version text,
  automation_version text,
  vps_id text,
  runtime text,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  artifacts jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_repair_job_id uuid,
  first_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT automation_errors_correlation_format
    CHECK (correlation_id ~ '^NOX-(SIM|SYS)-[0-9]{8}-[A-F0-9]{8}$'),
  CONSTRAINT automation_errors_message_length CHECK (length(message_redacted) <= 4000),
  CONSTRAINT automation_errors_stack_length CHECK (stack_trace_redacted IS NULL OR length(stack_trace_redacted) <= 12000),
  UNIQUE(correlation_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS public.repair_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  error_id uuid NOT NULL REFERENCES public.automation_errors(id) ON DELETE RESTRICT,
  service text NOT NULL DEFAULT 'credit-automation',
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  worker_id text,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN (
    'QUEUED', 'COLLECTING_CONTEXT', 'DIAGNOSING', 'SNAPSHOTTING',
    'REPAIRING', 'RESTARTING', 'VALIDATING', 'SUCCESS', 'FAILED',
    'ROLLING_BACK', 'ROLLED_BACK', 'MANUAL_REQUIRED'
  )),
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  stage_message text NOT NULL DEFAULT 'Reparo aguardando na fila.',
  runbook text,
  diagnosis text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_summary text,
  failure_reason text,
  rollback_reason text,
  rollback_available boolean NOT NULL DEFAULT false,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 3),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_expires_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.automation_errors
  DROP CONSTRAINT IF EXISTS automation_errors_current_repair_job_id_fkey;
ALTER TABLE public.automation_errors
  ADD CONSTRAINT automation_errors_current_repair_job_id_fkey
  FOREIGN KEY (current_repair_job_id) REFERENCES public.repair_jobs(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS repair_jobs_one_active_per_error_uidx
  ON public.repair_jobs(error_id)
  WHERE status IN (
    'QUEUED', 'COLLECTING_CONTEXT', 'DIAGNOSING', 'SNAPSHOTTING',
    'REPAIRING', 'RESTARTING', 'VALIDATING', 'ROLLING_BACK'
  );
CREATE INDEX IF NOT EXISTS repair_jobs_queue_idx
  ON public.repair_jobs(next_attempt_at, created_at)
  WHERE status = 'QUEUED';
CREATE INDEX IF NOT EXISTS repair_jobs_error_history_idx
  ON public.repair_jobs(error_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.repair_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.repair_jobs(id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence >= 0),
  stage text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED')),
  progress integer NOT NULL CHECK (progress BETWEEN 0 AND 100),
  message text NOT NULL CHECK (length(message) <= 4000),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(job_id, sequence)
);

CREATE INDEX IF NOT EXISTS repair_steps_job_idx
  ON public.repair_steps(job_id, sequence);

CREATE TABLE IF NOT EXISTS public.repair_locks (
  lock_key text PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.repair_jobs(id) ON DELETE CASCADE,
  worker_id text NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.system_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service text NOT NULL,
  component text NOT NULL,
  environment text NOT NULL DEFAULT 'production',
  status text NOT NULL CHECK (status IN ('ONLINE', 'UNSTABLE', 'OFFLINE', 'UNKNOWN')),
  summary text NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  version text,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_success_at timestamptz,
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(service, component, environment)
);

CREATE INDEX IF NOT EXISTS automation_errors_open_idx
  ON public.automation_errors(status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS automation_errors_category_idx
  ON public.automation_errors(category, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS automation_errors_simulation_idx
  ON public.automation_errors(simulation_id, last_seen_at DESC);

-- Torna o historico recente imediatamente util na nova central. Apenas linhas
-- que realmente terminaram em erro entram; o texto legado passa por mascaras
-- antes de ser persistido na area administrativa.
INSERT INTO public.automation_errors (
  correlation_id, simulation_id, initiating_user_id, environment, service,
  category, severity, status, automation_step, last_successful_step,
  message_redacted, error_code, attempt_count, occurrence_count, fingerprint,
  initial_diagnosis, metadata, first_seen_at, last_seen_at, created_at, updated_at
)
SELECT
  c.correlation_id,
  c.id,
  c.profile_id_solicitante,
  'production',
  'credit-automation',
  CASE
    WHEN coalesce(c.error_message, c.mensagem, '') ~* 'sess[aã]o.*expir|login.*expir' THEN 'SESSION_EXPIRED'
    WHEN coalesce(c.error_message, c.mensagem, '') ~* 'captcha|otp|autentica' THEN 'AUTHENTICATION_ERROR'
    WHEN coalesce(c.error_message, c.mensagem, '') ~* 'selector|seletor|n[aã]o encontrad' THEN 'SELECTOR_NOT_FOUND'
    WHEN coalesce(c.error_message, c.mensagem, '') ~* 'timeout|tempo limite|exceeded' THEN 'PLAYWRIGHT_TIMEOUT'
    WHEN coalesce(c.error_message, c.mensagem, '') ~* 'network|gateway|econn|enotfound|fetch failed' THEN 'NETWORK_ERROR'
    WHEN coalesce(c.error_message, c.mensagem, '') ~* 'browser|chromium|page.*closed|target.*closed' THEN 'BROWSER_CRASH'
    ELSE 'UNKNOWN_ERROR'
  END,
  'ERROR',
  'NOVO',
  c.automation_step,
  NULL,
  left(
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce(nullif(c.error_message, ''), nullif(c.mensagem, ''), 'Erro legado sem detalhe.'),
          '[0-9]{11,14}', '[DOCUMENTO]', 'g'),
        '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}', '[EMAIL]', 'gi'),
      '\+?[0-9][0-9 ()-]{8,}[0-9]', '[TELEFONE]', 'g'
    ),
    4000
  ),
  'HISTORICAL_IMPORT',
  1,
  1,
  md5(c.correlation_id || ':historical:' || coalesce(c.error_message, c.mensagem, 'unknown')),
  'Ocorrencia historica importada; execute o diagnostico atual antes de qualquer reparo.',
  jsonb_build_object('historicalImport', true, 'sourceStatus', c.status),
  coalesce(c.automation_started_at, c.created_at, clock_timestamp()),
  coalesce(c.automation_finished_at, c.updated_at, c.created_at, clock_timestamp()),
  coalesce(c.created_at, clock_timestamp()),
  clock_timestamp()
FROM public.consultas_credito c
WHERE c.status = 'erro'
  AND c.origem = 'nox_financa'
ON CONFLICT (correlation_id, fingerprint) DO NOTHING;

ALTER TABLE public.automation_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_health ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.automation_errors, public.repair_jobs, public.repair_steps,
  public.repair_locks, public.system_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.automation_errors, public.repair_jobs, public.repair_steps,
  public.system_health TO authenticated;
GRANT ALL ON public.automation_errors, public.repair_jobs, public.repair_steps,
  public.repair_locks, public.system_health TO service_role;

DROP POLICY IF EXISTS "Automation admins read errors" ON public.automation_errors;
CREATE POLICY "Automation admins read errors"
  ON public.automation_errors FOR SELECT TO authenticated
  USING (public.is_automation_admin(auth.uid()));
DROP POLICY IF EXISTS "Automation admins read repair jobs" ON public.repair_jobs;
CREATE POLICY "Automation admins read repair jobs"
  ON public.repair_jobs FOR SELECT TO authenticated
  USING (public.is_automation_admin(auth.uid()));
DROP POLICY IF EXISTS "Automation admins read repair steps" ON public.repair_steps;
CREATE POLICY "Automation admins read repair steps"
  ON public.repair_steps FOR SELECT TO authenticated
  USING (public.is_automation_admin(auth.uid()));
DROP POLICY IF EXISTS "Automation admins read system health" ON public.system_health;
CREATE POLICY "Automation admins read system health"
  ON public.system_health FOR SELECT TO authenticated
  USING (public.is_automation_admin(auth.uid()));

INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'automation-error-artifacts', 'automation-error-artifacts', false, 2097152,
  ARRAY['image/png', 'text/plain', 'application/json']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Automation admins read error artifacts" ON storage.objects;
CREATE POLICY "Automation admins read error artifacts"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'automation-error-artifacts'
    AND public.is_automation_admin(auth.uid())
  );

CREATE OR REPLACE FUNCTION public.record_automation_error(p_error jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid;
  v_correlation text := coalesce(nullif(p_error ->> 'correlation_id', ''), public.generate_nox_sim_correlation_id());
  v_fingerprint text := left(coalesce(nullif(p_error ->> 'fingerprint', ''), 'unknown'), 160);
  v_category text := coalesce(nullif(p_error ->> 'category', ''), 'UNKNOWN_ERROR');
  v_severity text := coalesce(nullif(p_error ->> 'severity', ''), 'ERROR');
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;

  IF v_category NOT IN (
    'SESSION_EXPIRED', 'BROWSER_CRASH', 'BROWSER_PROFILE_LOCKED',
    'PLAYWRIGHT_TIMEOUT', 'SELECTOR_NOT_FOUND', 'ELEMENT_NOT_VISIBLE',
    'CREDPAGO_UNAVAILABLE', 'AUTHENTICATION_ERROR', 'NETWORK_ERROR',
    'VPS_OFFLINE', 'VPS_HIGH_CPU', 'VPS_HIGH_MEMORY', 'VPS_LOW_DISK',
    'WORKER_OFFLINE', 'DATABASE_ERROR', 'DEPLOY_ERROR', 'DEPENDENCY_ERROR',
    'INTERNAL_SERVER_ERROR', 'UNKNOWN_ERROR'
  ) THEN
    v_category := 'UNKNOWN_ERROR';
  END IF;
  IF v_severity NOT IN ('INFO', 'WARNING', 'ERROR', 'CRITICAL') THEN
    v_severity := 'ERROR';
  END IF;

  INSERT INTO public.automation_errors (
    correlation_id, simulation_id, initiating_user_id, environment, service,
    category, severity, automation_step, last_successful_step, message_redacted,
    stack_trace_redacted, error_code, attempt_count, fingerprint, initial_diagnosis,
    deploy_version, automation_version, vps_id, runtime, duration_ms, metadata
  ) VALUES (
    v_correlation,
    nullif(p_error ->> 'simulation_id', '')::uuid,
    nullif(p_error ->> 'initiating_user_id', '')::uuid,
    left(coalesce(nullif(p_error ->> 'environment', ''), 'production'), 80),
    left(coalesce(nullif(p_error ->> 'service', ''), 'credit-automation'), 120),
    v_category,
    v_severity,
    left(p_error ->> 'automation_step', 120),
    left(p_error ->> 'last_successful_step', 120),
    left(coalesce(nullif(p_error ->> 'message_redacted', ''), 'Erro sem mensagem.'), 4000),
    left(p_error ->> 'stack_trace_redacted', 12000),
    left(p_error ->> 'error_code', 160),
    least(greatest(coalesce((p_error ->> 'attempt_count')::integer, 1), 0), 999),
    v_fingerprint,
    left(p_error ->> 'initial_diagnosis', 4000),
    left(p_error ->> 'deploy_version', 160),
    left(p_error ->> 'automation_version', 160),
    left(p_error ->> 'vps_id', 160),
    left(p_error ->> 'runtime', 240),
    CASE WHEN (p_error ->> 'duration_ms') ~ '^[0-9]+$'
      THEN least((p_error ->> 'duration_ms')::bigint, 2147483647)::integer ELSE NULL END,
    coalesce(p_error -> 'metadata', '{}'::jsonb)
  )
  ON CONFLICT (correlation_id, fingerprint) DO UPDATE SET
    category = EXCLUDED.category,
    severity = EXCLUDED.severity,
    automation_step = EXCLUDED.automation_step,
    last_successful_step = EXCLUDED.last_successful_step,
    message_redacted = EXCLUDED.message_redacted,
    stack_trace_redacted = EXCLUDED.stack_trace_redacted,
    error_code = EXCLUDED.error_code,
    attempt_count = greatest(public.automation_errors.attempt_count, EXCLUDED.attempt_count),
    occurrence_count = public.automation_errors.occurrence_count + 1,
    initial_diagnosis = EXCLUDED.initial_diagnosis,
    deploy_version = EXCLUDED.deploy_version,
    automation_version = EXCLUDED.automation_version,
    vps_id = EXCLUDED.vps_id,
    runtime = EXCLUDED.runtime,
    duration_ms = EXCLUDED.duration_ms,
    metadata = public.automation_errors.metadata || EXCLUDED.metadata,
    last_seen_at = clock_timestamp(),
    updated_at = clock_timestamp()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_automation_error(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_automation_error(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.start_automation_repair(p_error_id uuid)
RETURNS public.repair_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_error public.automation_errors%ROWTYPE;
  v_job public.repair_jobs%ROWTYPE;
BEGIN
  IF NOT public.is_automation_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso restrito aos administradores.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_error
  FROM public.automation_errors
  WHERE id = p_error_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Erro de automacao nao encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_error.status = 'CORRIGIDO' THEN
    RAISE EXCEPTION 'Este erro ja foi corrigido e validado.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job
  FROM public.repair_jobs
  WHERE error_id = p_error_id
    AND status IN (
      'QUEUED', 'COLLECTING_CONTEXT', 'DIAGNOSING', 'SNAPSHOTTING',
      'REPAIRING', 'RESTARTING', 'VALIDATING', 'ROLLING_BACK'
    )
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN v_job;
  END IF;

  INSERT INTO public.repair_jobs(error_id, service, requested_by)
  VALUES (p_error_id, v_error.service, auth.uid())
  RETURNING * INTO v_job;

  UPDATE public.automation_errors
  SET current_repair_job_id = v_job.id,
      status = 'ANALISANDO',
      updated_at = clock_timestamp()
  WHERE id = p_error_id;

  INSERT INTO public.internal_audit_logs(
    actor_user_id, actor_role, action, table_name, record_id, after
  ) VALUES (
    auth.uid(), 'admin', 'iniciar_reparo_automacao', 'repair_jobs', v_job.id,
    jsonb_build_object('error_id', p_error_id, 'correlation_id', v_error.correlation_id)
  );

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.start_automation_repair(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_automation_repair(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_next_repair_job(p_worker_id text)
RETURNS SETOF public.repair_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_job public.repair_jobs%ROWTYPE;
  v_lock public.repair_locks%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF length(trim(coalesce(p_worker_id, ''))) < 3 OR length(p_worker_id) > 160 THEN
    RAISE EXCEPTION 'Worker invalido.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.repair_jobs
  SET status = 'QUEUED',
      stage_message = 'Job recuperado apos perda de lease.',
      next_attempt_at = v_now,
      worker_id = NULL,
      lease_expires_at = NULL,
      updated_at = v_now
  WHERE status IN (
      'COLLECTING_CONTEXT', 'DIAGNOSING', 'SNAPSHOTTING', 'REPAIRING',
      'RESTARTING', 'VALIDATING', 'ROLLING_BACK'
    )
    AND lease_expires_at IS NOT NULL
    AND lease_expires_at < v_now
    AND attempt_count < max_attempts;

  SELECT * INTO v_lock
  FROM public.repair_locks
  WHERE lock_key = 'credit-automation-repair'
  FOR UPDATE;

  IF FOUND AND v_lock.lease_expires_at > v_now AND v_lock.worker_id IS DISTINCT FROM p_worker_id THEN
    RETURN;
  END IF;

  SELECT * INTO v_job
  FROM public.repair_jobs
  WHERE status = 'QUEUED'
    AND next_attempt_at <= v_now
    AND attempt_count < max_attempts
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    DELETE FROM public.repair_locks
    WHERE lock_key = 'credit-automation-repair' AND lease_expires_at <= v_now;
    RETURN;
  END IF;

  UPDATE public.repair_jobs
  SET status = 'COLLECTING_CONTEXT',
      progress = 5,
      stage_message = 'Coletando contexto tecnico.',
      worker_id = p_worker_id,
      attempt_count = attempt_count + 1,
      lease_expires_at = v_now + interval '2 minutes',
      started_at = coalesce(started_at, v_now),
      updated_at = v_now
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  INSERT INTO public.repair_locks(lock_key, job_id, worker_id, lease_expires_at, acquired_at, updated_at)
  VALUES ('credit-automation-repair', v_job.id, p_worker_id, v_now + interval '2 minutes', v_now, v_now)
  ON CONFLICT (lock_key) DO UPDATE SET
    job_id = EXCLUDED.job_id,
    worker_id = EXCLUDED.worker_id,
    lease_expires_at = EXCLUDED.lease_expires_at,
    acquired_at = EXCLUDED.acquired_at,
    updated_at = EXCLUDED.updated_at;

  RETURN NEXT v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_repair_job(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_repair_job(text) TO service_role;

CREATE OR REPLACE FUNCTION public.renew_repair_job_lease(p_job_id uuid, p_worker_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.repair_jobs
  SET lease_expires_at = clock_timestamp() + interval '2 minutes', updated_at = clock_timestamp()
  WHERE id = p_job_id AND worker_id = p_worker_id
    AND status NOT IN ('SUCCESS', 'FAILED', 'ROLLED_BACK', 'MANUAL_REQUIRED');
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 1 THEN
    UPDATE public.repair_locks
    SET lease_expires_at = clock_timestamp() + interval '2 minutes', updated_at = clock_timestamp()
    WHERE lock_key = 'credit-automation-repair' AND job_id = p_job_id AND worker_id = p_worker_id;
  END IF;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_repair_lock(p_job_id uuid, p_worker_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.repair_locks
  WHERE lock_key = 'credit-automation-repair' AND job_id = p_job_id AND worker_id = p_worker_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.renew_repair_job_lease(uuid, text),
  public.release_repair_lock(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_repair_job_lease(uuid, text),
  public.release_repair_lock(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.sync_automation_error_from_repair_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_error_status text;
BEGIN
  v_error_status := CASE NEW.status
    WHEN 'QUEUED' THEN 'ANALISANDO'
    WHEN 'COLLECTING_CONTEXT' THEN 'ANALISANDO'
    WHEN 'DIAGNOSING' THEN 'ANALISANDO'
    WHEN 'SNAPSHOTTING' THEN 'CORRIGINDO'
    WHEN 'REPAIRING' THEN 'CORRIGINDO'
    WHEN 'RESTARTING' THEN 'CORRIGINDO'
    WHEN 'VALIDATING' THEN 'VALIDANDO'
    WHEN 'SUCCESS' THEN 'CORRIGIDO'
    WHEN 'FAILED' THEN 'FALHOU'
    WHEN 'ROLLING_BACK' THEN 'CORRIGINDO'
    WHEN 'ROLLED_BACK' THEN 'ROLLBACK_REALIZADO'
    WHEN 'MANUAL_REQUIRED' THEN 'INTERVENCAO_NECESSARIA'
    ELSE 'ANALISANDO'
  END;

  UPDATE public.automation_errors
  SET status = v_error_status,
      current_repair_job_id = NEW.id,
      resolved_at = CASE WHEN NEW.status = 'SUCCESS' THEN clock_timestamp() ELSE resolved_at END,
      updated_at = clock_timestamp()
  WHERE id = NEW.error_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_automation_error_from_repair_job ON public.repair_jobs;
CREATE TRIGGER trg_sync_automation_error_from_repair_job
AFTER INSERT OR UPDATE OF status ON public.repair_jobs
FOR EACH ROW EXECUTE FUNCTION public.sync_automation_error_from_repair_job();

CREATE OR REPLACE FUNCTION public.touch_automation_recovery_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_automation_errors_updated_at ON public.automation_errors;
CREATE TRIGGER trg_automation_errors_updated_at BEFORE UPDATE ON public.automation_errors
FOR EACH ROW EXECUTE FUNCTION public.touch_automation_recovery_updated_at();
DROP TRIGGER IF EXISTS trg_repair_jobs_updated_at ON public.repair_jobs;
CREATE TRIGGER trg_repair_jobs_updated_at BEFORE UPDATE ON public.repair_jobs
FOR EACH ROW EXECUTE FUNCTION public.touch_automation_recovery_updated_at();
DROP TRIGGER IF EXISTS trg_system_health_updated_at ON public.system_health;
CREATE TRIGGER trg_system_health_updated_at BEFORE UPDATE ON public.system_health
FOR EACH ROW EXECUTE FUNCTION public.touch_automation_recovery_updated_at();

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['automation_errors', 'repair_jobs', 'repair_steps', 'system_health']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE public.automation_errors REPLICA IDENTITY FULL;
ALTER TABLE public.repair_jobs REPLICA IDENTITY FULL;
ALTER TABLE public.repair_steps REPLICA IDENTITY FULL;
ALTER TABLE public.system_health REPLICA IDENTITY FULL;

COMMENT ON TABLE public.automation_errors IS 'Erros finais e incidentes tecnicos sanitizados da automacao de credito.';
COMMENT ON TABLE public.repair_jobs IS 'Jobs persistentes e auditaveis de reparo; continuam sem a pagina administrativa aberta.';
COMMENT ON TABLE public.repair_steps IS 'Etapas reais de cada reparo usadas pela auditoria e pelo progresso no site/app.';
COMMENT ON TABLE public.repair_locks IS 'Lease distribuido que impede dois reparos simultaneos na automacao.';
COMMENT ON TABLE public.system_health IS 'Ultima leitura sanitizada de saude por componente da automacao.';
