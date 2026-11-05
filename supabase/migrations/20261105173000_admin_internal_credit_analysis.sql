-- Score QUOD e compromisso de pagamento sao dados de decisao exclusivos do
-- administrador. Eles ficam no ledger tecnico (sem grants para clientes) e sao
-- expostos somente por uma RPC que valida admin/admin_master no servidor.

ALTER TABLE public.directd_credit_requests
  ADD COLUMN IF NOT EXISTS commitment_payment_percentage numeric,
  ADD COLUMN IF NOT EXISTS commitment_payment_description text;

ALTER TABLE public.directd_credit_requests
  DROP CONSTRAINT IF EXISTS directd_credit_requests_commitment_percentage_check;

ALTER TABLE public.directd_credit_requests
  ADD CONSTRAINT directd_credit_requests_commitment_percentage_check
  CHECK (
    commitment_payment_percentage IS NULL
    OR commitment_payment_percentage BETWEEN 0 AND 100
  );

COMMENT ON COLUMN public.directd_credit_requests.commitment_payment_percentage IS
  'Percentual interno de poder de pagamento extraido da resposta QUOD.';
COMMENT ON COLUMN public.directd_credit_requests.commitment_payment_description IS
  'Descricao interna da QUOD usada para extrair o poder de pagamento.';

-- Recupera o que ja foi persistido pela regra conjunta antes de remover esses
-- valores das colunas de retorno que os solicitantes tambem conseguem ler.
UPDATE public.directd_credit_requests AS request
SET
  score = coalesce(
    request.score,
    CASE
      WHEN (consultation.raw_response #>> '{retorno,score}') ~ '^\s*[0-9]+\s*$'
        THEN (consultation.raw_response #>> '{retorno,score}')::integer
      ELSE NULL
    END
  ),
  commitment_payment_percentage = coalesce(
    request.commitment_payment_percentage,
    CASE
      WHEN (consultation.raw_response #>> '{retorno,percentualCompromissoPagamento}')
        ~ '^\s*[0-9]+([.,][0-9]+)?\s*$'
        THEN replace(
          btrim(consultation.raw_response #>> '{retorno,percentualCompromissoPagamento}'),
          ',', '.'
        )::numeric
      ELSE NULL
    END
  ),
  commitment_payment_description = coalesce(
    request.commitment_payment_description,
    nullif(
      btrim(consultation.raw_response #>> '{retorno,descricaoCompromissoPagamento}'),
      ''
    )
  )
FROM public.consultas_credito AS consultation
WHERE consultation.id = request.consultation_id;

-- Reaproveitamentos do cache ganham uma copia do diagnostico interno da
-- consulta de origem sem precisar reexpor os valores em consultas_credito.
CREATE OR REPLACE FUNCTION public.inherit_reused_internal_credit_analysis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source public.directd_credit_requests%ROWTYPE;
BEGIN
  IF NEW.reused_from_consultation_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_source
  FROM public.directd_credit_requests
  WHERE consultation_id = NEW.reused_from_consultation_id;

  IF FOUND THEN
    NEW.score := coalesce(NEW.score, v_source.score);
    NEW.score_band := coalesce(NEW.score_band, v_source.score_band);
    NEW.commitment_payment_percentage := coalesce(
      NEW.commitment_payment_percentage,
      v_source.commitment_payment_percentage
    );
    NEW.commitment_payment_description := coalesce(
      NEW.commitment_payment_description,
      v_source.commitment_payment_description
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inherit_reused_internal_credit_analysis
  ON public.directd_credit_requests;
CREATE TRIGGER inherit_reused_internal_credit_analysis
BEFORE INSERT OR UPDATE ON public.directd_credit_requests
FOR EACH ROW
EXECUTE FUNCTION public.inherit_reused_internal_credit_analysis();

REVOKE ALL ON FUNCTION public.inherit_reused_internal_credit_analysis()
  FROM PUBLIC, anon, authenticated;

-- Defesa em profundidade: mesmo uma versao antiga da Edge Function que envie
-- esses campos nao consegue grava-los nas colunas visiveis da consulta.
CREATE OR REPLACE FUNCTION public.strip_internal_credit_analysis(p_payload jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT
    coalesce(p_payload, '{}'::jsonb)
      #- '{retorno,score}'
      #- '{retorno,scoreCompromissoPagamento}'
      #- '{retorno,descricaoCompromissoPagamento}'
      #- '{retorno,percentualCompromissoPagamento}'
$$;

REVOKE ALL ON FUNCTION public.strip_internal_credit_analysis(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.strip_internal_credit_analysis(jsonb) TO service_role;

-- Limpa o historico legivel pelos solicitantes somente depois do backfill.
UPDATE public.consultas_credito
SET
  raw_response = public.strip_internal_credit_analysis(raw_response),
  external_response = public.strip_internal_credit_analysis(external_response),
  automacao_credpago_resultado = CASE
    WHEN automacao_credpago_resultado IS NULL THEN NULL
    ELSE automacao_credpago_resultado
      - 'score'
      - 'percentualCompromissoPagamento'
      - 'descricaoCompromissoPagamento'
  END
WHERE
  raw_response #> '{retorno,score}' IS NOT NULL
  OR raw_response #> '{retorno,scoreCompromissoPagamento}' IS NOT NULL
  OR raw_response #> '{retorno,descricaoCompromissoPagamento}' IS NOT NULL
  OR raw_response #> '{retorno,percentualCompromissoPagamento}' IS NOT NULL
  OR external_response #> '{retorno,score}' IS NOT NULL
  OR external_response #> '{retorno,scoreCompromissoPagamento}' IS NOT NULL
  OR external_response #> '{retorno,descricaoCompromissoPagamento}' IS NOT NULL
  OR external_response #> '{retorno,percentualCompromissoPagamento}' IS NOT NULL
  OR automacao_credpago_resultado ? 'score'
  OR automacao_credpago_resultado ? 'percentualCompromissoPagamento'
  OR automacao_credpago_resultado ? 'descricaoCompromissoPagamento';

-- Mantem a assinatura legada durante o rollout, mas ela tambem deixa de
-- persistir o score em consultas_credito. O ledger tecnico continua recebendo-o.
CREATE OR REPLACE FUNCTION public.finish_official_credit_simulation(
  p_consultation_id uuid,
  p_worker_id text,
  p_execution_version bigint,
  p_credit_result text,
  p_message text,
  p_score integer,
  p_score_band text,
  p_provider_external_id text,
  p_sanitized_response jsonb,
  p_provider_http_status integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated uuid;
  v_cost integer;
  v_now timestamptz := clock_timestamp();
  v_public_response jsonb := public.strip_internal_credit_analysis(p_sanitized_response);
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  IF p_credit_result NOT IN ('aprovado', 'recusado', 'em_analise') THEN
    RAISE EXCEPTION 'Invalid credit result' USING ERRCODE = '22023';
  END IF;

  SELECT unit_cost_cents INTO v_cost
  FROM public.credit_api_provider_config
  WHERE provider_key = 'directd-quod';

  UPDATE public.consultas_credito
  SET
    status = p_credit_result,
    resultado = p_credit_result,
    substatus = NULL,
    technical_status = 'completed',
    provider_submission_state = 'confirmed',
    provider_external_id = nullif(btrim(p_provider_external_id), ''),
    external_provider = 'directd_quod',
    external_status = left(coalesce(p_score_band, ''), 255),
    external_request_id = nullif(btrim(p_provider_external_id), ''),
    external_response = v_public_response,
    automacao_credpago_status = p_credit_result,
    automacao_credpago_resultado = jsonb_build_object(
      'status', p_credit_result,
      'statusOriginal', p_score_band,
      'protocolo', p_provider_external_id,
      'origem', 'api_oficial',
      'registradoEm', v_now
    ),
    automacao_origem = 'api_oficial',
    mensagem = left(coalesce(p_message, ''), 2000),
    error_message = NULL,
    raw_response = v_public_response,
    automation_step = NULL,
    automation_finished_at = v_now,
    provider_returned_at = v_now,
    automacao_processed_at = v_now,
    worker_id = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    heartbeat_at = NULL,
    last_error_category = NULL,
    updated_at = v_now
  WHERE id = p_consultation_id
    AND provider_credential_key = 'directd-quod'
    AND worker_id = p_worker_id
    AND execution_version = p_execution_version
    AND technical_status = 'processing'
    AND provider_submission_state = 'submitting'
  RETURNING id INTO v_updated;

  IF v_updated IS NULL THEN RETURN false; END IF;

  UPDATE public.directd_credit_requests
  SET
    status = 'succeeded',
    provider_http_status = p_provider_http_status,
    provider_consulta_uid = nullif(btrim(p_provider_external_id), ''),
    score = p_score,
    score_band = left(coalesce(p_score_band, ''), 255),
    decision = p_credit_result,
    billed_cents = coalesce(v_cost, 198),
    error_code = NULL,
    completed_at = v_now,
    updated_at = v_now
  WHERE consultation_id = p_consultation_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_official_credit_simulation(
  uuid, text, bigint, text, text, integer, text, text, jsonb, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_official_credit_simulation(
  uuid, text, bigint, text, text, integer, text, text, jsonb, integer
) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_official_credit_simulation_v2(
  p_consultation_id uuid,
  p_worker_id text,
  p_execution_version bigint,
  p_credit_result text,
  p_message text,
  p_score integer,
  p_score_band text,
  p_commitment_payment_percentage numeric,
  p_commitment_payment_description text,
  p_provider_external_id text,
  p_sanitized_response jsonb,
  p_provider_http_status integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_finished boolean;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  IF p_commitment_payment_percentage IS NOT NULL
    AND p_commitment_payment_percentage NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'Invalid payment commitment percentage' USING ERRCODE = '22023';
  END IF;

  SELECT public.finish_official_credit_simulation(
    p_consultation_id,
    p_worker_id,
    p_execution_version,
    p_credit_result,
    p_message,
    p_score,
    p_score_band,
    p_provider_external_id,
    p_sanitized_response,
    p_provider_http_status
  ) INTO v_finished;

  IF v_finished THEN
    UPDATE public.directd_credit_requests
    SET
      commitment_payment_percentage = p_commitment_payment_percentage,
      commitment_payment_description = nullif(
        left(btrim(coalesce(p_commitment_payment_description, '')), 2000),
        ''
      ),
      updated_at = clock_timestamp()
    WHERE consultation_id = p_consultation_id;
  END IF;

  RETURN coalesce(v_finished, false);
END;
$$;

REVOKE ALL ON FUNCTION public.finish_official_credit_simulation_v2(
  uuid, text, bigint, text, text, integer, text, numeric, text, text, jsonb, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_official_credit_simulation_v2(
  uuid, text, bigint, text, text, integer, text, numeric, text, text, jsonb, integer
) TO service_role;

CREATE OR REPLACE FUNCTION public.get_internal_credit_analyses(
  p_consultation_ids uuid[]
)
RETURNS TABLE(
  consultation_id uuid,
  score integer,
  payment_commitment_percentage numeric,
  payment_commitment_description text,
  score_band text,
  decision text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.role::text IN ('admin', 'admin_master')
        AND coalesce(profile.status, 'ativo') NOT IN ('bloqueado', 'excluido')
    )
    OR public.has_internal_role(
      auth.uid(),
      'admin_master'::public.internal_role
    )
  ) THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;

  IF coalesce(cardinality(p_consultation_ids), 0) > 500 THEN
    RAISE EXCEPTION 'Limite de consultas excedido.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    request.consultation_id,
    request.score,
    request.commitment_payment_percentage,
    request.commitment_payment_description,
    request.score_band,
    request.decision
  FROM public.directd_credit_requests AS request
  WHERE request.consultation_id = ANY(coalesce(p_consultation_ids, ARRAY[]::uuid[]));
END;
$$;

REVOKE ALL ON FUNCTION public.get_internal_credit_analyses(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_internal_credit_analyses(uuid[])
  TO authenticated;
