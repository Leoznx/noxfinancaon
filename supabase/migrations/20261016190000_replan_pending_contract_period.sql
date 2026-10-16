-- Permite trocar somente o prazo de uma proposta ainda nao efetivada. O fluxo
-- autenticado da Edge Function pausa novas criacoes financeiras, cancela os
-- artefatos futuros pendentes no provedor e preserva a cobranca inicial e os
-- demais dados da proposta.
ALTER TABLE public.consultas_credito
  ADD COLUMN IF NOT EXISTS contract_period_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS contract_period_change_pending_at timestamptz,
  ADD COLUMN IF NOT EXISTS contract_period_change_pending_months integer;

ALTER TABLE public.consultas_credito
  DROP CONSTRAINT IF EXISTS consultas_credito_contract_period_revision_check;

ALTER TABLE public.consultas_credito
  ADD CONSTRAINT consultas_credito_contract_period_revision_check
  CHECK (contract_period_revision >= 0);

ALTER TABLE public.consultas_credito
  DROP CONSTRAINT IF EXISTS consultas_credito_contract_period_change_pending_check;

ALTER TABLE public.consultas_credito
  ADD CONSTRAINT consultas_credito_contract_period_change_pending_check
  CHECK (
    (contract_period_change_pending_at IS NULL AND contract_period_change_pending_months IS NULL)
    OR (
      contract_period_change_pending_at IS NOT NULL
      AND contract_period_change_pending_months BETWEEN 1 AND 120
    )
  );

COMMENT ON COLUMN public.consultas_credito.contract_period_revision IS
  'Versao do cronograma financeiro. E incrementada quando um prazo ainda nao efetivado e replanejado.';
COMMENT ON COLUMN public.consultas_credito.contract_period_change_pending_at IS
  'Reserva exclusiva enquanto a Edge Function cancela artefatos pendentes antes de trocar o prazo.';
COMMENT ON COLUMN public.consultas_credito.contract_period_change_pending_months IS
  'Novo prazo solicitado pela operacao de replanejamento em andamento.';

-- O UUID antigo precisa continuar reconhecivel pelo webhook depois que a
-- assinatura pendente e cancelada e a linha principal fica pronta para gerar
-- um documento novo. Sem este mapa, a notificacao de cancelamento da D4Sign
-- seria interpretada como cancelamento do contrato inteiro ou ficaria em
-- redelivery permanente.
CREATE TABLE IF NOT EXISTS public.contract_signature_superseded_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_signature_id uuid NOT NULL
    REFERENCES public.contract_signatures(id) ON DELETE CASCADE,
  consultation_id uuid NOT NULL
    REFERENCES public.consultas_credito(id) ON DELETE CASCADE,
  d4sign_document_uuid text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'cancelling'
    CHECK (state IN ('cancelling', 'cancelled')),
  reason text NOT NULL,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contract_signature_superseded_consultation_idx
  ON public.contract_signature_superseded_documents (consultation_id, created_at DESC);

ALTER TABLE public.contract_signature_superseded_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_signature_superseded_documents FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.contract_signature_superseded_documents TO service_role;

DROP TRIGGER IF EXISTS contract_signature_superseded_touch_updated_at
  ON public.contract_signature_superseded_documents;
CREATE TRIGGER contract_signature_superseded_touch_updated_at
BEFORE UPDATE ON public.contract_signature_superseded_documents
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE OR REPLACE FUNCTION public.contract_period_has_irreversible_commitment(
  p_consultation_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.consultas_credito AS consultation
      WHERE consultation.id = p_consultation_id
        AND (
          consultation.payment_received_at IS NOT NULL
          OR lower(coalesce(consultation.payment_state, consultation.payment_status, 'pending')) IN (
            'confirmed', 'confirmado', 'paid', 'received', 'received_in_cash',
            'paid_via_consolidated', 'pago', 'recebido'
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.asaas_payments AS payment
      WHERE (payment.consultation_id = p_consultation_id OR payment.proposal_id = p_consultation_id)
        AND (
          payment.confirmed_at IS NOT NULL
          OR payment.received_at IS NOT NULL
          OR lower(coalesce(payment.status, 'pending')) IN (
            'confirmed', 'confirmado', 'paid', 'received', 'received_in_cash',
            'paid_via_consolidated', 'pago', 'recebido', 'refunded', 'estornado',
            'chargeback', 'chargeback_dispute'
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.faturas_inquilino AS invoice
      WHERE invoice.consulta_id = p_consultation_id
        AND (
          invoice.confirmed_at IS NOT NULL
          OR invoice.pago_em IS NOT NULL
          OR lower(coalesce(invoice.status, 'pending')) IN (
            'confirmed', 'confirmado', 'paid', 'received', 'received_in_cash',
            'paid_via_consolidated', 'pago', 'recebido', 'refunded', 'estornado',
            'chargeback', 'chargeback_dispute'
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.cakto_payments AS payment
      WHERE payment.consultation_id = p_consultation_id
        AND (
          payment.paid_at IS NOT NULL
          OR lower(coalesce(payment.status, 'waiting_payment')) IN (
            'approved', 'confirmed', 'confirmado', 'paid', 'received',
            'pago', 'recebido', 'refunded', 'estornado', 'chargeback'
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.asaas_subscriptions AS subscription
      WHERE subscription.consultation_id = p_consultation_id
        AND (
          lower(coalesce(subscription.payment_status, 'pending')) IN (
            'confirmed', 'confirmado', 'paid', 'received', 'received_in_cash',
            'paid_via_consolidated', 'pago', 'recebido', 'refunded', 'estornado',
            'chargeback', 'chargeback_dispute'
          )
          OR lower(coalesce(subscription.initial_checkout_status, 'pending')) = 'paid'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.contract_signatures AS signature
      WHERE signature.consultation_id = p_consultation_id
        AND (
          signature.signed_at IS NOT NULL
          OR signature.activated_at IS NOT NULL
          OR lower(coalesce(signature.status, 'processing')) IN ('signed', 'active')
          OR lower(coalesce(signature.signature_status, 'pending')) = 'signed'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.apolices AS policy
      WHERE policy.consulta_id = p_consultation_id
        AND (
          policy.activated_at IS NOT NULL
          OR lower(coalesce(policy.status, '')) IN ('ativa', 'ativo', 'active')
        )
    );
$$;

REVOKE ALL ON FUNCTION public.contract_period_has_irreversible_commitment(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contract_period_has_irreversible_commitment(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.guard_contract_period_after_commitment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_service_replan boolean :=
    coalesce(current_setting('nox.contract_period_replan', true), '') = 'on';
  v_has_pending_provider_work boolean;
BEGIN
  IF NEW.contract_period_months IS NOT DISTINCT FROM OLD.contract_period_months THEN
    IF OLD.contract_period_locked_at IS NOT NULL
       AND NEW.contract_period_locked_at IS DISTINCT FROM OLD.contract_period_locked_at
       AND NOT v_service_replan THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'A reserva do período do contrato não pode ser alterada diretamente.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.contract_period_months IS NULL
     OR NEW.contract_period_months NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Selecione um período de contrato válido, entre 1 e 120 meses.';
  END IF;

  IF public.contract_period_has_irreversible_commitment(OLD.id) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'O período só pode ser alterado antes do primeiro pagamento, da assinatura concluída ou da ativação da apólice.';
  END IF;

  IF NOT v_service_replan
     AND OLD.contract_period_change_pending_at IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55P03',
      MESSAGE = 'A alteração segura do período já está em andamento. Aguarde alguns instantes.';
  END IF;

  IF NOT v_service_replan
     AND OLD.contract_period_locked_at IS NOT NULL
     AND OLD.contract_period_locked_at >= clock_timestamp() - interval '5 minutes' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55P03',
      MESSAGE = 'A cobrança está sendo preparada. Aguarde alguns instantes e tente alterar o período novamente.';
  END IF;

  SELECT
    EXISTS (
      SELECT 1
      FROM public.asaas_payments AS payment
      WHERE (payment.consultation_id = OLD.id OR payment.proposal_id = OLD.id)
        AND payment.asaas_payment_id IS NOT NULL
        AND lower(coalesce(payment.status, 'pending')) NOT IN (
          'cancelled', 'canceled', 'cancelado', 'expired', 'refused', 'recusado', 'failed', 'falhou'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.asaas_subscriptions AS subscription
      WHERE subscription.consultation_id = OLD.id
        AND (
          subscription.asaas_subscription_id IS NOT NULL
          OR subscription.asaas_initial_checkout_id IS NOT NULL
          OR subscription.asaas_checkout_id IS NOT NULL
        )
        AND lower(coalesce(subscription.status, 'pending')) NOT IN ('cancelled', 'canceled', 'expired', 'error')
    )
    OR EXISTS (
      SELECT 1
      FROM public.contract_signatures AS signature
      WHERE signature.consultation_id = OLD.id
        AND signature.d4sign_document_uuid IS NOT NULL
        AND lower(coalesce(signature.status, 'processing')) NOT IN ('cancelled', 'canceled', 'error')
    )
    OR EXISTS (
      SELECT 1
      FROM public.faturas_inquilino AS invoice
      WHERE invoice.consulta_id = OLD.id
        AND lower(coalesce(invoice.status, 'pending')) NOT IN (
          'cancelled', 'canceled', 'cancelado', 'expired', 'refused', 'recusado',
          'failed', 'falhou', 'refunded', 'estornado', 'chargeback'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.apolices AS policy
      WHERE policy.consulta_id = OLD.id
        AND policy.activated_at IS NULL
        AND lower(coalesce(policy.status, '')) NOT IN (
          'cancelada', 'cancelled', 'canceled'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.cakto_payments AS payment
      WHERE payment.consultation_id = OLD.id
        AND (
          payment.cakto_payment_id IS NOT NULL
          OR payment.cakto_ref_id IS NOT NULL
          OR payment.checkout_url IS NOT NULL
        )
        AND lower(coalesce(payment.status, 'waiting_payment')) NOT IN (
          'cancelled', 'canceled', 'cancelado', 'expired', 'refused', 'recusado',
          'failed', 'falhou', 'refunded', 'estornado', 'chargeback'
        )
    )
  INTO v_has_pending_provider_work;

  IF v_has_pending_provider_work AND NOT v_service_replan THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Há uma cobrança ou assinatura pendente. Atualize o período pelo fluxo seguro da proposta.';
  END IF;

  NEW.contract_period_locked_at := NULL;
  NEW.contract_period_revision := OLD.contract_period_revision + 1;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_contract_period_after_commitment() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.begin_contract_period_change(
  p_consultation_id uuid,
  p_new_period_months integer
)
RETURNS TABLE(current_period_months integer, current_revision integer, changed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_consultation public.consultas_credito%ROWTYPE;
BEGIN
  IF p_new_period_months IS NULL OR p_new_period_months NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Selecione um período de contrato válido, entre 1 e 120 meses.';
  END IF;

  SELECT * INTO v_consultation
  FROM public.consultas_credito
  WHERE id = p_consultation_id
  FOR UPDATE;

  IF v_consultation.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Proposta não encontrada.';
  END IF;

  IF v_consultation.contract_period_months IS NOT DISTINCT FROM p_new_period_months THEN
    RETURN QUERY SELECT v_consultation.contract_period_months,
      v_consultation.contract_period_revision, false;
    RETURN;
  END IF;

  IF public.contract_period_has_irreversible_commitment(p_consultation_id) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'O período só pode ser alterado antes do primeiro pagamento, da assinatura concluída ou da ativação da apólice.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cakto_payments AS payment
    WHERE payment.consultation_id = p_consultation_id
      AND (
        payment.cakto_payment_id IS NOT NULL
        OR payment.cakto_ref_id IS NOT NULL
        OR payment.checkout_url IS NOT NULL
      )
      AND lower(coalesce(payment.status, 'waiting_payment')) NOT IN (
        'cancelled', 'canceled', 'cancelado', 'expired', 'refused', 'recusado',
        'failed', 'falhou', 'refunded', 'estornado', 'chargeback'
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Existe uma cobrança legada pendente que precisa ser cancelada antes de alterar o período.';
  END IF;

  IF v_consultation.contract_period_locked_at IS NOT NULL
     AND v_consultation.contract_period_locked_at >= clock_timestamp() - interval '5 minutes' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55P03',
      MESSAGE = 'A cobrança está sendo preparada. Aguarde alguns instantes e tente alterar o período novamente.';
  END IF;

  IF v_consultation.contract_period_change_pending_at IS NOT NULL
     AND v_consultation.contract_period_change_pending_months IS DISTINCT FROM p_new_period_months
     AND v_consultation.contract_period_change_pending_at >= clock_timestamp() - interval '5 minutes' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55P03',
      MESSAGE = 'Outra alteração de período já está em andamento. Aguarde alguns instantes.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.billing_operations AS operation
    WHERE operation.consultation_id = p_consultation_id
      AND operation.state IN ('reserved', 'provider_created', 'ambiguous')
      AND coalesce(operation.locked_at, operation.updated_at, operation.created_at)
        >= clock_timestamp() - interval '5 minutes'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55P03',
      MESSAGE = 'Uma operação financeira ainda está em andamento. Aguarde alguns instantes e tente novamente.';
  END IF;

  UPDATE public.consultas_credito
  SET contract_period_change_pending_at = clock_timestamp(),
      contract_period_change_pending_months = p_new_period_months
  WHERE id = p_consultation_id;

  RETURN QUERY SELECT v_consultation.contract_period_months,
    v_consultation.contract_period_revision, true;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_contract_period_change(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_contract_period_change(uuid, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finish_contract_period_change(
  p_consultation_id uuid,
  p_new_period_months integer
)
RETURNS TABLE(contract_period_months integer, contract_period_revision integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_consultation public.consultas_credito%ROWTYPE;
  v_new_revision integer;
BEGIN
  SELECT * INTO v_consultation
  FROM public.consultas_credito
  WHERE id = p_consultation_id
  FOR UPDATE;

  IF v_consultation.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Proposta não encontrada.';
  END IF;

  IF v_consultation.contract_period_change_pending_at IS NULL
     OR v_consultation.contract_period_change_pending_months IS DISTINCT FROM p_new_period_months THEN
    RAISE EXCEPTION USING
      ERRCODE = '55P03',
      MESSAGE = 'A reserva da alteração de período expirou. Tente novamente.';
  END IF;

  IF public.contract_period_has_irreversible_commitment(p_consultation_id) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'O período só pode ser alterado antes do primeiro pagamento, da assinatura concluída ou da ativação da apólice.';
  END IF;

  v_new_revision := v_consultation.contract_period_revision + 1;
  PERFORM set_config('nox.contract_period_replan', 'on', true);

  UPDATE public.consultas_credito
  SET contract_period_months = p_new_period_months,
      contract_period_revision = v_new_revision,
      contract_period_locked_at = NULL,
      contract_period_change_pending_at = NULL,
      contract_period_change_pending_months = NULL
  WHERE id = p_consultation_id;

  UPDATE public.faturas_inquilino AS invoice
  SET installment_total = p_new_period_months,
      components = jsonb_set(
        coalesce(invoice.components, '{}'::jsonb),
        '{contractMonths}',
        to_jsonb(p_new_period_months),
        true
      )
  WHERE invoice.consulta_id = p_consultation_id
    AND invoice.charge_kind = 'initial'
    AND lower(coalesce(invoice.status, 'pending')) NOT IN (
      'cancelled', 'canceled', 'cancelado', 'expired', 'refunded', 'estornado', 'chargeback'
    );

  UPDATE public.asaas_subscriptions AS subscription
  SET status = 'pending',
      card_registration_status = CASE
        WHEN subscription.mode = 'direct' THEN 'not_required'
        ELSE 'awaiting_card'
      END,
      asaas_subscription_id = NULL,
      asaas_initial_checkout_id = NULL,
      asaas_checkout_id = NULL,
      initial_checkout_url = NULL,
      checkout_url = NULL,
      initial_checkout_status = 'pending',
      checkout_status = 'pending',
      external_reference = concat(
        'nox:', p_consultation_id, ':subscription:', subscription.mode,
        CASE WHEN v_new_revision > 0 THEN concat('-r', v_new_revision) ELSE '' END
      ),
      idempotency_key = concat(
        'nox:', p_consultation_id, ':subscription:', subscription.mode,
        CASE WHEN v_new_revision > 0 THEN concat('-r', v_new_revision) ELSE '' END
      ),
      recurrence_start_date = coalesce(subscription.recurrence_start_date, subscription.next_due_date),
      recurrence_end_date = (
        coalesce(subscription.recurrence_start_date, subscription.next_due_date)
        + make_interval(months => greatest(p_new_period_months - 2, 0))
      )::date,
      recurrence_total_payments = greatest(p_new_period_months - 1, 0),
      cancelled_at = NULL,
      raw_response = jsonb_build_object(
        'periodChange', jsonb_build_object(
          'previousMonths', v_consultation.contract_period_months,
          'newMonths', p_new_period_months,
          'changedAt', clock_timestamp(),
          'previousProviderState', coalesce(subscription.raw_response, '{}'::jsonb)
        )
      )
  WHERE subscription.id = (
    SELECT latest_subscription.id
    FROM public.asaas_subscriptions AS latest_subscription
    WHERE latest_subscription.consultation_id = p_consultation_id
    ORDER BY latest_subscription.created_at DESC, latest_subscription.id DESC
    LIMIT 1
  );

  UPDATE public.apolices AS policy
  SET vigencia_fim = (
        policy.vigencia_inicio + make_interval(months => p_new_period_months)
      )::date
  WHERE policy.consulta_id = p_consultation_id
    AND policy.activated_at IS NULL
    AND lower(coalesce(policy.status, '')) NOT IN ('ativa', 'ativo', 'active', 'cancelada', 'cancelled', 'canceled');

  UPDATE public.billing_operations AS operation
  SET state = 'cancelled',
      completed_at = coalesce(operation.completed_at, clock_timestamp()),
      last_error = 'superseded_by_contract_period_change'
  WHERE operation.consultation_id = p_consultation_id
    AND operation.operation_type IN ('installment', 'subscription', 'checkout')
    AND operation.state <> 'cancelled';

  INSERT INTO public.proposta_historico (
    consulta_id,
    tipo_evento,
    descricao,
    metadata
  ) VALUES (
    p_consultation_id,
    'periodo_contrato_atualizado',
    format(
      'Período do contrato atualizado de %s para %s meses; dados da proposta preservados.',
      v_consultation.contract_period_months,
      p_new_period_months
    ),
    jsonb_build_object(
      'previous_contract_period_months', v_consultation.contract_period_months,
      'contract_period_months', p_new_period_months,
      'contract_period_revision', v_new_revision
    )
  );

  RETURN QUERY SELECT p_new_period_months, v_new_revision;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_contract_period_change(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_contract_period_change(uuid, integer)
  TO service_role;
