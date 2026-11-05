-- Decisions from Direct Data now require both the QUOD score and the numeric
-- payment-commitment score. Keep both provider fields auditable and prevent
-- legacy score-only decisions from feeding the CPF/CNPJ result cache.

ALTER TABLE public.directd_credit_requests
  ADD COLUMN IF NOT EXISTS payment_commitment_score numeric(5,2),
  ADD COLUMN IF NOT EXISTS payment_commitment_description text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.directd_credit_requests'::regclass
      AND conname = 'directd_credit_requests_payment_commitment_score_check'
  ) THEN
    ALTER TABLE public.directd_credit_requests
      ADD CONSTRAINT directd_credit_requests_payment_commitment_score_check
      CHECK (
        payment_commitment_score IS NULL
        OR payment_commitment_score BETWEEN 0 AND 100
      );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_directd_score_commitment_rule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_response jsonb;
  v_rule text;
  v_commitment_text text;
  v_commitment numeric;
BEGIN
  IF NEW.status IS DISTINCT FROM 'succeeded' THEN
    RETURN NEW;
  END IF;

  SELECT consultation.raw_response
  INTO v_response
  FROM public.consultas_credito AS consultation
  WHERE consultation.id = NEW.consultation_id;

  v_rule := v_response #>> '{retorno,regraDecisao}';
  v_commitment_text := btrim(
    coalesce(v_response #>> '{retorno,scoreCompromissoPagamento}', '')
  );

  IF replace(v_commitment_text, ',', '.') ~ '^\d+(\.\d+)?$' THEN
    v_commitment := replace(v_commitment_text, ',', '.')::numeric;
  END IF;

  NEW.payment_commitment_score := CASE
    WHEN v_commitment BETWEEN 0 AND 100 THEN v_commitment
    ELSE NULL
  END;
  NEW.payment_commitment_description := nullif(
    btrim(v_response #>> '{retorno,descricaoCompromissoPagamento}'),
    ''
  );

  IF v_rule IS DISTINCT FROM 'score_compromisso_v1' THEN
    NEW.status := 'requires_verification';
    NEW.error_code := 'DIRECTD_LEGACY_RULE_NO_COMMITMENT';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_directd_score_commitment_rule() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_directd_score_commitment_rule() TO service_role;

DROP TRIGGER IF EXISTS trg_enforce_directd_score_commitment_rule
  ON public.directd_credit_requests;
CREATE TRIGGER trg_enforce_directd_score_commitment_rule
BEFORE INSERT OR UPDATE OF status, decision
ON public.directd_credit_requests
FOR EACH ROW
EXECUTE FUNCTION public.enforce_directd_score_commitment_rule();

UPDATE public.directd_credit_requests AS request
SET status = 'requires_verification',
    error_code = 'DIRECTD_LEGACY_RULE_NO_COMMITMENT',
    updated_at = clock_timestamp()
FROM public.consultas_credito AS consultation
WHERE consultation.id = request.consultation_id
  AND request.status = 'succeeded'
  AND consultation.raw_response #>> '{retorno,regraDecisao}'
      IS DISTINCT FROM 'score_compromisso_v1';

COMMENT ON COLUMN public.directd_credit_requests.payment_commitment_score IS
  'Numeric scoreCompromissoPagamento (0-100) returned by Direct Data.';
COMMENT ON COLUMN public.directd_credit_requests.payment_commitment_description IS
  'Provider description associated with the payment-commitment score.';
COMMENT ON FUNCTION public.enforce_directd_score_commitment_rule() IS
  'Persists payment-commitment evidence and excludes legacy score-only decisions from cache reuse.';
