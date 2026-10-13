-- A Loft pode atualizar uma proposta existente e devolver o mesmo ID no
-- payload da submissao atual. O snapshot continua protegendo reconciliacoes e
-- descobertas pelo portal; somente o ID causal capturado na propria resposta
-- HTTP pode atravessar essa protecao.

CREATE OR REPLACE FUNCTION public.attach_loft_proposal_id_from_submission(
  p_job_id uuid,
  p_proposal_id text
)
RETURNS public.loft_proposal_cancellations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_job public.loft_proposal_cancellations%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_proposal_id IS NULL OR p_proposal_id !~ '^[0-9]{4,12}$' THEN
    RAISE EXCEPTION 'Identificador de proposta invalido.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job
  FROM public.loft_proposal_cancellations
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job de cancelamento nao encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.proposal_id IS NOT NULL AND v_job.proposal_id IS DISTINCT FROM p_proposal_id THEN
    RAISE EXCEPTION 'Job ja vinculado a outra proposta.' USING ERRCODE = '23505';
  END IF;
  IF v_job.proposal_id = p_proposal_id THEN
    RETURN v_job;
  END IF;
  IF v_job.status NOT IN ('scheduled', 'processing', 'retry')
    OR v_job.submitted_at IS NULL THEN
    RAISE EXCEPTION 'Job nao corresponde a uma submissao confirmada.' USING ERRCODE = '55000';
  END IF;

  -- Nao rejeitamos IDs do snapshot neste caminho: o chamador promete que o
  -- valor veio do mesmo objeto de resposta que trouxe fiancaRiskAnalysisStatus.
  -- A RPC antiga e a reconciliacao manual permanecem fechadas para esses IDs.
  UPDATE public.loft_proposal_cancellations
  SET proposal_id = p_proposal_id,
      updated_at = v_now
  WHERE id = p_job_id
    AND proposal_id IS NULL
  RETURNING * INTO v_job;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nao foi possivel vincular a proposta ao job.' USING ERRCODE = '40001';
  END IF;

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.attach_loft_proposal_id_from_submission(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.attach_loft_proposal_id_from_submission(uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.attach_loft_proposal_id_from_submission(uuid, text) IS
  'Vincula o ID devolvido diretamente pela resposta HTTP da submissao confirmada, inclusive quando a Loft reutiliza uma proposta do snapshot.';
