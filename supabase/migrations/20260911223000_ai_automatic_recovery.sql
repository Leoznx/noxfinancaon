-- A central passa a enfileirar toda nova ocorrencia automaticamente e oferece
-- um comando administrativo idempotente para reparar todas as falhas abertas.

CREATE OR REPLACE FUNCTION public.record_automation_error(p_error jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid;
  v_job_id uuid;
  v_correlation text := coalesce(nullif(p_error ->> 'correlation_id', ''), public.generate_nox_sim_correlation_id());
  v_fingerprint text := left(coalesce(nullif(p_error ->> 'fingerprint', ''), 'unknown'), 160);
  v_category text := coalesce(nullif(p_error ->> 'category', ''), 'UNKNOWN_ERROR');
  v_severity text := coalesce(nullif(p_error ->> 'severity', ''), 'ERROR');
  v_service text := left(coalesce(nullif(p_error ->> 'service', ''), 'credit-automation'), 120);
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
    v_service,
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
    status = CASE
      WHEN public.automation_errors.status IN ('ANALISANDO', 'CORRIGINDO', 'VALIDANDO')
        THEN public.automation_errors.status
      ELSE 'NOVO'
    END,
    resolved_at = CASE
      WHEN public.automation_errors.status IN ('ANALISANDO', 'CORRIGINDO', 'VALIDANDO')
        THEN public.automation_errors.resolved_at
      ELSE NULL
    END,
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

  INSERT INTO public.repair_jobs(error_id, service, requested_by, stage_message)
  VALUES (v_id, v_service, NULL, 'Análise de IA automática agendada ao detectar o erro.')
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_job_id;

  IF v_job_id IS NOT NULL THEN
    INSERT INTO public.internal_audit_logs(
      actor_user_id, actor_role, action, table_name, record_id, after
    ) VALUES (
      NULL, 'system', 'enfileirar_reparo_ia_automatico', 'repair_jobs', v_job_id,
      jsonb_build_object('error_id', v_id, 'correlation_id', v_correlation)
    );
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_automation_error(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_automation_error(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.start_all_automation_repairs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_open integer;
  v_queued integer;
BEGIN
  IF NOT public.is_automation_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso restrito aos administradores.' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::integer INTO v_open
  FROM public.automation_errors
  WHERE status <> 'CORRIGIDO';

  WITH inserted AS (
    INSERT INTO public.repair_jobs(error_id, service, requested_by, stage_message)
    SELECT e.id, e.service, auth.uid(), 'Análise de IA em lote agendada pelo administrador.'
    FROM public.automation_errors e
    WHERE e.status <> 'CORRIGIDO'
      AND NOT EXISTS (
        SELECT 1 FROM public.repair_jobs j
        WHERE j.error_id = e.id
          AND j.status IN (
            'QUEUED', 'COLLECTING_CONTEXT', 'DIAGNOSING', 'SNAPSHOTTING',
            'REPAIRING', 'RESTARTING', 'VALIDATING', 'ROLLING_BACK'
          )
      )
    ORDER BY e.last_seen_at
    ON CONFLICT DO NOTHING
    RETURNING id
  )
  SELECT count(*)::integer INTO v_queued FROM inserted;

  INSERT INTO public.internal_audit_logs(
    actor_user_id, actor_role, action, table_name, after
  ) VALUES (
    auth.uid(), 'admin', 'iniciar_reparos_ia_em_lote', 'repair_jobs',
    jsonb_build_object('open_count', v_open, 'queued_count', v_queued, 'skipped_count', v_open - v_queued)
  );

  RETURN jsonb_build_object(
    'open_count', v_open,
    'queued_count', v_queued,
    'skipped_count', v_open - v_queued
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_all_automation_repairs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_all_automation_repairs() TO authenticated;

-- Converte a nomenclatura e os jobs legados que paravam em 88%.
UPDATE public.repair_jobs
SET status = 'FAILED',
    progress = 100,
    stage_message = 'Job legado encaminhado para nova análise de IA automática.',
    failure_reason = 'O fluxo anterior foi substituído pela análise de IA automática.',
    finished_at = coalesce(finished_at, clock_timestamp()),
    lease_expires_at = NULL,
    updated_at = clock_timestamp()
WHERE status = 'MANUAL_REQUIRED';

UPDATE public.automation_errors
SET status = CASE WHEN status = 'INTERVENCAO_NECESSARIA' THEN 'NOVO' ELSE status END,
    resolved_at = CASE WHEN status = 'INTERVENCAO_NECESSARIA' THEN NULL ELSE resolved_at END,
    initial_diagnosis = replace(
      coalesce(initial_diagnosis, ''),
      'Analise humana necessaria.',
      'Analise de IA automatica agendada.'
    ),
    updated_at = clock_timestamp()
WHERE status = 'INTERVENCAO_NECESSARIA'
   OR initial_diagnosis LIKE '%Analise humana necessaria.%';

UPDATE public.repair_steps
SET message = replace(
  replace(message, 'Analise humana necessaria.', 'Analise de IA automatica agendada.'),
  'MANUAL_INTERVENTION', 'AI_DIAGNOSE_AND_RECOVER'
)
WHERE message LIKE '%Analise humana%'
   OR message LIKE '%MANUAL_INTERVENTION%';

-- Todos os erros atualmente abertos entram na fila uma vez; o indice parcial
-- impede duplicacao caso ja exista um reparo ativo.
INSERT INTO public.repair_jobs(error_id, service, requested_by, stage_message)
SELECT e.id, e.service, NULL, 'Análise de IA automática agendada para erro aberto.'
FROM public.automation_errors e
WHERE e.status <> 'CORRIGIDO'
  AND NOT EXISTS (
    SELECT 1 FROM public.repair_jobs j
    WHERE j.error_id = e.id
      AND j.status IN (
        'QUEUED', 'COLLECTING_CONTEXT', 'DIAGNOSING', 'SNAPSHOTTING',
        'REPAIRING', 'RESTARTING', 'VALIDATING', 'ROLLING_BACK'
      )
  )
ON CONFLICT DO NOTHING;

COMMENT ON FUNCTION public.start_all_automation_repairs() IS
  'Enfileira de forma idempotente a analise e o reparo automatico de todas as falhas abertas.';
