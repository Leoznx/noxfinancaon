-- Mantem a causa tecnica detectavel internamente, mas impede que a marca e a
-- URL do provedor de credito aparecam no site, no aplicativo ou na Central de
-- Erros. A mensagem ao cliente permanece neutra e orientada a disponibilidade.

CREATE OR REPLACE FUNCTION public.redact_credit_provider_brand(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    ELSE regexp_replace(
      regexp_replace(
        p_value,
        $provider_url$https?://[^[:space:]'"<>]*loft[^[:space:]'"<>]*$provider_url$,
        '[PORTAL_DO_PARCEIRO]',
        'gi'
      ),
      $provider_name$\mloft\M$provider_name$,
      'parceiro de credito',
      'gi'
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_credpago_partner_block_error()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_partner_block boolean;
BEGIN
  v_partner_block := NEW.message_redacted ~* (
    'CREDPAGO_ACCOUNT_BLOCKED|' ||
    'libera[cç][aã]o necess[aá]ria para criar contratos|' ||
    'plataforma de fian[cç]a.*bloquead[ao].*cria[cç][aã]o de contratos|' ||
    'solicite a libera[cç][aã]o.*time comercial da loft'
  );

  NEW.message_redacted := public.redact_credit_provider_brand(NEW.message_redacted);
  NEW.stack_trace_redacted := public.redact_credit_provider_brand(NEW.stack_trace_redacted);
  NEW.initial_diagnosis := public.redact_credit_provider_brand(NEW.initial_diagnosis);
  NEW.metadata := public.redact_credit_provider_brand(NEW.metadata::text)::jsonb;
  NEW.artifacts := public.redact_credit_provider_brand(NEW.artifacts::text)::jsonb;

  IF v_partner_block THEN
    NEW.category := 'CREDPAGO_UNAVAILABLE';
    NEW.severity := 'ERROR';
    NEW.status := 'INTERVENCAO_NECESSARIA';
    NEW.initial_diagnosis :=
      'O servico externo de analise bloqueou a criacao de contratos. Liberacao do parceiro necessaria.';
    NEW.resolved_at := NULL;

    IF NEW.simulation_id IS NOT NULL THEN
      UPDATE public.consultas_credito
      SET status = 'erro',
          resultado = 'erro',
          automation_step = 'aguardando_liberacao_parceiro',
          mensagem =
            'O servico de analise de credito esta temporariamente indisponivel. Sua consulta foi salva com seguranca. Tente novamente mais tarde.',
          error_message =
            'O servico de analise de credito esta temporariamente indisponivel. Sua consulta foi salva com seguranca. Tente novamente mais tarde.',
          automation_finished_at = coalesce(automation_finished_at, clock_timestamp()),
          updated_at = clock_timestamp()
      WHERE id = NEW.simulation_id
        AND status IN ('pendente', 'processando', 'erro');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_credpago_partner_block_repair()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status NOT IN ('SUCCESS', 'ROLLED_BACK', 'MANUAL_REQUIRED')
    AND EXISTS (
      SELECT 1
      FROM public.automation_errors AS error
      WHERE error.id = NEW.error_id
        AND (
          error.category = 'CREDPAGO_UNAVAILABLE'
          OR error.message_redacted ~* (
            'CREDPAGO_ACCOUNT_BLOCKED|' ||
            'libera[cç][aã]o necess[aá]ria para criar contratos|' ||
            'plataforma de fian[cç]a.*bloquead[ao].*cria[cç][aã]o de contratos'
          )
        )
    )
  THEN
    NEW.status := 'MANUAL_REQUIRED';
    NEW.progress := 100;
    NEW.stage_message := 'Liberacao externa necessaria; tentativas automaticas pausadas.';
    NEW.result_summary :=
      'O servico de analise precisa ser liberado pelo parceiro antes de novas simulacoes.';
    NEW.failure_reason :=
      'CREDPAGO_ACCOUNT_BLOCKED: servico externo bloqueado para criar contratos.';
    NEW.finished_at := coalesce(NEW.finished_at, clock_timestamp());
    NEW.lease_expires_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- Remove a identificacao do provedor de todos os dados ja exibidos pela Central.
UPDATE public.automation_errors
SET message_redacted = public.redact_credit_provider_brand(message_redacted),
    stack_trace_redacted = public.redact_credit_provider_brand(stack_trace_redacted),
    initial_diagnosis = CASE
      WHEN category = 'CREDPAGO_UNAVAILABLE' THEN
        'O servico externo de analise bloqueou a criacao de contratos. Liberacao do parceiro necessaria.'
      ELSE public.redact_credit_provider_brand(initial_diagnosis)
    END,
    metadata = public.redact_credit_provider_brand(metadata::text)::jsonb,
    artifacts = public.redact_credit_provider_brand(artifacts::text)::jsonb
WHERE concat_ws(
  ' ',
  message_redacted,
  stack_trace_redacted,
  initial_diagnosis,
  metadata::text,
  artifacts::text
) ~* '\mloft\M';

UPDATE public.repair_jobs AS job
SET stage_message = CASE
      WHEN error.category = 'CREDPAGO_UNAVAILABLE' THEN
        'Liberacao externa necessaria; tentativas automaticas pausadas.'
      ELSE public.redact_credit_provider_brand(job.stage_message)
    END,
    diagnosis = public.redact_credit_provider_brand(job.diagnosis),
    result_summary = CASE
      WHEN error.category = 'CREDPAGO_UNAVAILABLE' THEN
        'O servico de analise precisa ser liberado pelo parceiro antes de novas simulacoes.'
      ELSE public.redact_credit_provider_brand(job.result_summary)
    END,
    failure_reason = public.redact_credit_provider_brand(job.failure_reason),
    rollback_reason = public.redact_credit_provider_brand(job.rollback_reason),
    snapshot = public.redact_credit_provider_brand(job.snapshot::text)::jsonb
FROM public.automation_errors AS error
WHERE error.id = job.error_id
  AND (
    error.category = 'CREDPAGO_UNAVAILABLE'
    OR concat_ws(
      ' ',
      job.stage_message,
      job.diagnosis,
      job.result_summary,
      job.failure_reason,
      job.rollback_reason,
      job.snapshot::text
    ) ~* '\mloft\M'
  );

UPDATE public.repair_steps
SET message = public.redact_credit_provider_brand(message),
    details = public.redact_credit_provider_brand(details::text)::jsonb
WHERE concat_ws(' ', message, details::text) ~* '\mloft\M';

UPDATE public.system_health
SET summary = public.redact_credit_provider_brand(summary),
    metrics = public.redact_credit_provider_brand(metrics::text)::jsonb
WHERE concat_ws(' ', summary, metrics::text) ~* '\mloft\M';

UPDATE public.consultas_credito
SET mensagem =
      'O servico de analise de credito esta temporariamente indisponivel. Sua consulta foi salva com seguranca. Tente novamente mais tarde.',
    error_message =
      'O servico de analise de credito esta temporariamente indisponivel. Sua consulta foi salva com seguranca. Tente novamente mais tarde.',
    updated_at = clock_timestamp()
WHERE automation_step = 'aguardando_liberacao_parceiro'
   OR concat_ws(' ', mensagem, error_message) ~* '\mloft\M';

UPDATE public.internal_audit_logs
SET "before" = public.redact_credit_provider_brand("before"::text)::jsonb,
    "after" = public.redact_credit_provider_brand("after"::text)::jsonb
WHERE concat_ws(' ', "before"::text, "after"::text) ~* '\mloft\M';

REVOKE ALL ON FUNCTION public.redact_credit_provider_brand(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redact_credit_provider_brand(text) TO service_role;
REVOKE ALL ON FUNCTION public.normalize_credpago_partner_block_error() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_credpago_partner_block_repair() FROM PUBLIC;

COMMENT ON FUNCTION public.redact_credit_provider_brand(text) IS
  'Remove a identificacao do provedor de credito de textos e artefatos exibidos pela plataforma.';
COMMENT ON FUNCTION public.normalize_credpago_partner_block_error() IS
  'Normaliza bloqueios externos e mantem a mensagem da consulta neutra para workers legados.';
COMMENT ON FUNCTION public.guard_credpago_partner_block_repair() IS
  'Impede retries automaticos quando o servico de analise depende de liberacao externa.';
