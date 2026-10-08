-- Fila persistente para cancelamento de propostas Loft após o prazo operacional.
-- Não guarda CPF/CNPJ nem credenciais. O envio é feito pelo worker com service_role
-- e OAuth Client Credentials da API oficial da parceria.

CREATE TABLE IF NOT EXISTS public.loft_proposal_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL UNIQUE
    REFERENCES public.consultas_credito(id) ON DELETE CASCADE,
  correlation_id text NOT NULL,
  proposal_id text,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN (
    'scheduled', 'processing', 'retry', 'cancelled', 'failed'
  )),
  scheduled_at timestamptz NOT NULL,
  next_attempt_at timestamptz NOT NULL,
  worker_id text,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 12 CHECK (max_attempts BETWEEN 1 AND 30),
  cancellation_reason text,
  last_error text,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT loft_proposal_cancellations_correlation_format
    CHECK (correlation_id ~ '^NOX-SIM-[0-9]{8}-[A-F0-9]{8}$'),
  CONSTRAINT loft_proposal_cancellations_proposal_id_format
    CHECK (proposal_id IS NULL OR proposal_id ~ '^[0-9]{4,12}$'),
  CONSTRAINT loft_proposal_cancellations_error_length
    CHECK (last_error IS NULL OR length(last_error) <= 2000)
);

CREATE INDEX IF NOT EXISTS loft_proposal_cancellations_queue_idx
  ON public.loft_proposal_cancellations(next_attempt_at, created_at)
  WHERE status IN ('scheduled', 'retry');

ALTER TABLE public.loft_proposal_cancellations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.loft_proposal_cancellations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.loft_proposal_cancellations TO authenticated;
GRANT ALL ON public.loft_proposal_cancellations TO service_role;

DROP POLICY IF EXISTS "Automation admins read Loft cancellations"
  ON public.loft_proposal_cancellations;
CREATE POLICY "Automation admins read Loft cancellations"
  ON public.loft_proposal_cancellations FOR SELECT TO authenticated
  USING (public.is_automation_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.schedule_loft_proposal_cancellation(
  p_consultation_id uuid,
  p_proposal_id text DEFAULT NULL,
  p_delay_seconds integer DEFAULT 1800
)
RETURNS public.loft_proposal_cancellations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_correlation_id text;
  v_job public.loft_proposal_cancellations%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_delay_seconds integer := least(greatest(coalesce(p_delay_seconds, 1800), 60), 86400);
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_proposal_id IS NOT NULL AND p_proposal_id !~ '^[0-9]{4,12}$' THEN
    RAISE EXCEPTION 'Identificador de proposta invalido.' USING ERRCODE = '22023';
  END IF;

  SELECT correlation_id INTO v_correlation_id
  FROM public.consultas_credito
  WHERE id = p_consultation_id
    AND origem = 'nox_financa';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consulta da automacao nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.loft_proposal_cancellations (
    consultation_id, correlation_id, proposal_id, scheduled_at, next_attempt_at
  ) VALUES (
    p_consultation_id,
    v_correlation_id,
    p_proposal_id,
    v_now + make_interval(secs => v_delay_seconds),
    v_now + make_interval(secs => v_delay_seconds)
  )
  ON CONFLICT (consultation_id) DO UPDATE SET
    proposal_id = coalesce(
      EXCLUDED.proposal_id,
      public.loft_proposal_cancellations.proposal_id
    ),
    updated_at = v_now
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_next_loft_proposal_cancellation(p_worker_id text)
RETURNS SETOF public.loft_proposal_cancellations
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
  IF length(trim(coalesce(p_worker_id, ''))) < 2 OR length(p_worker_id) > 160 THEN
    RAISE EXCEPTION 'Worker invalido.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.loft_proposal_cancellations
  SET status = CASE WHEN attempt_count < max_attempts THEN 'retry' ELSE 'failed' END,
      next_attempt_at = v_now,
      worker_id = NULL,
      lease_expires_at = NULL,
      last_error = CASE
        WHEN attempt_count < max_attempts THEN 'Job recuperado apos perda de lease.'
        ELSE 'Numero maximo de tentativas atingido apos perda de lease.'
      END,
      updated_at = v_now
  WHERE status = 'processing'
    AND lease_expires_at IS NOT NULL
    AND lease_expires_at < v_now;

  SELECT * INTO v_job
  FROM public.loft_proposal_cancellations
  WHERE status IN ('scheduled', 'retry')
    AND proposal_id IS NOT NULL
    AND next_attempt_at <= v_now
    AND attempt_count < max_attempts
  ORDER BY next_attempt_at, created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.loft_proposal_cancellations
  SET status = 'processing',
      worker_id = p_worker_id,
      lease_expires_at = v_now + interval '2 minutes',
      attempt_count = attempt_count + 1,
      updated_at = v_now
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN NEXT v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_loft_proposal_cancellation(uuid, text, integer),
  public.claim_next_loft_proposal_cancellation(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_loft_proposal_cancellation(uuid, text, integer),
  public.claim_next_loft_proposal_cancellation(text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.touch_loft_proposal_cancellation_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_loft_proposal_cancellations_updated_at
  ON public.loft_proposal_cancellations;
CREATE TRIGGER trg_loft_proposal_cancellations_updated_at
BEFORE UPDATE ON public.loft_proposal_cancellations
FOR EACH ROW EXECUTE FUNCTION public.touch_loft_proposal_cancellation_updated_at();

COMMENT ON TABLE public.loft_proposal_cancellations IS
  'Fila sem PII para cancelamento auditavel de propostas pela API oficial da Loft.';
COMMENT ON COLUMN public.loft_proposal_cancellations.cancellation_reason IS
  'Motivo unico, verdadeiro e homologado efetivamente enviado; nunca escolhido aleatoriamente.';
