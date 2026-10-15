-- Permite retomar uma proposta já salva e trocar somente o período. O lock
-- continua protegendo uma criação financeira em andamento e compromissos que
-- já chegaram a um provedor, assinatura ou apólice.
COMMENT ON COLUMN public.consultas_credito.contract_period_locked_at IS
  'Reserva temporária durante a criação de cobrança/assinatura. Um lock sem efeito externo pode ser liberado automaticamente após cinco minutos ao editar o período.';

CREATE OR REPLACE FUNCTION public.guard_contract_period_after_commitment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_has_external_commitment boolean;
BEGIN
  -- Aquisições idempotentes do lock continuam permitidas quando o período não
  -- mudou. Depois de adquirido, o instante não pode ser removido ou reescrito
  -- diretamente pelo cliente.
  IF NEW.contract_period_months IS NOT DISTINCT FROM OLD.contract_period_months THEN
    IF OLD.contract_period_locked_at IS NOT NULL
       AND NEW.contract_period_locked_at IS DISTINCT FROM OLD.contract_period_locked_at THEN
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

  -- Evita a corrida entre a tela e uma Edge Function que acabou de reservar o
  -- prazo antes de chamar o provedor. Locks antigos sem efeito externo são
  -- considerados tentativas interrompidas e podem ser retomados.
  IF OLD.contract_period_locked_at IS NOT NULL
     AND OLD.contract_period_locked_at >= clock_timestamp() - interval '5 minutes' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55P03',
      MESSAGE = 'A cobrança está sendo preparada. Aguarde alguns instantes e tente alterar o período novamente.';
  END IF;

  SELECT
    (
      (
        OLD.asaas_payment_id IS NOT NULL
        OR OLD.external_reference IS NOT NULL
        OR OLD.payment_data IS NOT NULL
      )
      AND lower(coalesce(OLD.payment_state, OLD.payment_status, 'pending')) NOT IN (
        'cancelled', 'canceled', 'cancelado', 'refused', 'recusado',
        'failed', 'falhou', 'refunded', 'estornado', 'chargeback', 'expired'
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.asaas_payments AS payment
      WHERE (payment.consultation_id = OLD.id OR payment.proposal_id = OLD.id)
        AND payment.asaas_payment_id IS NOT NULL
        AND lower(coalesce(payment.status, 'pending')) NOT IN (
          'cancelled', 'canceled', 'cancelado', 'refused', 'recusado',
          'failed', 'falhou', 'refunded', 'estornado', 'chargeback', 'expired'
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
        AND lower(coalesce(subscription.status, 'pending')) NOT IN (
          'cancelled', 'canceled', 'cancelado', 'expired', 'error'
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
          'cancelled', 'canceled', 'cancelado', 'refused', 'recusado',
          'failed', 'falhou', 'refunded', 'estornado', 'chargeback', 'expired'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.billing_operations AS operation
      WHERE operation.consultation_id = OLD.id
        AND operation.operation_type IN ('payment', 'installment', 'subscription', 'checkout', 'd4sign')
        AND (
          operation.state IN ('provider_created', 'persisted', 'ambiguous')
          OR (
            operation.state = 'reserved'
            AND coalesce(operation.locked_at, operation.updated_at, operation.created_at)
              >= clock_timestamp() - interval '5 minutes'
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.faturas_inquilino AS invoice
      WHERE invoice.consulta_id = OLD.id
        AND (
          invoice.confirmed_at IS NOT NULL
          OR lower(coalesce(invoice.status, 'pending')) IN (
            'paid', 'received', 'confirmed', 'pago', 'recebido', 'confirmado'
          )
        )
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
      FROM public.apolices AS policy
      WHERE policy.consulta_id = OLD.id
        AND lower(coalesce(policy.status, 'ativa')) NOT IN ('cancelada', 'cancelled', 'canceled')
    )
  INTO v_has_external_commitment;

  IF v_has_external_commitment THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'O período não pode ser alterado porque já existe uma cobrança, assinatura ou apólice ativa para este contrato.';
  END IF;

  -- Remove somente rascunhos locais abandonados. Nenhum item com identificador
  -- de provedor chega aqui, e o próximo passo do fluxo recria o planejamento
  -- usando o novo período.
  DELETE FROM public.asaas_subscriptions AS subscription
  WHERE subscription.consultation_id = OLD.id
    AND subscription.asaas_subscription_id IS NULL
    AND subscription.asaas_initial_checkout_id IS NULL
    AND subscription.asaas_checkout_id IS NULL
    AND lower(coalesce(subscription.status, 'pending')) IN ('pending', 'error', 'cancelled', 'expired');

  DELETE FROM public.asaas_payments AS payment
  WHERE (payment.consultation_id = OLD.id OR payment.proposal_id = OLD.id)
    AND payment.asaas_payment_id IS NULL
    AND lower(coalesce(payment.status, 'pending')) NOT IN (
      'paid', 'received', 'confirmed', 'pago', 'recebido', 'confirmado'
    );

  DELETE FROM public.cakto_payments AS payment
  WHERE payment.consultation_id = OLD.id
    AND payment.cakto_payment_id IS NULL
    AND payment.cakto_ref_id IS NULL
    AND payment.checkout_url IS NULL
    AND lower(coalesce(payment.status, 'waiting_payment')) NOT IN (
      'paid', 'approved', 'received', 'confirmed', 'pago', 'recebido', 'confirmado'
    );

  DELETE FROM public.faturas_inquilino AS invoice
  WHERE invoice.consulta_id = OLD.id
    AND invoice.asaas_payment_id IS NULL
    AND lower(coalesce(invoice.status, 'pending')) NOT IN (
      'paid', 'received', 'confirmed', 'pago', 'recebido', 'confirmado'
    );

  DELETE FROM public.billing_operations AS operation
  WHERE operation.consultation_id = OLD.id
    AND operation.provider_id IS NULL
    AND operation.operation_type IN ('payment', 'installment', 'subscription', 'checkout', 'd4sign')
    AND (
      operation.state IN ('failed', 'cancelled')
      OR (
        operation.state = 'reserved'
        AND coalesce(operation.locked_at, operation.updated_at, operation.created_at)
          < clock_timestamp() - interval '5 minutes'
      )
    );

  -- O novo período passa a ser a fonte da próxima tentativa. A própria Edge
  -- Function adquirirá um lock novo antes de qualquer efeito externo.
  NEW.contract_period_locked_at := NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_contract_period_after_commitment() FROM PUBLIC;

COMMENT ON FUNCTION public.guard_contract_period_after_commitment() IS
  'Protege compromissos externos, mas libera automaticamente propostas salvas cujo processamento financeiro não foi concluído.';
