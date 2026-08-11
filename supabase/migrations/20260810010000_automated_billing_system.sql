-- Automacao de cobranca NOX: vencimento mensal no dia 10, segunda via com
-- juros/multa, consolidacao por responsavel, auditoria e atualizacao realtime.

ALTER TABLE public.consolidated_invoice_batches
  ADD COLUMN IF NOT EXISTS billing_method text NOT NULL DEFAULT 'boleto'
    CHECK (billing_method IN ('boleto', 'pix', 'undefined')),
  ADD COLUMN IF NOT EXISTS pix_qr_code text,
  ADD COLUMN IF NOT EXISTS pix_copy_paste text,
  ADD COLUMN IF NOT EXISTS pix_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_count integer NOT NULL DEFAULT 0 CHECK (invoice_count >= 0),
  ADD COLUMN IF NOT EXISTS received_value numeric(12,2) NOT NULL DEFAULT 0 CHECK (received_value >= 0),
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS automation_version integer NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_consolidated_batch_active_period
  ON public.consolidated_invoice_batches(agency_user_id, reference_year, reference_month)
  WHERE status IN ('active', 'partial');

CREATE TABLE IF NOT EXISTS public.billing_automation_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT true,
  dispatch_enabled boolean NOT NULL DEFAULT false,
  due_day smallint NOT NULL DEFAULT 10 CHECK (due_day BETWEEN 1 AND 28),
  pre_due_days smallint NOT NULL DEFAULT 1 CHECK (pre_due_days BETWEEN 0 AND 10),
  fine_percent numeric(5,2) NOT NULL DEFAULT 2.00 CHECK (fine_percent BETWEEN 0 AND 20),
  monthly_interest_percent numeric(5,2) NOT NULL DEFAULT 1.00 CHECK (monthly_interest_percent BETWEEN 0 AND 20),
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

INSERT INTO public.billing_automation_settings(id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.billing_automation_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance staff read billing automation settings"
  ON public.billing_automation_settings FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::internal_role)
    OR public.has_internal_role(auth.uid(), 'financeiro'::internal_role)
  );

CREATE TABLE IF NOT EXISTS public.payment_reissue_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES public.faturas_inquilino(id) ON DELETE SET NULL,
  batch_id uuid REFERENCES public.consolidated_invoice_batches(id) ON DELETE SET NULL,
  asaas_payment_id text,
  requested_method text NOT NULL CHECK (requested_method IN ('boleto', 'pix')),
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'completed', 'failed', 'not_payable')),
  amount numeric(12,2),
  due_date date,
  provider_status text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((invoice_id IS NOT NULL)::int + (batch_id IS NOT NULL)::int = 1)
);

CREATE INDEX IF NOT EXISTS payment_reissue_requests_actor_created_idx
  ON public.payment_reissue_requests(requested_by, created_at DESC);

ALTER TABLE public.payment_reissue_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own payment reissue requests"
  ON public.payment_reissue_requests FOR SELECT TO authenticated
  USING (
    requested_by = auth.uid()
    OR public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::internal_role)
    OR public.has_internal_role(auth.uid(), 'financeiro'::internal_role)
  );

CREATE TABLE IF NOT EXISTS public.whatsapp_billing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_message_id text NOT NULL UNIQUE,
  phone_hash text NOT NULL,
  requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES public.faturas_inquilino(id) ON DELETE SET NULL,
  batch_id uuid REFERENCES public.consolidated_invoice_batches(id) ON DELETE SET NULL,
  requested_method text NOT NULL CHECK (requested_method IN ('boleto', 'pix')),
  status text NOT NULL DEFAULT 'received' CHECK (
    status IN ('received', 'processing', 'completed', 'failed', 'not_found', 'ambiguous_phone', 'duplicate')
  ),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS whatsapp_billing_requests_actor_created_idx
  ON public.whatsapp_billing_requests(requested_by, created_at DESC);

ALTER TABLE public.whatsapp_billing_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance staff read WhatsApp billing requests"
  ON public.whatsapp_billing_requests FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::internal_role)
    OR public.has_internal_role(auth.uid(), 'financeiro'::internal_role)
  );

-- Cancelamentos preservam o valor historico, mas os links deixam de ser
-- utilizaveis imediatamente. Isso evita pagamento acidental de uma cobranca
-- removida e mantem a trilha contabil intacta.
CREATE OR REPLACE FUNCTION public.clear_cancelled_payment_artifacts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF lower(coalesce(NEW.status, '')) IN (
    'cancelled', 'refunded', 'partially_refunded', 'chargeback',
    'chargeback_dispute', 'refused', 'deleted'
  ) AND lower(coalesce(OLD.status, '')) IS DISTINCT FROM lower(coalesce(NEW.status, '')) THEN
    NEW.boleto_url := NULL;
    NEW.boleto_barcode := NULL;
    NEW.pix_qr_code := NULL;
    NEW.pix_copy_paste := NULL;
    NEW.pix_expires_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_cancelled_payment_artifacts ON public.asaas_payments;
CREATE TRIGGER trg_clear_cancelled_payment_artifacts
  BEFORE UPDATE OF status ON public.asaas_payments
  FOR EACH ROW EXECUTE FUNCTION public.clear_cancelled_payment_artifacts();

CREATE OR REPLACE FUNCTION public.clear_cancelled_invoice_artifacts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF lower(coalesce(NEW.status, '')) IN (
    'cancelled', 'refunded', 'partially_refunded', 'chargeback',
    'chargeback_dispute', 'refused', 'deleted'
  ) AND lower(coalesce(OLD.status, '')) IS DISTINCT FROM lower(coalesce(NEW.status, '')) THEN
    NEW.boleto_url := NULL;
    NEW.linha_digitavel := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_cancelled_invoice_artifacts ON public.faturas_inquilino;
CREATE TRIGGER trg_clear_cancelled_invoice_artifacts
  BEFORE UPDATE OF status ON public.faturas_inquilino
  FOR EACH ROW EXECUTE FUNCTION public.clear_cancelled_invoice_artifacts();

DO $$
DECLARE v_table_name text;
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY['asaas_payments', 'consolidated_invoice_batches'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = v_table_name
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table_name);
    END IF;
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', v_table_name);
  END LOOP;
END $$;

-- Totais financeiros canonicos: cobrancas canceladas/estornadas nunca entram;
-- uma fatura incluida em lote ativo tambem nao e contada individualmente.
CREATE OR REPLACE FUNCTION public.get_finance_dashboard_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_uid uuid := auth.uid(); v_result jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.can_manage_withdrawals(v_uid, 'view') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='WITHDRAWAL_FORBIDDEN';
  END IF;
  SELECT jsonb_build_object(
    'revenue_received_cents',
      coalesce((SELECT sum(round(value * 100)::bigint) FROM public.asaas_payments
                WHERE lower(status) IN ('paid','received')), 0)
      + coalesce((SELECT sum(round(total_value * 100)::bigint) FROM public.consolidated_invoice_batches
                  WHERE status = 'paid'), 0)
      + coalesce((SELECT sum(round(received_value * 100)::bigint) FROM public.consolidated_invoice_batches
                  WHERE status = 'partial'), 0)
      + coalesce((SELECT sum(round(amount * 100)::bigint) FROM public.cakto_payments
                  WHERE lower(status) IN ('paid','pago','approved','completed','confirmed')), 0),
    'revenue_pending_cents',
      coalesce((
        SELECT sum(round(p.value * 100)::bigint)
        FROM public.asaas_payments p
        WHERE lower(p.status) IN ('pending','created','waiting_payment','confirmed','overdue')
          AND NOT EXISTS (
            SELECT 1
            FROM public.faturas_inquilino f
            JOIN public.consolidated_invoice_items i
              ON i.id = f.consolidated_item_id AND i.status = 'active'
            JOIN public.consolidated_invoice_batches b
              ON b.id = i.batch_id AND b.status IN ('active','partial')
            WHERE f.asaas_payment_id = p.id
          )
      ), 0)
      + coalesce((SELECT sum(round(
                    CASE WHEN status = 'partial'
                      THEN greatest(total_value - received_value, 0)
                      ELSE total_value END * 100
                  )::bigint) FROM public.consolidated_invoice_batches
                  WHERE status IN ('active','partial')), 0)
      + coalesce((SELECT sum(round(amount * 100)::bigint) FROM public.cakto_payments
                  WHERE lower(status) IN ('pending','pendente','created','waiting_payment')), 0),
    'commissions_paid_cents',
      coalesce((SELECT sum(amount_cents) FROM public.withdrawal_requests WHERE status='PAID'), 0),
    'commissions_payable_cents',
      coalesce((SELECT sum(amount_cents) FROM public.comissoes WHERE status='AVAILABLE'), 0)
      + coalesce((SELECT sum(amount_cents) FROM public.withdrawal_commissions WHERE active), 0),
    'open_withdrawals',
      (SELECT count(*) FROM public.withdrawal_requests
       WHERE status IN ('PENDING_REVIEW','APPROVED','AWAITING_PAYMENT','MANUAL_REVIEW')),
    'pending_review_withdrawals',
      (SELECT count(*) FROM public.withdrawal_requests WHERE status='PENDING_REVIEW'),
    'paid_withdrawals',
      (SELECT count(*) FROM public.withdrawal_requests WHERE status='PAID'),
    'commission_count', (SELECT count(*) FROM public.comissoes),
    'payment_count',
      (SELECT count(*) FROM public.asaas_payments WHERE lower(status) IN ('paid','received'))
      + (SELECT count(*) FROM public.consolidated_invoice_batches WHERE status='paid')
      + (SELECT count(*) FROM public.cakto_payments WHERE lower(status) IN ('paid','pago','approved','completed','confirmed'))
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- O cron roda diariamente porque o lembrete da vespera tambem pode cair no
-- fim de semana. A funcao restringe os atrasos aos dias uteis e escolhe as
-- 2 ou 4 janelas comerciais de forma idempotente.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    PERFORM cron.unschedule('lembretes-faturas-inquilino')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lembretes-faturas-inquilino');
    PERFORM cron.unschedule('automacao-cobranca-nox')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'automacao-cobranca-nox');

    PERFORM cron.schedule(
      'automacao-cobranca-nox',
      '0 12-20 * * *',
      $cron$
      SELECT net.http_post(
        url := 'https://njheoytyidsghittjilr.supabase.co/functions/v1/process-scheduled-invoice-notifications',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_notifications_secret')
        ),
        body := '{}'::jsonb
      );
      $cron$
    );
  END IF;
END $$;
