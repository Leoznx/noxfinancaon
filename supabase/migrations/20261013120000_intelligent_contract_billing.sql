-- Fluxo inteligente de cobranca do contrato.
-- Esta migration apenas evolui estruturas existentes: pagamentos avulsos,
-- faturas, consolidacao e D4Sign continuam sendo as fontes historicas.

ALTER TABLE public.consultas_credito
  ADD COLUMN IF NOT EXISTS fire_insurance_payment_mode text NOT NULL DEFAULT 'embutido',
  ADD COLUMN IF NOT EXISTS card_setup_mode text,
  ADD COLUMN IF NOT EXISTS policy_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS signature_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payment_state text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payment_provider_event_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'consultas_fire_payment_mode_check'
      AND conrelid = 'public.consultas_credito'::regclass
  ) THEN
    ALTER TABLE public.consultas_credito ADD CONSTRAINT consultas_fire_payment_mode_check
      CHECK (fire_insurance_payment_mode IN ('avista', 'embutido')) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'consultas_card_setup_mode_check'
      AND conrelid = 'public.consultas_credito'::regclass
  ) THEN
    ALTER TABLE public.consultas_credito ADD CONSTRAINT consultas_card_setup_mode_check
      CHECK (card_setup_mode IS NULL OR card_setup_mode IN ('direct', 'checkout')) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'consultas_policy_status_check'
      AND conrelid = 'public.consultas_credito'::regclass
  ) THEN
    ALTER TABLE public.consultas_credito ADD CONSTRAINT consultas_policy_status_check
      CHECK (policy_status IN ('draft', 'issued_pending', 'active', 'cancelled')) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'consultas_signature_status_check'
      AND conrelid = 'public.consultas_credito'::regclass
  ) THEN
    ALTER TABLE public.consultas_credito ADD CONSTRAINT consultas_signature_status_check
      CHECK (signature_status IN ('pending', 'sent', 'signed', 'cancelled', 'error')) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'consultas_payment_state_check'
      AND conrelid = 'public.consultas_credito'::regclass
  ) THEN
    ALTER TABLE public.consultas_credito ADD CONSTRAINT consultas_payment_state_check
      CHECK (payment_state IN (
        'pending', 'awaiting_consolidation', 'processing', 'overdue', 'confirmed',
        'paid', 'refused', 'cancelled', 'refunded', 'chargeback'
      )) NOT VALID;
  END IF;
END $$;

UPDATE public.consultas_credito
SET payment_state = CASE
  WHEN lower(coalesce(payment_status, '')) IN ('paid', 'received', 'recebido') THEN 'paid'
  WHEN lower(coalesce(payment_status, '')) IN ('confirmed', 'confirmado', 'aprovado') THEN 'confirmed'
  WHEN lower(coalesce(payment_status, '')) IN (
    'processing', 'processando', 'risk_analysis', 'in_analysis', 'em_analise'
  ) THEN 'processing'
  WHEN lower(coalesce(payment_status, '')) IN ('overdue', 'vencido') THEN 'overdue'
  WHEN lower(coalesce(payment_status, '')) IN ('refused', 'recusado', 'failed', 'falhou') THEN 'refused'
  WHEN lower(coalesce(payment_status, '')) IN (
    'awaiting_consolidation', 'aguardando_consolidacao'
  ) THEN 'awaiting_consolidation'
  WHEN lower(coalesce(payment_status, '')) IN ('cancelled', 'canceled', 'cancelado') THEN 'cancelled'
  WHEN lower(coalesce(payment_status, '')) IN ('refunded', 'estornado') THEN 'refunded'
  WHEN lower(coalesce(payment_status, '')) IN ('chargeback', 'chargeback_dispute') THEN 'chargeback'
  ELSE 'pending'
END
WHERE payment_status IS NOT NULL OR payment_state IS NULL;

ALTER TABLE public.faturas_inquilino
  ALTER COLUMN tenant_user_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS billing_key text,
  ADD COLUMN IF NOT EXISTS charge_kind text NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS components jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS payment_url text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS asaas_subscription_id uuid,
  ADD COLUMN IF NOT EXISTS reference_month date,
  ADD COLUMN IF NOT EXISTS provider_event_at timestamptz;

ALTER TABLE public.consolidated_invoice_batches
  ADD COLUMN IF NOT EXISTS provider_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciliation_status text NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS reconciliation_error text,
  ADD COLUMN IF NOT EXISTS reconciliation_event_id text,
  ADD COLUMN IF NOT EXISTS reconciliation_locked_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'faturas_charge_kind_check'
      AND conrelid = 'public.faturas_inquilino'::regclass
  ) THEN
    ALTER TABLE public.faturas_inquilino ADD CONSTRAINT faturas_charge_kind_check
      CHECK (charge_kind IN ('initial', 'monthly', 'activation', 'adjustment')) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'faturas_payment_method_check'
      AND conrelid = 'public.faturas_inquilino'::regclass
  ) THEN
    ALTER TABLE public.faturas_inquilino ADD CONSTRAINT faturas_payment_method_check
      CHECK (payment_method IS NULL OR payment_method IN ('pix', 'boleto', 'credit_card', 'consolidated')) NOT VALID;
  END IF;
END $$;

-- O modelo legado numerava 12 mensalidades de 1 a 12 e mantinha a taxa
-- inicial fora de faturas. O novo modelo tambem materializa essa inicial;
-- incluir o tipo na unicidade preserva contratos antigos sem permitir duas
-- iniciais ou duas mensalidades da mesma competencia.
ALTER TABLE public.faturas_inquilino
  DROP CONSTRAINT IF EXISTS uq_fatura_parcela,
  DROP CONSTRAINT IF EXISTS uq_fatura_charge_parcela;
ALTER TABLE public.faturas_inquilino
  ADD CONSTRAINT uq_fatura_charge_parcela
  UNIQUE (consulta_id, charge_kind, numero_parcela);

UPDATE public.faturas_inquilino
SET billing_key = concat('legacy:', id, ':installment:', numero_parcela),
    reference_month = date_trunc('month', vencimento)::date
WHERE billing_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS faturas_inquilino_billing_key_uidx
  ON public.faturas_inquilino (billing_key) WHERE billing_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS faturas_inquilino_reference_idx
  ON public.faturas_inquilino (consulta_id, reference_month, charge_kind);

-- Reserva criada antes da chamada ao provedor. Uma chave representa uma unica
-- intencao financeira mesmo sob clique duplo, timeout ou retomada.
CREATE TABLE IF NOT EXISTS public.billing_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES public.consultas_credito(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES public.faturas_inquilino(id) ON DELETE SET NULL,
  operation_type text NOT NULL CHECK (operation_type IN (
    'payment', 'installment', 'subscription', 'checkout', 'notification', 'd4sign'
  )),
  idempotency_key text NOT NULL UNIQUE,
  request_hash text NOT NULL,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN (
    'reserved', 'provider_created', 'persisted', 'ambiguous', 'failed', 'cancelled'
  )),
  provider_id text,
  provider_response jsonb,
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  last_error text,
  locked_at timestamptz,
  completed_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.billing_operations
  ADD COLUMN IF NOT EXISTS request_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS billing_operations_consultation_idx
  ON public.billing_operations (consultation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS billing_operations_recovery_idx
  ON public.billing_operations (state, updated_at)
  WHERE state IN ('reserved', 'provider_created', 'ambiguous', 'failed');

DROP TRIGGER IF EXISTS billing_operations_touch_updated_at ON public.billing_operations;
CREATE TRIGGER billing_operations_touch_updated_at
BEFORE UPDATE ON public.billing_operations
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE IF NOT EXISTS public.asaas_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES public.consultas_credito(id) ON DELETE CASCADE,
  initial_invoice_id uuid REFERENCES public.faturas_inquilino(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  tenant_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  payment_responsible text NOT NULL CHECK (payment_responsible IN ('tenant', 'agency')),
  recipient_type text NOT NULL CHECK (recipient_type IN ('tenant', 'user')),
  recipient_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  recipient_tenant_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient_name text,
  recipient_email text,
  recipient_phone text,
  mode text NOT NULL CHECK (mode IN ('direct', 'checkout')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'active', 'suspended', 'cancelled', 'expired', 'error'
  )),
  card_registration_status text NOT NULL DEFAULT 'awaiting_card' CHECK (
    card_registration_status IN ('not_required', 'awaiting_card', 'registered', 'failed')
  ),
  payment_status text NOT NULL DEFAULT 'pending',
  asaas_customer_id text NOT NULL,
  asaas_subscription_id text,
  asaas_initial_checkout_id text,
  asaas_checkout_id text,
  initial_checkout_url text,
  checkout_url text,
  initial_checkout_status text NOT NULL DEFAULT 'pending' CHECK (
    initial_checkout_status IN ('pending', 'paid', 'cancelled', 'expired')
  ),
  checkout_status text NOT NULL DEFAULT 'pending' CHECK (
    checkout_status IN ('pending', 'paid', 'cancelled', 'expired')
  ),
  external_reference text NOT NULL,
  idempotency_key text NOT NULL,
  initial_amount numeric(15,2) NOT NULL CHECK (initial_amount >= 0),
  monthly_amount numeric(15,2) NOT NULL CHECK (monthly_amount > 0),
  next_due_date date NOT NULL,
  cycle text NOT NULL DEFAULT 'MONTHLY' CHECK (cycle = 'MONTHLY'),
  fire_insurance_payment_mode text NOT NULL DEFAULT 'embutido',
  split_initial_payment boolean NOT NULL DEFAULT false,
  raw_response jsonb,
  provider_event_at timestamptz,
  activated_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (external_reference),
  UNIQUE (idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS asaas_subscriptions_provider_uidx
  ON public.asaas_subscriptions (asaas_subscription_id)
  WHERE asaas_subscription_id IS NOT NULL;

ALTER TABLE public.asaas_subscriptions
  ADD COLUMN IF NOT EXISTS recurrence_start_date date,
  ADD COLUMN IF NOT EXISTS recurrence_end_date date,
  ADD COLUMN IF NOT EXISTS recurrence_total_payments integer;

UPDATE public.asaas_subscriptions
SET recurrence_start_date = coalesce(recurrence_start_date, next_due_date),
    recurrence_end_date = coalesce(
      recurrence_end_date,
      (next_due_date + interval '10 months')::date
    ),
    recurrence_total_payments = coalesce(recurrence_total_payments, 11)
WHERE recurrence_start_date IS NULL
   OR recurrence_end_date IS NULL
   OR recurrence_total_payments IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS asaas_subscriptions_checkout_uidx
  ON public.asaas_subscriptions (asaas_checkout_id)
  WHERE asaas_checkout_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS asaas_subscriptions_initial_checkout_uidx
  ON public.asaas_subscriptions (asaas_initial_checkout_id)
  WHERE asaas_initial_checkout_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS asaas_subscriptions_one_open_per_contract
  ON public.asaas_subscriptions (consultation_id)
  WHERE status IN ('pending', 'active', 'suspended');

DROP TRIGGER IF EXISTS asaas_subscriptions_touch_updated_at ON public.asaas_subscriptions;
CREATE TRIGGER asaas_subscriptions_touch_updated_at
BEFORE UPDATE ON public.asaas_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.faturas_inquilino
  DROP CONSTRAINT IF EXISTS faturas_inquilino_asaas_subscription_id_fkey;
ALTER TABLE public.faturas_inquilino
  ADD CONSTRAINT faturas_inquilino_asaas_subscription_id_fkey
  FOREIGN KEY (asaas_subscription_id) REFERENCES public.asaas_subscriptions(id) ON DELETE SET NULL;

ALTER TABLE public.asaas_payments
  ADD COLUMN IF NOT EXISTS billing_operation_id uuid REFERENCES public.billing_operations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS charge_kind text NOT NULL DEFAULT 'initial';

ALTER TABLE public.asaas_webhook_events
  ADD COLUMN IF NOT EXISTS resource_type text,
  ADD COLUMN IF NOT EXISTS resource_id text,
  ADD COLUMN IF NOT EXISTS provider_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;

CREATE INDEX IF NOT EXISTS asaas_webhook_events_retry_idx
  ON public.asaas_webhook_events (status, next_attempt_at, created_at)
  WHERE status IN ('received', 'error', 'retry');

-- Claim atomico: somente o INSERT vencedor processa um evento novo. Em uma
-- redelivery, apenas error/retry pode ser reaberto, e o UPDATE condicional
-- garante que no maximo um worker adquira o evento.
CREATE OR REPLACE FUNCTION public.claim_asaas_webhook_event(
  p_event_id text,
  p_event_type text,
  p_payment_id text,
  p_external_reference text,
  p_resource_type text,
  p_resource_id text,
  p_payload_hash text,
  p_payload jsonb
)
RETURNS TABLE(claimed boolean, event_status text, attempt_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  claimed_event public.asaas_webhook_events%ROWTYPE;
BEGIN
  INSERT INTO public.asaas_webhook_events (
    event_id,
    event_type,
    payment_id,
    external_reference,
    resource_type,
    resource_id,
    payload_hash,
    payload,
    status,
    attempts,
    locked_at
  ) VALUES (
    p_event_id,
    p_event_type,
    p_payment_id,
    p_external_reference,
    p_resource_type,
    p_resource_id,
    p_payload_hash,
    p_payload,
    'processing',
    1,
    now()
  )
  ON CONFLICT (event_id) DO NOTHING
  RETURNING * INTO claimed_event;

  IF claimed_event.id IS NOT NULL THEN
    RETURN QUERY SELECT true, claimed_event.status, claimed_event.attempts;
    RETURN;
  END IF;

  UPDATE public.asaas_webhook_events AS webhook_event
  SET status = 'processing',
      error_message = NULL,
      processed_at = NULL,
      attempts = webhook_event.attempts + 1,
      locked_at = now(),
      next_attempt_at = NULL
  WHERE webhook_event.event_id = p_event_id
    AND (
      (
        webhook_event.status IN ('error', 'retry')
        AND (webhook_event.next_attempt_at IS NULL OR webhook_event.next_attempt_at <= now())
      )
      OR (
        webhook_event.status = 'processing'
        AND webhook_event.locked_at < now() - interval '5 minutes'
      )
    )
  RETURNING webhook_event.* INTO claimed_event;

  IF claimed_event.id IS NOT NULL THEN
    RETURN QUERY SELECT true, claimed_event.status, claimed_event.attempts;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT false, webhook_event.status, webhook_event.attempts
  FROM public.asaas_webhook_events AS webhook_event
  WHERE webhook_event.event_id = p_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_asaas_webhook_event(
  text, text, text, text, text, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_asaas_webhook_event(
  text, text, text, text, text, text, text, jsonb
) TO service_role;

ALTER TABLE public.contract_signatures
  ADD COLUMN IF NOT EXISTS signature_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS provider_event_at timestamptz;

ALTER TABLE public.contract_signature_events
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'processed',
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS event_at timestamptz,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS error_message text;

CREATE OR REPLACE FUNCTION public.claim_contract_signature_event(
  p_signature_id uuid,
  p_event_key text,
  p_event_type text,
  p_message text,
  p_payload jsonb,
  p_event_at timestamptz
)
RETURNS TABLE(claimed boolean, event_status text, attempt_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  claimed_event public.contract_signature_events%ROWTYPE;
BEGIN
  INSERT INTO public.contract_signature_events (
    contract_signature_id, event_key, event_type, message, payload,
    status, attempts, event_at, locked_at
  ) VALUES (
    p_signature_id, p_event_key, p_event_type, left(p_message, 500), p_payload,
    'processing', 1, p_event_at, now()
  )
  ON CONFLICT (event_key) DO NOTHING
  RETURNING * INTO claimed_event;

  IF claimed_event.id IS NOT NULL THEN
    RETURN QUERY SELECT true, claimed_event.status, claimed_event.attempts;
    RETURN;
  END IF;

  UPDATE public.contract_signature_events AS signature_event
  SET status = 'processing',
      attempts = signature_event.attempts + 1,
      error_message = NULL,
      processed_at = NULL,
      locked_at = now(),
      next_attempt_at = NULL
  WHERE signature_event.event_key = p_event_key
    AND (
      (
        signature_event.status IN ('error', 'retry')
        AND (signature_event.next_attempt_at IS NULL OR signature_event.next_attempt_at <= now())
      )
      OR (
        signature_event.status = 'processing'
        AND signature_event.locked_at < now() - interval '5 minutes'
      )
    )
  RETURNING signature_event.* INTO claimed_event;

  IF claimed_event.id IS NOT NULL THEN
    RETURN QUERY SELECT true, claimed_event.status, claimed_event.attempts;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT false, signature_event.status, signature_event.attempts
  FROM public.contract_signature_events AS signature_event
  WHERE signature_event.event_key = p_event_key;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_contract_signature_event(
  uuid, text, text, text, jsonb, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_contract_signature_event(
  uuid, text, text, text, jsonb, timestamptz
) TO service_role;

UPDATE public.contract_signatures
SET signature_status = CASE status
  WHEN 'awaiting_signature' THEN 'sent'
  WHEN 'signed' THEN 'signed'
  WHEN 'active' THEN 'signed'
  WHEN 'cancelled' THEN 'cancelled'
  WHEN 'error' THEN 'error'
  ELSE 'pending'
END;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contract_signature_status_check'
      AND conrelid = 'public.contract_signatures'::regclass
  ) THEN
    ALTER TABLE public.contract_signatures ADD CONSTRAINT contract_signature_status_check
      CHECK (signature_status IN ('pending', 'sent', 'signed', 'cancelled', 'error')) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.apolices
  ADD COLUMN IF NOT EXISTS issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- Os defaults acima valem para contratos novos. Para o acervo existente,
-- derive os estados das fontes historicas em vez de apagar o progresso ja
-- alcancado por apolices e assinaturas anteriores a esta migration.
UPDATE public.consultas_credito AS consulta
SET policy_status = CASE
  WHEN lower(coalesce((
    SELECT apolice.status
    FROM public.apolices AS apolice
    WHERE apolice.consulta_id = consulta.id
    ORDER BY apolice.updated_at DESC, apolice.created_at DESC, apolice.id DESC
    LIMIT 1
  ), '')) IN ('ativa', 'active') THEN 'active'
  WHEN lower(coalesce((
    SELECT apolice.status
    FROM public.apolices AS apolice
    WHERE apolice.consulta_id = consulta.id
    ORDER BY apolice.updated_at DESC, apolice.created_at DESC, apolice.id DESC
    LIMIT 1
  ), '')) IN ('cancelada', 'cancelled', 'canceled') THEN 'cancelled'
  WHEN EXISTS (
    SELECT 1
    FROM public.apolices AS apolice
    WHERE apolice.consulta_id = consulta.id
  ) THEN 'issued_pending'
  ELSE 'draft'
END;

UPDATE public.consultas_credito AS consulta
SET signature_status = CASE
  WHEN assinatura.status IN ('signed', 'active') OR assinatura.signature_status = 'signed'
    THEN 'signed'
  WHEN assinatura.status = 'awaiting_signature' OR assinatura.signature_status = 'sent'
    THEN 'sent'
  WHEN assinatura.status = 'cancelled' OR assinatura.signature_status = 'cancelled'
    THEN 'cancelled'
  WHEN assinatura.status = 'error' OR assinatura.signature_status = 'error'
    THEN 'error'
  ELSE 'pending'
END
FROM public.contract_signatures AS assinatura
WHERE assinatura.consultation_id = consulta.id;

ALTER TABLE public.billing_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asaas_subscriptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.billing_operations FROM anon, authenticated;
GRANT ALL ON public.billing_operations TO service_role;
REVOKE ALL ON public.asaas_subscriptions FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.asaas_subscriptions FROM authenticated;
GRANT SELECT ON public.asaas_subscriptions TO authenticated;
GRANT ALL ON public.asaas_subscriptions TO service_role;

DROP POLICY IF EXISTS "Related users read Asaas subscriptions" ON public.asaas_subscriptions;
CREATE POLICY "Related users read Asaas subscriptions"
ON public.asaas_subscriptions FOR SELECT TO authenticated
USING (
  tenant_user_id = auth.uid()
  OR recipient_user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.consultas_credito c
    WHERE c.id = asaas_subscriptions.consultation_id
      AND (
        c.profile_id_solicitante = auth.uid()
        OR c.tenant_user_id = auth.uid()
        OR c.billing_responsible_user_id = auth.uid()
        OR public.eh_dono_ou_imobiliaria_da_consulta(c.profile_id_solicitante)
        OR public.is_internal(auth.uid())
      )
  )
);

-- Historico de comunicacao pode ser consultado somente por pessoas ligadas a
-- fatura; payloads e contatos completos permanecem protegidos.
DROP POLICY IF EXISTS "Related users read financial notifications" ON public.financial_notifications;
CREATE POLICY "Related users read financial notifications"
ON public.financial_notifications FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.faturas_inquilino f
    JOIN public.consultas_credito c ON c.id = f.consulta_id
    WHERE f.id = financial_notifications.invoice_id
      AND (
        f.tenant_user_id = auth.uid()
        OR f.recipient_user_id = auth.uid()
        OR c.profile_id_solicitante = auth.uid()
        OR public.eh_dono_ou_imobiliaria_da_consulta(c.profile_id_solicitante)
        OR public.is_internal(auth.uid())
      )
  )
  OR EXISTS (
    SELECT 1 FROM public.consolidated_invoice_batches b
    WHERE b.id = financial_notifications.batch_id
      AND (b.agency_user_id = auth.uid() OR public.is_internal(auth.uid()))
  )
);

COMMENT ON TABLE public.billing_operations IS
  'Reserva idempotente anterior a chamadas Asaas; permite reconciliar timeouts sem duplicar cobrancas.';
COMMENT ON TABLE public.asaas_subscriptions IS
  'Assinaturas mensais e Checkouts oficiais do Asaas sem armazenamento de PAN/CVV.';
COMMENT ON COLUMN public.faturas_inquilino.billing_key IS
  'Chave deterministica por contrato/competencia/componente que impede mensalidade duplicada.';
