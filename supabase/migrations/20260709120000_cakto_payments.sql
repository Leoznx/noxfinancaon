-- =============================================================================
-- Integração de pagamento Cakto (Pix/Boleto/Cartão) — tela "Pagamento" em
-- src/routes/consultas.$id.finalizar.lazy.tsx.
-- Guarda toda cobrança criada via caktoService (src/lib/cakto.service.ts) e é
-- atualizada pelo webhook (supabase/functions/cakto-webhook) quando o status muda.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.cakto_payments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    cakto_payment_id TEXT,                 -- `id` retornado pela Cakto (ausente no fallback de cartão sem tokenização)
    cakto_ref_id TEXT,                     -- `refId` retornado pela Cakto
    status TEXT NOT NULL DEFAULT 'waiting_payment',
    payment_method TEXT NOT NULL,          -- pix | boleto | credit_card
    amount NUMERIC(15,2) NOT NULL,
    checkout_url TEXT,
    contract_id UUID,                      -- reservado para quando existir uma tabela de contratos
    consultation_id UUID REFERENCES public.consultas_credito(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    customer_phone TEXT,
    selected_fire_insurance_mode TEXT,     -- avista | embutido
    raw_response JSONB,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    paid_at TIMESTAMPTZ
);

COMMENT ON TABLE public.cakto_payments IS
  'Cobranças criadas via API da Cakto (pix/boleto/credit_card) a partir da tela de pagamento do seguro.';
COMMENT ON COLUMN public.cakto_payments.status IS
  'Status bruto da Cakto (waiting_payment, paid, approved, refused, canceled, refunded, chargeback) ou o local "redirected_to_checkout" para cartão sem tokenização.';

CREATE INDEX IF NOT EXISTS idx_cakto_payments_consultation ON public.cakto_payments (consultation_id);
CREATE INDEX IF NOT EXISTS idx_cakto_payments_contract ON public.cakto_payments (contract_id);
CREATE INDEX IF NOT EXISTS idx_cakto_payments_cakto_payment_id ON public.cakto_payments (cakto_payment_id);
CREATE INDEX IF NOT EXISTS idx_cakto_payments_cakto_ref_id ON public.cakto_payments (cakto_ref_id);

ALTER TABLE public.cakto_payments ENABLE ROW LEVEL SECURITY;

-- Mesma política permissiva já usada em consultas_credito (app própria, sem multi-tenant
-- por RLS) — o webhook usa o service role e ignora RLS de qualquer forma.
DROP POLICY IF EXISTS "App reads cakto_payments" ON public.cakto_payments;
CREATE POLICY "App reads cakto_payments" ON public.cakto_payments FOR SELECT USING (true);
DROP POLICY IF EXISTS "App inserts cakto_payments" ON public.cakto_payments;
CREATE POLICY "App inserts cakto_payments" ON public.cakto_payments FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "App updates cakto_payments" ON public.cakto_payments;
CREATE POLICY "App updates cakto_payments" ON public.cakto_payments FOR UPDATE USING (true);

-- Reaproveita a função já criada em 20260704180000_consultas_credito_worker_local.sql.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_updated_at_cakto_payments'
      AND tgrelid = 'public.cakto_payments'::regclass
  ) THEN
    CREATE TRIGGER set_updated_at_cakto_payments
      BEFORE UPDATE ON public.cakto_payments
      FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
END $$;
