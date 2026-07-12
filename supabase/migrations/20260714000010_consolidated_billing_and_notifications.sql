-- Boleto consolidado da imobiliaria/corretor (reune faturas com
-- payment_responsible='agency' do mes vigente em uma cobranca so) e log de
-- idempotencia das notificacoes financeiras (e-mail/SMS/WhatsApp), tanto pras
-- 12 mensalidades individuais quanto pro lote consolidado.

CREATE TABLE IF NOT EXISTS public.consolidated_invoice_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reference_month int NOT NULL,
  reference_year int NOT NULL,
  total_value numeric(12,2) NOT NULL CHECK (total_value >= 0),
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paid', 'partial', 'cancelled')),
  asaas_customer_id text,
  asaas_payment_id text,
  external_reference text,
  invoice_url text,
  bank_slip_url text,
  identification_field text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.consolidated_invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.consolidated_invoice_batches(id) ON DELETE CASCADE,
  fatura_id uuid NOT NULL REFERENCES public.faturas_inquilino(id) ON DELETE CASCADE,
  tenant_user_id uuid,
  consulta_id uuid,
  original_value numeric(12,2) NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'paid_via_consolidated', 'cancelled_after_consolidation', 'manual_review_required')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- So pode existir 1 item ATIVO por fatura ao mesmo tempo — impede a mesma
-- mensalidade entrar em dois lotes consolidados simultaneamente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_consolidated_item
  ON public.consolidated_invoice_items(fatura_id) WHERE status = 'active';

ALTER TABLE public.faturas_inquilino
  DROP CONSTRAINT IF EXISTS faturas_inquilino_consolidated_item_id_fkey,
  ADD CONSTRAINT faturas_inquilino_consolidated_item_id_fkey
    FOREIGN KEY (consolidated_item_id) REFERENCES public.consolidated_invoice_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_consolidated_items_batch ON public.consolidated_invoice_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_consolidated_batches_agency ON public.consolidated_invoice_batches(agency_user_id);

ALTER TABLE public.consolidated_invoice_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consolidated_invoice_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage consolidated batches"
  ON public.consolidated_invoice_batches FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_internal_role(auth.uid(), 'admin_master'::internal_role) OR public.has_internal_role(auth.uid(), 'financeiro'::internal_role))
  WITH CHECK (public.is_admin(auth.uid()) OR public.has_internal_role(auth.uid(), 'admin_master'::internal_role) OR public.has_internal_role(auth.uid(), 'financeiro'::internal_role));

CREATE POLICY "Agency views own consolidated batches"
  ON public.consolidated_invoice_batches FOR SELECT TO authenticated
  USING (agency_user_id = auth.uid());

CREATE POLICY "Admins manage consolidated items"
  ON public.consolidated_invoice_items FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_internal_role(auth.uid(), 'admin_master'::internal_role) OR public.has_internal_role(auth.uid(), 'financeiro'::internal_role))
  WITH CHECK (public.is_admin(auth.uid()) OR public.has_internal_role(auth.uid(), 'admin_master'::internal_role) OR public.has_internal_role(auth.uid(), 'financeiro'::internal_role));

CREATE POLICY "Agency and tenant view consolidated items"
  ON public.consolidated_invoice_items FOR SELECT TO authenticated
  USING (
    tenant_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.consolidated_invoice_batches b
      WHERE b.id = consolidated_invoice_items.batch_id AND b.agency_user_id = auth.uid()
    )
  );

-- Log de idempotencia das notificacoes financeiras (e-mail/SMS/WhatsApp) —
-- tanto pra fatura individual (lembretes 10/5/0 dias) quanto pro lote
-- consolidado. A chave unica evita reenviar a mesma notificacao quando o
-- Asaas reentrega webhook ou o cron roda em cima da janela ja processada.
CREATE TABLE IF NOT EXISTS public.financial_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid REFERENCES public.faturas_inquilino(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES public.consolidated_invoice_batches(id) ON DELETE CASCADE,
  recipient_type text CHECK (recipient_type IN ('user', 'tenant')),
  recipient_id uuid,
  channel text NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp')),
  notification_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'not_configured')),
  provider_message_id text,
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_notification_invoice
  ON public.financial_notifications(invoice_id, channel, notification_type) WHERE invoice_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_notification_batch
  ON public.financial_notifications(batch_id, channel, notification_type) WHERE batch_id IS NOT NULL;

ALTER TABLE public.financial_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read financial notifications"
  ON public.financial_notifications FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_internal_role(auth.uid(), 'admin_master'::internal_role) OR public.has_internal_role(auth.uid(), 'financeiro'::internal_role));
