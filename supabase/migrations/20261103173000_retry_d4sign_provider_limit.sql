-- Recupera automaticamente os envios da D4Sign bloqueados exclusivamente
-- pela cota da conta. Outros erros permanecem manuais para evitar duplicar
-- notificações externas quando o resultado de sendtosigner for ambíguo.

ALTER TABLE public.contract_signatures
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS retry_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_retry_at timestamptz;

CREATE INDEX IF NOT EXISTS contract_signatures_d4sign_retry_idx
  ON public.contract_signatures (next_retry_at, created_at)
  WHERE status = 'error'
    AND error_code = 'd4sign_provider_limit'
    AND next_retry_at IS NOT NULL;

UPDATE public.contract_signatures
SET error_code = 'd4sign_provider_limit',
    retry_count = 0,
    next_retry_at = now(),
    retry_locked_at = NULL
WHERE status = 'error'
  AND lower(coalesce(error_message, '')) LIKE '%no more limits to send documents%';

CREATE OR REPLACE FUNCTION public.claim_d4sign_signature_retries(
  p_limit integer DEFAULT 10
)
RETURNS TABLE(signature_id uuid, consultation_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT signature.id
    FROM public.contract_signatures AS signature
    JOIN public.consultas_credito AS consultation
      ON consultation.id = signature.consultation_id
    WHERE signature.status = 'error'
      AND signature.error_code = 'd4sign_provider_limit'
      AND signature.next_retry_at <= now()
      AND signature.retry_count < 48
      AND coalesce(consultation.policy_status, '') <> 'cancelled'
      AND (
        signature.retry_locked_at IS NULL
        OR signature.retry_locked_at < now() - interval '20 minutes'
      )
    ORDER BY signature.next_retry_at, signature.created_at
    FOR UPDATE OF signature SKIP LOCKED
    LIMIT least(25, greatest(1, coalesce(p_limit, 10)))
  ), claimed AS (
    UPDATE public.contract_signatures AS signature
    SET retry_locked_at = now(),
        last_retry_at = now()
    FROM candidates
    WHERE signature.id = candidates.id
    RETURNING signature.id, signature.consultation_id
  )
  SELECT claimed.id, claimed.consultation_id
  FROM claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_d4sign_signature_retries(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_d4sign_signature_retries(integer) FROM anon;
REVOKE ALL ON FUNCTION public.claim_d4sign_signature_retries(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_d4sign_signature_retries(integer) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    CREATE EXTENSION IF NOT EXISTS pg_net;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron/pg_net não puderam ser habilitados: %', SQLERRM;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
     AND EXISTS (
       SELECT 1 FROM vault.decrypted_secrets
       WHERE name = 'cron_notifications_secret'
         AND nullif(decrypted_secret, '') IS NOT NULL
     ) THEN
    PERFORM cron.unschedule('retry-d4sign-provider-limit')
      WHERE EXISTS (
        SELECT 1 FROM cron.job WHERE jobname = 'retry-d4sign-provider-limit'
      );

    PERFORM cron.schedule(
      'retry-d4sign-provider-limit',
      '*/15 * * * *',
      $cron$
      SELECT net.http_post(
        url := 'https://njheoytyidsghittjilr.supabase.co/functions/v1/process-d4sign-retries',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'cron_notifications_secret'
          )
        ),
        body := '{"limit":10}'::jsonb
      );
      $cron$
    );
  ELSE
    RAISE NOTICE 'Retry D4Sign não agendado: pg_cron, pg_net ou segredo indisponível.';
  END IF;
END $$;

COMMENT ON FUNCTION public.claim_d4sign_signature_retries(integer) IS
  'Reserva, com SKIP LOCKED, envios D4Sign bloqueados somente pela cota do provedor.';
