-- Jobs de reparo que perderam o lease exatamente na última tentativa ficavam
-- eternamente em um estágio intermediário: não podiam mais ser reclamados e
-- também nunca chegavam a um estado terminal. Além de poluir a fila, esses
-- registros antigos podiam manter diagnósticos e reinícios desnecessários.

UPDATE public.repair_jobs
SET status = 'FAILED',
    progress = 100,
    stage_message = 'Limite de tentativas atingido; job encerrado.',
    failure_reason = coalesce(
      nullif(failure_reason, ''),
      'O reparo perdeu o lease após esgotar todas as tentativas automáticas.'
    ),
    finished_at = coalesce(finished_at, clock_timestamp()),
    worker_id = NULL,
    lease_expires_at = NULL,
    updated_at = clock_timestamp()
WHERE status IN (
    'QUEUED', 'COLLECTING_CONTEXT', 'DIAGNOSING', 'SNAPSHOTTING', 'REPAIRING',
    'RESTARTING', 'VALIDATING', 'ROLLING_BACK'
  )
  AND attempt_count >= max_attempts
  AND (lease_expires_at IS NULL OR lease_expires_at < clock_timestamp());

DELETE FROM public.repair_locks AS repair_lock
USING public.repair_jobs AS repair_job
WHERE repair_lock.job_id = repair_job.id
  AND repair_job.status = 'FAILED'
  AND repair_job.attempt_count >= repair_job.max_attempts;

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

  -- Encerra primeiro leases vencidos cuja última tentativa já foi consumida.
  -- Um job com lease válido continua intocado para poder finalizar normalmente.
  UPDATE public.repair_jobs
  SET status = 'FAILED',
      progress = 100,
      stage_message = 'Limite de tentativas atingido; job encerrado.',
      failure_reason = coalesce(
        nullif(failure_reason, ''),
        'O reparo perdeu o lease após esgotar todas as tentativas automáticas.'
      ),
      finished_at = coalesce(finished_at, v_now),
      worker_id = NULL,
      lease_expires_at = NULL,
      updated_at = v_now
  WHERE status IN (
      'QUEUED', 'COLLECTING_CONTEXT', 'DIAGNOSING', 'SNAPSHOTTING', 'REPAIRING',
      'RESTARTING', 'VALIDATING', 'ROLLING_BACK'
    )
    AND attempt_count >= max_attempts
    AND (lease_expires_at IS NULL OR lease_expires_at < v_now);

  DELETE FROM public.repair_locks AS repair_lock
  USING public.repair_jobs AS repair_job
  WHERE repair_lock.job_id = repair_job.id
    AND repair_job.status = 'FAILED'
    AND repair_job.attempt_count >= repair_job.max_attempts;

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

COMMENT ON FUNCTION public.claim_next_repair_job(text) IS
  'Recupera leases interrompidos, encerra tentativas esgotadas e entrega um reparo por vez ao worker autorizado.';
