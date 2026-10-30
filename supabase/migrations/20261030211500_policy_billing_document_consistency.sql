-- Mantém apólice, cobranças e documentos na mesma projeção compartilhada.
-- Os arquivos e as faturas podem nascer antes da apólice; quando ela é
-- criada, todos os filhos da consulta precisam receber o vínculo.

CREATE OR REPLACE FUNCTION private.attach_policy_to_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $$
BEGIN
  IF NEW.apolice_id IS NULL AND NEW.consulta_id IS NOT NULL THEN
    SELECT policy.id
      INTO NEW.apolice_id
    FROM public.apolices AS policy
    WHERE policy.consulta_id = NEW.consulta_id
    ORDER BY policy.created_at, policy.id
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.attach_policy_to_proposal_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $$
BEGIN
  IF NEW.apolice_id IS NULL AND NEW.consulta_id IS NOT NULL THEN
    SELECT policy.id
      INTO NEW.apolice_id
    FROM public.apolices AS policy
    WHERE policy.consulta_id = NEW.consulta_id
    ORDER BY policy.created_at, policy.id
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.attach_policy_dependents()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $$
BEGIN
  UPDATE public.faturas_inquilino
  SET apolice_id = NEW.id
  WHERE consulta_id = NEW.consulta_id
    AND apolice_id IS NULL;

  UPDATE public.documentos_proposta
  SET apolice_id = NEW.id,
      updated_at = now()
  WHERE consulta_id = NEW.consulta_id
    AND apolice_id IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attach_policy_to_invoice ON public.faturas_inquilino;
CREATE TRIGGER attach_policy_to_invoice
BEFORE INSERT OR UPDATE OF consulta_id ON public.faturas_inquilino
FOR EACH ROW EXECUTE FUNCTION private.attach_policy_to_invoice();

DROP TRIGGER IF EXISTS attach_policy_to_proposal_document ON public.documentos_proposta;
CREATE TRIGGER attach_policy_to_proposal_document
BEFORE INSERT OR UPDATE OF consulta_id ON public.documentos_proposta
FOR EACH ROW EXECUTE FUNCTION private.attach_policy_to_proposal_document();

DROP TRIGGER IF EXISTS attach_policy_dependents ON public.apolices;
CREATE TRIGGER attach_policy_dependents
AFTER INSERT OR UPDATE OF consulta_id ON public.apolices
FOR EACH ROW EXECUTE FUNCTION private.attach_policy_dependents();

UPDATE public.faturas_inquilino AS invoice
SET apolice_id = (
  SELECT policy.id
  FROM public.apolices AS policy
  WHERE policy.consulta_id = invoice.consulta_id
  ORDER BY policy.created_at, policy.id
  LIMIT 1
)
WHERE invoice.apolice_id IS NULL
  AND EXISTS (
    SELECT 1 FROM public.apolices AS policy
    WHERE policy.consulta_id = invoice.consulta_id
  );

UPDATE public.documentos_proposta AS document
SET apolice_id = (
      SELECT policy.id
      FROM public.apolices AS policy
      WHERE policy.consulta_id = document.consulta_id
      ORDER BY policy.created_at, policy.id
      LIMIT 1
    ),
    updated_at = now()
WHERE document.apolice_id IS NULL
  AND EXISTS (
    SELECT 1 FROM public.apolices AS policy
    WHERE policy.consulta_id = document.consulta_id
  );

-- Enquanto a apólice ainda não foi assinada/ativada, o prêmio acompanha a
-- última seleção contratual. Uma apólice ativa ou assinada nunca é reescrita.
UPDATE public.apolices AS policy
SET valor_premio = coalesce(
  consultation.valor_anual,
  consultation.valor_premio_mensal * 12
)
FROM public.consultas_credito AS consultation
WHERE consultation.id = policy.consulta_id
  AND lower(coalesce(policy.status, '')) IN ('emitida_pendente', 'pending')
  AND coalesce(consultation.valor_anual, consultation.valor_premio_mensal * 12) > 0
  AND policy.valor_premio IS DISTINCT FROM coalesce(
    consultation.valor_anual,
    consultation.valor_premio_mensal * 12
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.contract_signatures AS signature
    WHERE signature.consultation_id = consultation.id
      AND (
        lower(coalesce(signature.status, '')) IN ('signed', 'active')
        OR lower(coalesce(signature.signature_status, '')) = 'signed'
        OR signature.signed_at IS NOT NULL
      )
  );

-- Repara propostas cujo Asaas já confirmou/recebeu a primeira parcela, mas
-- que ainda carregavam o texto antigo de espera pelo pagamento.
UPDATE public.consultas_credito AS consultation
SET status = 'aguardando_ativacao',
    substatus = 'aguardando_assinatura_d4sign',
    activation_status = 'aguardando_assinatura',
    signature_status = 'sent',
    policy_status = 'issued_pending',
    updated_at = now()
FROM public.contract_signatures AS signature
WHERE signature.consultation_id = consultation.id
  AND lower(coalesce(consultation.payment_state, consultation.payment_status, ''))
      IN ('confirmed', 'paid', 'received')
  AND lower(coalesce(signature.status, '')) = 'awaiting_signature'
  AND lower(coalesce(signature.signature_status, '')) = 'sent'
  AND signature.signed_at IS NULL;

REVOKE ALL ON FUNCTION private.attach_policy_to_invoice() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.attach_policy_to_proposal_document() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.attach_policy_dependents() FROM PUBLIC;
