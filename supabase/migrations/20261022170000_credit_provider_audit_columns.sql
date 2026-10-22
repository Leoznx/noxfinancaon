-- The official DirectD flow writes provider audit metadata on the consultation.
-- Older environments had consumers for these fields, but no migration creating
-- them. Keep the columns nullable so existing consultations are not rewritten.

ALTER TABLE public.consultas_credito
  ADD COLUMN IF NOT EXISTS external_provider text,
  ADD COLUMN IF NOT EXISTS external_status text,
  ADD COLUMN IF NOT EXISTS external_request_id text,
  ADD COLUMN IF NOT EXISTS external_response jsonb,
  ADD COLUMN IF NOT EXISTS automacao_credpago_status text,
  ADD COLUMN IF NOT EXISTS automacao_credpago_resultado jsonb,
  ADD COLUMN IF NOT EXISTS provider_returned_at timestamptz,
  ADD COLUMN IF NOT EXISTS automacao_processed_at timestamptz;

COMMENT ON COLUMN public.consultas_credito.external_provider IS
  'Provider that produced the most recent external credit result.';
COMMENT ON COLUMN public.consultas_credito.external_status IS
  'Original provider status or score band for audit purposes.';
COMMENT ON COLUMN public.consultas_credito.external_request_id IS
  'Provider request identifier, when one is returned.';
COMMENT ON COLUMN public.consultas_credito.external_response IS
  'Sanitized provider response. Must not contain document, user or IP data.';
COMMENT ON COLUMN public.consultas_credito.automacao_credpago_status IS
  'Legacy-compatible normalized result field retained while consumers migrate.';
COMMENT ON COLUMN public.consultas_credito.automacao_credpago_resultado IS
  'Legacy-compatible structured result field retained while consumers migrate.';
COMMENT ON COLUMN public.consultas_credito.provider_returned_at IS
  'Timestamp at which the external provider returned a conclusive result.';
COMMENT ON COLUMN public.consultas_credito.automacao_processed_at IS
  'Timestamp at which the credit automation persisted its final result.';
