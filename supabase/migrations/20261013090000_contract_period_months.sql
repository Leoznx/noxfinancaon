-- O período escolhido na proposta passa a ser a fonte única para a quantidade
-- de mensalidades e para a vigência da apólice. Sem DEFAULT: propostas novas
-- continuam sem resposta até o usuário escolher explicitamente o prazo.
ALTER TABLE public.consultas_credito
  ADD COLUMN IF NOT EXISTS contract_period_months integer,
  ADD COLUMN IF NOT EXISTS contract_period_locked_at timestamptz;

ALTER TABLE public.consultas_credito
  DROP CONSTRAINT IF EXISTS consultas_credito_contract_period_months_check;

ALTER TABLE public.consultas_credito
  ADD CONSTRAINT consultas_credito_contract_period_months_check
  CHECK (
    contract_period_months IS NULL
    OR contract_period_months BETWEEN 1 AND 120
  );

ALTER TABLE public.consultas_credito
  DROP CONSTRAINT IF EXISTS consultas_credito_contract_period_lock_check;

ALTER TABLE public.consultas_credito
  ADD CONSTRAINT consultas_credito_contract_period_lock_check
  CHECK (
    contract_period_locked_at IS NULL
    OR contract_period_months IS NOT NULL
  );

-- Todo plano legado já selecionado seguia o contrato fixo de 12 meses. Alguns
-- registros antigos não receberam plano_id, mas já possuem o plano calculado
-- no JSON ou um artefato financeiro/contratual materializado.
UPDATE public.consultas_credito AS consultation
SET contract_period_months = 12
WHERE consultation.contract_period_months IS NULL
  AND (
    consultation.plano_id IS NOT NULL
    OR consultation.asaas_payment_id IS NOT NULL
    OR consultation.external_reference IS NOT NULL
    OR consultation.payment_data IS NOT NULL
    OR (
      consultation.documentos ? 'plano_calculado'
      AND consultation.documentos -> 'plano_calculado' IS NOT NULL
      AND consultation.documentos -> 'plano_calculado' <> 'null'::jsonb
    )
    OR EXISTS (
      SELECT 1
      FROM public.faturas_inquilino AS invoice
      WHERE invoice.consulta_id = consultation.id
    )
    OR EXISTS (
      SELECT 1
      FROM public.asaas_payments AS payment
      WHERE payment.consultation_id = consultation.id
         OR payment.proposal_id = consultation.id
    )
    OR EXISTS (
      SELECT 1
      FROM public.cakto_payments AS payment
      WHERE payment.consultation_id = consultation.id
    )
    OR EXISTS (
      SELECT 1
      FROM public.contract_signatures AS signature
      WHERE signature.consultation_id = consultation.id
    )
    OR EXISTS (
      SELECT 1
      FROM public.apolices AS policy
      WHERE policy.consulta_id = consultation.id
    )
  );

-- Artefatos legados já representam um compromisso externo. Além de receberem
-- o prazo histórico de 12 meses acima, ficam explicitamente bloqueados.
UPDATE public.consultas_credito AS consultation
SET contract_period_locked_at = now()
WHERE consultation.contract_period_months IS NOT NULL
  AND consultation.contract_period_locked_at IS NULL
  AND (
    consultation.asaas_payment_id IS NOT NULL
    OR consultation.external_reference IS NOT NULL
    OR consultation.payment_data IS NOT NULL
    OR
    EXISTS (
      SELECT 1
      FROM public.faturas_inquilino AS invoice
      WHERE invoice.consulta_id = consultation.id
    )
    OR EXISTS (
      SELECT 1
      FROM public.asaas_payments AS payment
      WHERE payment.consultation_id = consultation.id
         OR payment.proposal_id = consultation.id
    )
    OR EXISTS (
      SELECT 1
      FROM public.cakto_payments AS payment
      WHERE payment.consultation_id = consultation.id
    )
    OR EXISTS (
      SELECT 1
      FROM public.contract_signatures AS signature
      WHERE signature.consultation_id = consultation.id
    )
    OR EXISTS (
      SELECT 1
      FROM public.apolices AS policy
      WHERE policy.consulta_id = consultation.id
    )
  );

COMMENT ON COLUMN public.consultas_credito.contract_period_months IS
  'Período do contrato escolhido na proposta, em meses (1 a 120). Fica nulo até a escolha obrigatória do usuário.';

COMMENT ON COLUMN public.consultas_credito.contract_period_locked_at IS
  'Instante em que o período foi congelado antes do primeiro efeito externo de pagamento, assinatura ou apólice.';

-- Depois que uma cobrança ou artefato contratual existe, o prazo não pode mais
-- ser reescrito: isso evita divergência entre boletos reais, documento assinado
-- e vigência da apólice. A primeira definição continua permitida antes disso.
CREATE OR REPLACE FUNCTION public.guard_contract_period_after_commitment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- O lock é irreversível: nem o prazo nem o instante do bloqueio podem ser
  -- reescritos depois que uma Edge Function o adquiriu.
  IF OLD.contract_period_locked_at IS NOT NULL THEN
    IF NEW.contract_period_months IS DISTINCT FROM OLD.contract_period_months
       OR NEW.contract_period_locked_at IS DISTINCT FROM OLD.contract_period_locked_at THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'O período do contrato está bloqueado e não pode ser alterado.';
    END IF;
    RETURN NEW;
  END IF;

  -- Defesa para registros legados que porventura materializem um artefato antes
  -- do lock explícito. A primeira definição segue permitida quando não há
  -- qualquer compromisso criado.
  IF NEW.contract_period_months IS DISTINCT FROM OLD.contract_period_months
     AND (
    OLD.asaas_payment_id IS NOT NULL
    OR OLD.external_reference IS NOT NULL
    OR OLD.payment_data IS NOT NULL
    OR
    EXISTS (
    SELECT 1
    FROM public.faturas_inquilino AS invoice
    WHERE invoice.consulta_id = OLD.id
  ) OR EXISTS (
    SELECT 1
    FROM public.asaas_payments AS payment
    WHERE payment.consultation_id = OLD.id
       OR payment.proposal_id = OLD.id
  ) OR EXISTS (
    SELECT 1
    FROM public.cakto_payments AS payment
    WHERE payment.consultation_id = OLD.id
  ) OR EXISTS (
    SELECT 1
    FROM public.contract_signatures AS signature
    WHERE signature.consultation_id = OLD.id
  ) OR EXISTS (
    SELECT 1
    FROM public.apolices AS policy
    WHERE policy.consulta_id = OLD.id
  )) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'O período do contrato não pode ser alterado após a geração de cobrança, assinatura ou apólice.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_contract_period_after_commitment() FROM PUBLIC;

DROP TRIGGER IF EXISTS guard_contract_period_after_commitment
  ON public.consultas_credito;

CREATE TRIGGER guard_contract_period_after_commitment
BEFORE UPDATE OF contract_period_months, contract_period_locked_at
ON public.consultas_credito
FOR EACH ROW
EXECUTE FUNCTION public.guard_contract_period_after_commitment();

-- Compatibilidade com o caminho legado que ainda persiste Cakto com a sessão
-- autenticada: toda inserção precisa apontar para uma proposta com período
-- válido e congela esse período na mesma transação da cobrança local.
CREATE OR REPLACE FUNCTION public.lock_contract_period_before_cakto_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_consultation_id uuid;
  v_policy_consultation_id uuid;
  v_period integer;
  v_locked_at timestamptz;
BEGIN
  IF NEW.contract_id IS NOT NULL THEN
    SELECT policy.consulta_id
    INTO v_policy_consultation_id
    FROM public.apolices AS policy
    WHERE policy.id = NEW.contract_id
    FOR SHARE;

    IF NOT FOUND OR v_policy_consultation_id IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23503',
        MESSAGE = 'A apólice da cobrança Cakto não foi encontrada ou não possui proposta.';
    END IF;
  END IF;

  IF NEW.consultation_id IS NOT NULL
     AND v_policy_consultation_id IS NOT NULL
     AND NEW.consultation_id IS DISTINCT FROM v_policy_consultation_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'A apólice e a proposta da cobrança Cakto não correspondem.';
  END IF;

  v_consultation_id := coalesce(NEW.consultation_id, v_policy_consultation_id);
  IF v_consultation_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'A cobrança Cakto precisa estar vinculada a uma proposta ou apólice.';
  END IF;

  SELECT contract_period_months, contract_period_locked_at
  INTO v_period, v_locked_at
  FROM public.consultas_credito
  WHERE id = v_consultation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'A proposta da cobrança Cakto não foi encontrada.';
  END IF;
  IF v_period IS NULL OR v_period NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Selecione um período de contrato válido antes de criar a cobrança Cakto.';
  END IF;

  IF v_locked_at IS NULL THEN
    UPDATE public.consultas_credito
    SET contract_period_locked_at = now()
    WHERE id = v_consultation_id
      AND contract_period_locked_at IS NULL;
  END IF;

  NEW.consultation_id := v_consultation_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.lock_contract_period_before_cakto_insert()
  FROM PUBLIC;

DROP TRIGGER IF EXISTS lock_contract_period_before_cakto_insert
  ON public.cakto_payments;

CREATE TRIGGER lock_contract_period_before_cakto_insert
BEFORE INSERT ON public.cakto_payments
FOR EACH ROW
EXECUTE FUNCTION public.lock_contract_period_before_cakto_insert();
