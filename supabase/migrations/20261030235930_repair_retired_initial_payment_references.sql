-- Cobranças iniciais canceladas tiveram a idempotency_key aposentada, mas as
-- versões anteriores mantiveram a external_reference canônica. Como ambas as
-- colunas são únicas, uma nova tentativa podia ser criada no Asaas e falhar ao
-- ser persistida localmente. Alinhamos a referência aposentada à chave já
-- versionada; pagamentos ativos não são alterados.
UPDATE public.asaas_payments AS payment
SET
  external_reference = payment.idempotency_key,
  updated_at = timezone('utc'::text, now())
WHERE payment.idempotency_key LIKE '%:retired:%'
  AND payment.external_reference IS DISTINCT FROM payment.idempotency_key
  AND lower(coalesce(payment.status, '')) IN (
    'cancelled',
    'canceled',
    'cancelado',
    'expired',
    'refused',
    'recusado',
    'failed',
    'falhou',
    'refunded',
    'estornado',
    'chargeback',
    'chargeback_dispute'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.asaas_payments AS current_payment
    WHERE current_payment.external_reference = payment.idempotency_key
      AND current_payment.id <> payment.id
  );
