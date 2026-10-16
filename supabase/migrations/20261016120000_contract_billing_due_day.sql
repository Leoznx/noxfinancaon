-- Cada contrato passa a carregar o vencimento escolhido no checkout. O valor
-- global continua sendo apenas fallback para integrações antigas e rotinas
-- administrativas; novos clientes oferecem somente os seis dias comerciais.
ALTER TABLE public.consultas_credito
  ADD COLUMN IF NOT EXISTS billing_due_day smallint;

ALTER TABLE public.consultas_credito
  DROP CONSTRAINT IF EXISTS consultas_credito_billing_due_day_check;

ALTER TABLE public.consultas_credito
  ADD CONSTRAINT consultas_credito_billing_due_day_check
  CHECK (billing_due_day IS NULL OR billing_due_day IN (5, 10, 15, 20, 25, 28));

COMMENT ON COLUMN public.consultas_credito.billing_due_day IS
  'Dia de vencimento escolhido para a primeira cobrança e para as competências mensais do contrato.';

-- Quando uma proposta existente já possui uma data compatível, recupera a
-- escolha sem alterar cronogramas legados que usavam outros dias.
UPDATE public.consultas_credito
SET billing_due_day = EXTRACT(DAY FROM payment_due_date)::smallint
WHERE billing_due_day IS NULL
  AND payment_due_date IS NOT NULL
  AND EXTRACT(DAY FROM payment_due_date)::integer IN (5, 10, 15, 20, 25, 28);
