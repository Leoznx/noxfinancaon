-- Boletos mensais futuros permanecem apenas programados no cronograma local.
-- O worker financeiro materializa a cobrança no Asaas sete dias antes do
-- vencimento, sem antecipar a emissão nem duplicar a competência.

CREATE INDEX IF NOT EXISTS faturas_inquilino_scheduled_boleto_due_idx
  ON public.faturas_inquilino (vencimento, id)
  WHERE status = 'scheduled'
    AND payment_method = 'boleto'
    AND asaas_payment_id IS NULL;

COMMENT ON INDEX public.faturas_inquilino_scheduled_boleto_due_idx IS
  'Busca dos boletos mensais que devem ser materializados sete dias antes do vencimento.';
