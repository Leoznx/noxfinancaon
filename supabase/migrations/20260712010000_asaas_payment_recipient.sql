-- Ate aqui, toda notificacao de pagamento (e-mail/SMS de boleto gerado e
-- confirmado) ia sempre pro inquilino (tenant_email/tenant_telefone da
-- consulta), ignorando o seletor "Imobiliaria/Inquilino" (payment_type/
-- billing_responsible_role, ja existente e preenchido em
-- consultas.$id.dados-complementares.lazy.tsx) que decide quem realmente
-- deve receber a cobranca. Esta migracao guarda o destinatario decidido no
-- MOMENTO da criacao do pagamento, direto na linha de asaas_payments -
-- o webhook (que nao tem sessao de usuario e roda bem depois) le esses
-- campos salvos em vez de re-derivar do contrato, entao o destinatario nunca
-- muda entre a cobranca ser criada e ela ser confirmada/vencer/estornar.
ALTER TABLE public.asaas_payments
  ADD COLUMN IF NOT EXISTS payment_responsible text CHECK (payment_responsible IN ('agency', 'tenant')),
  ADD COLUMN IF NOT EXISTS recipient_type text CHECK (recipient_type IN ('user', 'tenant')),
  ADD COLUMN IF NOT EXISTS recipient_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recipient_tenant_id uuid,
  ADD COLUMN IF NOT EXISTS recipient_name text,
  ADD COLUMN IF NOT EXISTS recipient_email text,
  ADD COLUMN IF NOT EXISTS recipient_phone text;

CREATE INDEX IF NOT EXISTS idx_asaas_payments_recipient_user ON public.asaas_payments (recipient_user_id);
