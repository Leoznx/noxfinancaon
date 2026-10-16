-- Legacy rows predate the durable queue and have no trustworthy request lease.
-- Keep recent, provably unclaimed rows eligible for processing, but never send an
-- old request to the provider merely because the migration backfilled it as queued.

UPDATE public.consultas_credito
SET
  technical_status = 'requires_verification',
  status = 'requer_verificacao',
  automation_step = 'migration-stale-queue',
  last_error_category = 'stale_legacy_request',
  error_message =
    'Solicitação anterior à fila durável; requer verificação antes de qualquer envio ao provedor.',
  updated_at = clock_timestamp()
WHERE origem = 'nox_financa'
  AND status = 'pendente'
  AND technical_status = 'queued'
  AND provider_submission_state = 'not_submitted'
  AND attempt_count = 0
  AND created_at < clock_timestamp() - interval '24 hours';

COMMENT ON COLUMN public.consultas_credito.last_error_category IS
  'Sanitized technical category. stale_legacy_request requires operator verification before provider submission.';
