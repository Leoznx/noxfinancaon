-- The owner explicitly chose not to send the 19 legacy queued simulations to Loft.
-- Keep the rows for audit/history, but make them permanently ineligible for claims.
-- The cutoff is immutable so requests created after the decision are never affected.

ALTER TABLE public.consultas_credito
  DROP CONSTRAINT IF EXISTS consultas_credito_technical_status_check,
  ADD CONSTRAINT consultas_credito_technical_status_check CHECK (
    technical_status IN (
      'received', 'queued', 'processing', 'waiting_provider', 'completed',
      'technical_failure', 'requires_verification', 'cancelled'
    )
  );

ALTER TABLE public.consultas_credito
  DROP CONSTRAINT IF EXISTS consultas_credito_status_check;

ALTER TABLE public.consultas_credito
  ADD CONSTRAINT consultas_credito_status_check CHECK (status = ANY (ARRAY[
    'pendente'::text,
    'processando'::text,
    'aprovado'::text,
    'recusado'::text,
    'em_analise'::text,
    'erro'::text,
    'requer_verificacao'::text,
    'cancelada'::text,
    'reprovado'::text,
    'pendente_documentacao'::text,
    'dados_complementares'::text,
    'finalizada'::text,
    'aguardando_ativacao'::text,
    'ativado'::text
  ]));

DO $$
DECLARE
  v_cancelled integer;
BEGIN
  UPDATE public.consultas_credito
  SET
    technical_status = 'cancelled',
    status = 'cancelada',
    resultado = NULL,
    automation_step = 'cancelada_sem_envio',
    mensagem = 'Solicitação encerrada sem envio. Faça uma nova simulação para consultar pela automação.',
    error_message = NULL,
    automation_finished_at = clock_timestamp(),
    worker_id = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    heartbeat_at = NULL,
    last_error_category = 'BACKLOG_CANCELLED_BY_OWNER',
    updated_at = clock_timestamp()
  WHERE origem = 'nox_financa'
    AND technical_status = 'queued'
    AND provider_submission_state = 'not_submitted'
    AND queue_enqueued_at <= timestamptz '2026-10-19 23:49:39.04028+00';

  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  IF v_cancelled <> 19 THEN
    RAISE EXCEPTION
      'Expected to cancel exactly 19 legacy queued simulations, cancelled % instead',
      v_cancelled;
  END IF;
END
$$;
