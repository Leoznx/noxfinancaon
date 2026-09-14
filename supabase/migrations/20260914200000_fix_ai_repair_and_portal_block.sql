-- Corrige a classificacao do bloqueio comercial da Loft, encerra incidentes
-- gerados por ruido operacional e impede que "Reparar todos" repita jobs que
-- dependem de uma liberacao externa.

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/png', 'text/plain', 'application/json']::text[]
WHERE id = 'automation-error-artifacts';

-- Incidentes do proprio spool e avisos DBus do Chromium nao representam falha
-- da simulacao. Jobs ativos desses registros sao encerrados como corrigidos.
UPDATE public.repair_jobs AS job
SET status = 'SUCCESS',
    progress = 100,
    stage_message = 'Ruido operacional descartado; a coleta de erros continua ativa.',
    result_summary = 'O MIME do artefato foi corrigido e avisos DBus sem impacto passaram a ser ignorados.',
    failure_reason = NULL,
    finished_at = clock_timestamp(),
    lease_expires_at = NULL,
    updated_at = clock_timestamp()
FROM public.automation_errors AS error
WHERE error.id = job.error_id
  AND job.status NOT IN ('SUCCESS', 'ROLLED_BACK')
  AND error.message_redacted ~* (
    'Spool\s+[^[:space:]]+\.json\s+ainda nao pode ser enviado|' ||
    'Falha ao preservar erro no spool local|' ||
    'dbus/bus\.cc.*Failed to connect to (the )?bus'
  );

UPDATE public.automation_errors
SET status = 'CORRIGIDO',
    resolved_at = clock_timestamp(),
    initial_diagnosis = 'Ruido operacional sem impacto na simulacao; origem corrigida ou filtrada.',
    updated_at = clock_timestamp()
WHERE message_redacted ~* (
  'Spool\s+[^[:space:]]+\.json\s+ainda nao pode ser enviado|' ||
  'Falha ao preservar erro no spool local|' ||
  'dbus/bus\.cc.*Failed to connect to (the )?bus'
);

-- A pagina esta online e autenticada, mas a propria Loft informa que a conta
-- nao pode criar contratos. Isso nao e mudanca de seletor e nao deve ser
-- tentado tres vezes como se fosse um reparo de codigo.
UPDATE public.repair_jobs AS job
SET status = 'MANUAL_REQUIRED',
    progress = 100,
    stage_message = 'Acao externa necessaria; tentativas automaticas pausadas.',
    result_summary = 'A conta precisa ser liberada pelo time comercial da Loft antes de novas simulacoes.',
    failure_reason = 'CREDPAGO_ACCOUNT_BLOCKED: conta bloqueada pelo parceiro para criar contratos.',
    finished_at = clock_timestamp(),
    lease_expires_at = NULL,
    updated_at = clock_timestamp()
FROM public.automation_errors AS error
WHERE error.id = job.error_id
  AND job.status NOT IN ('SUCCESS', 'ROLLED_BACK', 'MANUAL_REQUIRED')
  AND error.message_redacted ~* (
    'CREDPAGO_ACCOUNT_BLOCKED|' ||
    'libera[cç][aã]o necess[aá]ria para criar contratos|' ||
    'plataforma de fian[cç]a.*bloquead[ao].*cria[cç][aã]o de contratos|' ||
    'solicite a libera[cç][aã]o.*time comercial da loft'
  );

UPDATE public.automation_errors
SET category = 'CREDPAGO_UNAVAILABLE',
    severity = 'ERROR',
    status = 'INTERVENCAO_NECESSARIA',
    initial_diagnosis = 'Conta autenticada, mas bloqueada pelo parceiro para criar contratos. Liberacao externa necessaria.',
    resolved_at = NULL,
    updated_at = clock_timestamp()
WHERE message_redacted ~* (
  'CREDPAGO_ACCOUNT_BLOCKED|' ||
  'libera[cç][aã]o necess[aá]ria para criar contratos|' ||
  'plataforma de fian[cç]a.*bloquead[ao].*cria[cç][aã]o de contratos|' ||
  'solicite a libera[cç][aã]o.*time comercial da loft'
);

-- Simulacoes que falharam antes de qualquer envio por causa desse bloqueio
-- voltam para a fila e ficam preservadas ate a conta ser liberada.
UPDATE public.consultas_credito AS consultation
SET status = 'pendente',
    resultado = NULL,
    mensagem = NULL,
    error_message = NULL,
    automation_started_at = NULL,
    automation_finished_at = NULL,
    automation_step = 'aguardando_liberacao_parceiro',
    updated_at = clock_timestamp()
WHERE consultation.status = 'erro'
  AND EXISTS (
    SELECT 1
    FROM public.automation_errors AS error
    WHERE error.simulation_id = consultation.id
      AND coalesce(error.metadata ->> 'simulationSubmitted', 'false') = 'false'
      AND error.message_redacted ~* (
        'CREDPAGO_ACCOUNT_BLOCKED|' ||
        'libera[cç][aã]o necess[aá]ria para criar contratos|' ||
        'plataforma de fian[cç]a.*bloquead[ao].*cria[cç][aã]o de contratos|' ||
        'solicite a libera[cç][aã]o.*time comercial da loft'
      )
  );

CREATE OR REPLACE FUNCTION public.start_all_automation_repairs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_open integer;
  v_eligible integer;
  v_queued integer;
BEGIN
  IF NOT public.is_automation_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso restrito aos administradores.' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::integer INTO v_open
  FROM public.automation_errors
  WHERE status <> 'CORRIGIDO';

  SELECT count(*)::integer INTO v_eligible
  FROM public.automation_errors
  WHERE status IN ('NOVO', 'FALHOU', 'ROLLBACK_REALIZADO');

  WITH inserted AS (
    INSERT INTO public.repair_jobs(error_id, service, requested_by, stage_message)
    SELECT error.id, error.service, auth.uid(), 'Analise de IA em lote agendada pelo administrador.'
    FROM public.automation_errors AS error
    WHERE error.status IN ('NOVO', 'FALHOU', 'ROLLBACK_REALIZADO')
      AND NOT EXISTS (
        SELECT 1 FROM public.repair_jobs AS job
        WHERE job.error_id = error.id
          AND job.status IN (
            'QUEUED', 'COLLECTING_CONTEXT', 'DIAGNOSING', 'SNAPSHOTTING',
            'REPAIRING', 'RESTARTING', 'VALIDATING', 'ROLLING_BACK'
          )
      )
    ORDER BY error.last_seen_at
    ON CONFLICT DO NOTHING
    RETURNING id
  )
  SELECT count(*)::integer INTO v_queued FROM inserted;

  INSERT INTO public.internal_audit_logs(
    actor_user_id, actor_role, action, table_name, after
  ) VALUES (
    auth.uid(), 'admin', 'iniciar_reparos_ia_em_lote', 'repair_jobs',
    jsonb_build_object(
      'open_count', v_open,
      'eligible_count', v_eligible,
      'queued_count', v_queued,
      'skipped_count', v_open - v_queued
    )
  );

  RETURN jsonb_build_object(
    'open_count', v_open,
    'eligible_count', v_eligible,
    'queued_count', v_queued,
    'skipped_count', v_open - v_queued
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_all_automation_repairs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_all_automation_repairs() TO authenticated;

COMMENT ON FUNCTION public.start_all_automation_repairs() IS
  'Enfileira reparos automaticos elegiveis; bloqueios externos permanecem sinalizados sem retry em lote.';
