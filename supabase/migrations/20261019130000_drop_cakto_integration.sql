-- Remove integracao com Cakto. O meio de pagamento oficial e Asaas; Cakto era
-- um fluxo paralelo que foi descontinuado. Esta migration dropa a tabela
-- cakto_payments (CASCADE remove triggers/policies/foreign keys associadas)
-- e os guards SQL de begin_contract_period_change que referenciam a tabela.

BEGIN;

-- Antes de dropar, remove a verificacao de cobranca Cakto pendente dentro de
-- begin_contract_period_change (migration 20261016190000) - caso contrario a
-- funcao estoura ao referenciar tabela inexistente apos o drop.
CREATE OR REPLACE FUNCTION public.begin_contract_period_change(
  p_consultation_id uuid,
  p_new_period_months integer
)
RETURNS TABLE(current_period_months integer, current_revision integer, changed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
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

-- Procura e dropa quaisquer views, funcoes RPC ou dependencias que referenciem
-- cakto_payments antes do DROP TABLE para evitar erros ... CASCADE abaixo
-- faz o trabalho pesado tambem.
DROP TABLE IF EXISTS public.cakto_payments CASCADE;

COMMIT;
