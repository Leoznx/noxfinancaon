-- Enriquecimento leve de auditoria no asaas-webhook: guarda a transicao de
-- status (old/new) e a fatura afetada em cima da tabela de eventos ja
-- existente, em vez de criar um sistema de auditoria financeira separado -
-- asaas_webhook_events ja guarda event_type/payload/processed_at/status, so
-- faltava a transicao em si e o vinculo com a mensalidade.
ALTER TABLE public.asaas_webhook_events
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.faturas_inquilino(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS old_status text,
  ADD COLUMN IF NOT EXISTS new_status text;
