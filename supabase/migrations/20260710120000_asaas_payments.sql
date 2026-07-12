-- Integracao Asaas para pagamentos internos da NOX Fianca.
-- Nao altera nem remove a integracao Cakto antiga; cria estrutura propria e segura.

ALTER TABLE public.consultas_credito
  ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS asaas_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS external_reference TEXT,
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS payment_value NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS payment_due_date DATE,
  ADD COLUMN IF NOT EXISTS payment_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_data JSONB;

ALTER TABLE public.inquilinos
  ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT;

CREATE TABLE IF NOT EXISTS public.asaas_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id UUID REFERENCES public.consultas_credito(id) ON DELETE SET NULL,
  proposal_id UUID REFERENCES public.consultas_credito(id) ON DELETE SET NULL,
  plan_id UUID REFERENCES public.planos(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  tenant_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  asaas_customer_id TEXT NOT NULL,
  asaas_payment_id TEXT,
  external_reference TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('pix', 'boleto', 'credit_card')),
  value NUMERIC(15,2) NOT NULL CHECK (value >= 0),
  status TEXT NOT NULL DEFAULT 'pending',
  due_date DATE,
  confirmed_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  pix_qr_code TEXT,
  pix_copy_paste TEXT,
  pix_expires_at TIMESTAMPTZ,
  boleto_url TEXT,
  boleto_barcode TEXT,
  raw_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_asaas_payments_asaas_payment_id
  ON public.asaas_payments (asaas_payment_id)
  WHERE asaas_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_asaas_payments_external_reference
  ON public.asaas_payments (external_reference);
CREATE UNIQUE INDEX IF NOT EXISTS idx_asaas_payments_idempotency_key
  ON public.asaas_payments (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_asaas_payments_consultation ON public.asaas_payments (consultation_id);
CREATE INDEX IF NOT EXISTS idx_asaas_payments_user ON public.asaas_payments (user_id);
CREATE INDEX IF NOT EXISTS idx_asaas_payments_status ON public.asaas_payments (status);

ALTER TABLE public.asaas_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own asaas payments" ON public.asaas_payments;
CREATE POLICY "Users read own asaas payments"
ON public.asaas_payments FOR SELECT
USING (
  auth.uid() = user_id
  OR auth.uid() = tenant_user_id
  OR EXISTS (
    SELECT 1 FROM public.consultas_credito c
    WHERE c.id = asaas_payments.consultation_id
      AND (
        c.profile_id_solicitante = auth.uid()
        OR c.tenant_user_id = auth.uid()
        OR c.billing_responsible_user_id = auth.uid()
      )
  )
  OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'financeiro')
);

CREATE TABLE IF NOT EXISTS public.asaas_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payment_id TEXT,
  external_reference TEXT,
  payload_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'received',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_asaas_webhook_events_event_id
  ON public.asaas_webhook_events (event_id);
CREATE INDEX IF NOT EXISTS idx_asaas_webhook_events_payment_id
  ON public.asaas_webhook_events (payment_id);

ALTER TABLE public.asaas_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read asaas webhook events" ON public.asaas_webhook_events;
CREATE POLICY "Admins read asaas webhook events"
ON public.asaas_webhook_events FOR SELECT
USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'financeiro'));

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_updated_at_asaas_payments'
      AND tgrelid = 'public.asaas_payments'::regclass
  ) THEN
    CREATE TRIGGER set_updated_at_asaas_payments
      BEFORE UPDATE ON public.asaas_payments
      FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
END $$;
