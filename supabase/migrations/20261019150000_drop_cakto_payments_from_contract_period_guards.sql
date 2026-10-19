-- A migration 20261019130000_drop_cakto_integration.sql dropou a tabela
-- public.cakto_payments, mas as funcoes abaixo (definidas por 20261016190000
-- _replan_pending_contract_period.sql) continuavam referenciando-a no corpo.
-- O Postgres so re-planeja o corpo quando a funcao e redefinida, entao
-- qualquer UPDATE em consultas_credito que mudasse o periodo do contrato
-- disparava `relation "public.cakto_payments" does not exist`.
--
-- Esta migration redefine as duas funcoes mantendo o restante da logica
-- intocada e removendo somente os blocos que consultavam cakto_payments.

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

COMMENT ON FUNCTION public.guard_contract_period_after_commitment() IS
  'Bloqueia troca de periodo quando ja existe compromisso Asaas/D4Sign/apolice/fatura ativa — sem referencias a cakto_payments (integracao desativada).';
