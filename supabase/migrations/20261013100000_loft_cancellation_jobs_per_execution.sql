-- Uma unica execucao de credito pode enviar o formulario mais de uma vez
-- (recuperacao do portal/reclique) e criar mais de uma proposta externa. Cada
-- envio recebe um submission_token proprio; consultation_id e correlation_id
-- permanecem apenas como vinculos de auditoria e deliberadamente nao sao UNIQUE.
-- A migration preserva todos os jobs e todas as policies RLS existentes.

ALTER TABLE public.loft_proposal_cancellations
  ADD COLUMN IF NOT EXISTS submission_token uuid,
  ADD COLUMN IF NOT EXISTS known_proposal_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

ALTER TABLE public.loft_proposal_cancellations
  ALTER COLUMN status SET DEFAULT 'prepared',
  DROP CONSTRAINT IF EXISTS loft_proposal_cancellations_status_check,
  ADD CONSTRAINT loft_proposal_cancellations_status_check CHECK (status IN (
    'prepared', 'scheduled', 'processing', 'retry', 'cancelled', 'failed', 'aborted'
  ));

-- A limpeza administrativa de uma consulta nao pode apagar por cascade um
-- cancelamento ainda pendente. Jobs terminais preservam a auditoria sem PII;
-- para qualquer outro estado, o CHECK faz o DELETE da consulta falhar de forma
-- atomica quando a FK tenta colocar consultation_id em NULL.
ALTER TABLE public.loft_proposal_cancellations
  ALTER COLUMN consultation_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS loft_proposal_cancellations_consultation_id_fkey,
  DROP CONSTRAINT IF EXISTS loft_proposal_cancellations_consultation_terminal_check,
  ADD CONSTRAINT loft_proposal_cancellations_consultation_id_fkey
    FOREIGN KEY (consultation_id)
    REFERENCES public.consultas_credito(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT loft_proposal_cancellations_consultation_terminal_check
    CHECK (consultation_id IS NOT NULL OR status IN ('cancelled', 'aborted'));

-- O backfill atribui uma identidade distinta a cada job historico sem inferir
-- que consultation_id ou correlation_id representem uma submissao individual.
UPDATE public.loft_proposal_cancellations
SET submission_token = gen_random_uuid()
WHERE submission_token IS NULL;

ALTER TABLE public.loft_proposal_cancellations
  ALTER COLUMN submission_token SET DEFAULT gen_random_uuid(),
  ALTER COLUMN submission_token SET NOT NULL,
  DROP CONSTRAINT IF EXISTS loft_proposal_cancellations_consultation_id_key,
  DROP CONSTRAINT IF EXISTS loft_proposal_cancellations_correlation_id_key;

-- O UNIQUE antigo tambem fornecia o indice usado para reunir os jobs de uma
-- consulta. A nova cardinalidade e 1:N, portanto preservamos esse acesso com
-- um indice comum depois de remover a restricao.
CREATE INDEX IF NOT EXISTS loft_proposal_cancellations_consultation_idx
  ON public.loft_proposal_cancellations(consultation_id);

-- Um mesmo identificador externo nunca pode pertencer a dois envios. Se houver
-- dados historicos conflitantes, a migration para em vez de esconder a colisao.
CREATE UNIQUE INDEX IF NOT EXISTS loft_proposal_cancellations_proposal_id_key
  ON public.loft_proposal_cancellations(proposal_id)
  WHERE proposal_id IS NOT NULL;

-- O caminho normal do claim precisa provar rapidamente que nao existe uma
-- submissao preparada nem falha terminal confirmada. Sem este indice parcial,
-- cada polling varreria todo o historico de jobs ja cancelados.
CREATE INDEX IF NOT EXISTS loft_proposal_cancellations_attention_idx
  ON public.loft_proposal_cancellations(updated_at)
  WHERE status IN ('prepared', 'processing', 'retry')
     OR status = 'failed'
     OR (
       status = 'scheduled'
       AND submitted_at IS NOT NULL
       AND proposal_id IS NULL
     );

-- Jobs antigos sem ID externo foram criados sem um retrato das propostas que
-- ja existiam para o CPF/CNPJ. Eles nao podem ser reconciliados com seguranca:
-- falhar fechado e preferivel a cancelar uma proposta legitima anterior.
UPDATE public.loft_proposal_cancellations
SET status = 'failed',
    submitted_at = coalesce(submitted_at, created_at),
    worker_id = NULL,
    lease_expires_at = NULL,
    last_error = 'Job legado sem ID externo e sem snapshot seguro; requer reconciliacao manual.',
    updated_at = clock_timestamp()
WHERE proposal_id IS NULL
  AND status IN ('scheduled', 'processing', 'retry');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.loft_proposal_cancellations'::regclass
      AND conname = 'loft_proposal_cancellations_submission_token_key'
      AND contype = 'u'
  ) THEN
    ALTER TABLE public.loft_proposal_cancellations
      ADD CONSTRAINT loft_proposal_cancellations_submission_token_key
      UNIQUE (submission_token);
  END IF;
END;
$$;

-- A assinatura antiga confundia uma consulta com uma submissao e permitia que
-- um novo envio reaproveitasse o job de outra proposta. O DROP e transacional:
-- se qualquer instrucao posterior falhar, a funcao anterior e restaurada junto.
DROP FUNCTION IF EXISTS public.schedule_loft_proposal_cancellation(uuid, text, integer);
DROP FUNCTION IF EXISTS public.schedule_loft_proposal_cancellation(uuid, uuid, integer);

CREATE FUNCTION public.schedule_loft_proposal_cancellation(
  p_consultation_id uuid,
  p_submission_token uuid,
  p_known_proposal_ids text[],
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
  v_now timestamptz;
  v_delay_seconds integer := least(greatest(coalesce(p_delay_seconds, 1800), 60), 86400);
  v_known_proposal_ids text[];
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_submission_token IS NULL THEN
    RAISE EXCEPTION 'Token da submissao obrigatorio.' USING ERRCODE = '22023';
  END IF;
  -- Serializa schedule/abort do mesmo clique. Assim, uma resposta HTTP perdida
  -- nunca permite que um agendamento atrasado ressuscite um token ja abortado.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_submission_token::text, 0));
  v_now := clock_timestamp();
  IF p_known_proposal_ids IS NULL THEN
    -- NULL significa que o snapshot nao foi produzido; ARRAY[] significa que
    -- ele foi produzido e nao havia propostas anteriores. Misturar os dois
    -- casos permitiria ao fallback tratar uma proposta antiga como nova.
    RAISE EXCEPTION 'Snapshot de propostas obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_known_proposal_ids) > 500
    OR EXISTS (
      SELECT 1
      FROM unnest(p_known_proposal_ids) AS value
      WHERE value IS NULL OR trim(value) !~ '^[0-9]{4,12}$'
    ) THEN
    RAISE EXCEPTION 'Snapshot de propostas invalido.' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(array_agg(value ORDER BY value), ARRAY[]::text[])
  INTO v_known_proposal_ids
  FROM (
    SELECT DISTINCT trim(value) AS value
    FROM unnest(coalesce(p_known_proposal_ids, ARRAY[]::text[])) AS value
    WHERE trim(value) <> ''
  ) AS normalized;

  SELECT correlation_id INTO v_correlation_id
  FROM public.consultas_credito
  WHERE id = p_consultation_id
    AND origem = 'nox_financa';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consulta da automacao nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.loft_proposal_cancellations (
    submission_token,
    consultation_id,
    correlation_id,
    proposal_id,
    known_proposal_ids,
    status,
    scheduled_at,
    next_attempt_at
  ) VALUES (
    p_submission_token,
    p_consultation_id,
    v_correlation_id,
    NULL,
    v_known_proposal_ids,
    'prepared',
    v_now + make_interval(secs => v_delay_seconds),
    v_now + make_interval(secs => v_delay_seconds)
  )
  ON CONFLICT (submission_token) DO NOTHING
  RETURNING * INTO v_job;

  IF FOUND THEN
    RETURN v_job;
  END IF;

  -- Uma repeticao com o mesmo token devolve exatamente o job original, sem
  -- empurrar o prazo nem apagar lease, tentativas, resultado ou auditoria.
  SELECT * INTO v_job
  FROM public.loft_proposal_cancellations
  WHERE submission_token = p_submission_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job da submissao nao encontrado apos conflito.' USING ERRCODE = '40001';
  END IF;
  IF v_job.consultation_id IS DISTINCT FROM p_consultation_id
    OR v_job.correlation_id IS DISTINCT FROM v_correlation_id
    OR v_job.known_proposal_ids IS DISTINCT FROM v_known_proposal_ids THEN
    RAISE EXCEPTION 'Token da submissao ja pertence a outra execucao.' USING ERRCODE = '23505';
  END IF;
  IF v_job.status = 'aborted' THEN
    RAISE EXCEPTION 'A preparacao desta submissao foi abortada antes do clique.' USING ERRCODE = '55000';
  END IF;

  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.abort_loft_proposal_preparation(
  p_consultation_id uuid,
  p_submission_token uuid,
  p_known_proposal_ids text[]
)
RETURNS public.loft_proposal_cancellations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_correlation_id text;
  v_job public.loft_proposal_cancellations%ROWTYPE;
  v_now timestamptz;
  v_known_proposal_ids text[];
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role'
    AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_submission_token IS NULL THEN
    RAISE EXCEPTION 'Token da submissao obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF p_known_proposal_ids IS NULL
    OR cardinality(p_known_proposal_ids) > 500
    OR EXISTS (
      SELECT 1
      FROM unnest(p_known_proposal_ids) AS value
      WHERE value IS NULL OR trim(value) !~ '^[0-9]{4,12}$'
    ) THEN
    RAISE EXCEPTION 'Snapshot de propostas invalido.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_submission_token::text, 0));
  v_now := clock_timestamp();

  SELECT coalesce(array_agg(value ORDER BY value), ARRAY[]::text[])
  INTO v_known_proposal_ids
  FROM (
    SELECT DISTINCT trim(value) AS value
    FROM unnest(p_known_proposal_ids) AS value
    WHERE trim(value) <> ''
  ) AS normalized;

  SELECT correlation_id INTO v_correlation_id
  FROM public.consultas_credito
  WHERE id = p_consultation_id
    AND origem = 'nox_financa';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consulta da automacao nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  -- Se as duas respostas do schedule se perderam antes de sabermos se o banco
  -- gravou, o tombstone torna o abort idempotente e impede um schedule tardio.
  INSERT INTO public.loft_proposal_cancellations (
    submission_token,
    consultation_id,
    correlation_id,
    proposal_id,
    known_proposal_ids,
    status,
    scheduled_at,
    next_attempt_at
  ) VALUES (
    p_submission_token,
    p_consultation_id,
    v_correlation_id,
    NULL,
    v_known_proposal_ids,
    'aborted',
    v_now,
    v_now
  )
  ON CONFLICT (submission_token) DO NOTHING
  RETURNING * INTO v_job;

  IF FOUND THEN
    RETURN v_job;
  END IF;

  SELECT * INTO v_job
  FROM public.loft_proposal_cancellations
  WHERE submission_token = p_submission_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job da submissao nao encontrado apos conflito.' USING ERRCODE = '40001';
  END IF;
  IF v_job.consultation_id IS DISTINCT FROM p_consultation_id
    OR v_job.correlation_id IS DISTINCT FROM v_correlation_id
    OR v_job.known_proposal_ids IS DISTINCT FROM v_known_proposal_ids THEN
    RAISE EXCEPTION 'Token da submissao ja pertence a outra execucao.' USING ERRCODE = '23505';
  END IF;
  IF v_job.status = 'aborted' THEN
    RETURN v_job;
  END IF;
  IF v_job.status IS DISTINCT FROM 'prepared'
    OR v_job.submitted_at IS NOT NULL
    OR v_job.proposal_id IS NOT NULL THEN
    RAISE EXCEPTION 'A submissao pode ter sido enviada e nao pode ser abortada.' USING ERRCODE = '55000';
  END IF;

  UPDATE public.loft_proposal_cancellations
  SET status = 'aborted',
      worker_id = NULL,
      lease_expires_at = NULL,
      last_error = 'Preparacao abortada antes do clique de envio.',
      updated_at = v_now
  WHERE id = v_job.id
    AND status = 'prepared'
    AND submitted_at IS NULL
    AND proposal_id IS NULL
  RETURNING * INTO v_job;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'O estado da submissao mudou durante o abort.' USING ERRCODE = '40001';
  END IF;
  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_loft_proposal_submission(
  p_job_id uuid,
  p_submitted_at timestamptz,
  p_delay_seconds integer DEFAULT 1800
)
RETURNS public.loft_proposal_cancellations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_job public.loft_proposal_cancellations%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_submitted_at timestamptz := p_submitted_at;
  v_delay_seconds integer := least(greatest(coalesce(p_delay_seconds, 1800), 60), 86400);
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF v_submitted_at IS NULL
    OR v_submitted_at > v_now + interval '1 minute'
    OR v_submitted_at < v_now - interval '24 hours' THEN
    RAISE EXCEPTION 'Instante da submissao invalido.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job
  FROM public.loft_proposal_cancellations
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job de cancelamento nao encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.status = 'prepared' THEN
    UPDATE public.loft_proposal_cancellations
    SET status = 'scheduled',
        submitted_at = v_submitted_at,
        scheduled_at = v_submitted_at + make_interval(secs => v_delay_seconds),
        next_attempt_at = greatest(
          v_now,
          v_submitted_at + make_interval(secs => v_delay_seconds)
        ),
        updated_at = v_now
    WHERE id = p_job_id
      AND status = 'prepared'
    RETURNING * INTO v_job;
    RETURN v_job;
  END IF;
  IF v_job.submitted_at IS NOT NULL
    AND v_job.status IN ('scheduled', 'processing', 'retry', 'cancelled', 'failed') THEN
    IF abs(extract(epoch FROM (v_job.submitted_at - v_submitted_at))) > 1 THEN
      RAISE EXCEPTION 'Job ja confirmado com outro instante de submissao.' USING ERRCODE = '23505';
    END IF;
    RETURN v_job;
  END IF;

  RAISE EXCEPTION 'Job nao esta preparado para confirmar a submissao.' USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_loft_proposal_id(
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
  IF v_job.status NOT IN ('prepared', 'scheduled', 'processing', 'retry') THEN
    RAISE EXCEPTION 'Job nao aceita mais vinculo de proposta.' USING ERRCODE = '55000';
  END IF;
  IF p_proposal_id = ANY(v_job.known_proposal_ids) THEN
    RAISE EXCEPTION 'A proposta informada ja existia antes deste envio.' USING ERRCODE = '23505';
  END IF;

  UPDATE public.loft_proposal_cancellations
  SET proposal_id = p_proposal_id,
      updated_at = v_now
  WHERE id = p_job_id
    AND proposal_id IS NULL
  RETURNING * INTO v_job;

  IF NOT FOUND THEN
    -- O FOR UPDATE impede uma troca concorrente; esta verificacao mantem a
    -- falha fechada caso a linha seja alterada por codigo administrativo.
    RAISE EXCEPTION 'Nao foi possivel vincular a proposta ao job.' USING ERRCODE = '40001';
  END IF;

  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_loft_proposal_cancellation(
  p_job_id uuid,
  p_proposal_id text,
  p_submitted_at timestamptz DEFAULT NULL
)
RETURNS public.loft_proposal_cancellations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_job public.loft_proposal_cancellations%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_submitted_at timestamptz;
  v_delay_seconds integer;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role'
    AND session_user NOT IN ('postgres', 'supabase_admin') THEN
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
  IF v_job.status NOT IN ('prepared', 'scheduled', 'retry', 'failed') THEN
    RAISE EXCEPTION 'Job nao esta apto para reconciliacao.' USING ERRCODE = '55000';
  END IF;
  IF v_job.proposal_id IS NOT NULL AND v_job.proposal_id IS DISTINCT FROM p_proposal_id THEN
    RAISE EXCEPTION 'Job ja vinculado a outra proposta.' USING ERRCODE = '23505';
  END IF;
  IF p_proposal_id = ANY(v_job.known_proposal_ids) THEN
    RAISE EXCEPTION 'A proposta informada ja existia antes deste envio.' USING ERRCODE = '23505';
  END IF;

  IF p_submitted_at IS NOT NULL
    AND v_job.submitted_at IS NOT NULL
    AND abs(extract(epoch FROM (p_submitted_at - v_job.submitted_at))) > 1 THEN
    RAISE EXCEPTION 'Job ja confirmado com outro instante de submissao.' USING ERRCODE = '23505';
  END IF;
  v_submitted_at := coalesce(v_job.submitted_at, p_submitted_at, v_job.created_at);
  IF v_submitted_at > v_now + interval '1 minute'
    OR v_submitted_at < v_job.created_at - interval '5 minutes' THEN
    RAISE EXCEPTION 'Instante da submissao invalido para este job.' USING ERRCODE = '22023';
  END IF;

  -- Preserva o delay configurado quando o job foi preparado/confirmado. Isso
  -- evita cancelar antes dos 30 minutos (ou do override operacional) ao
  -- reconciliar manualmente uma submissao.
  v_delay_seconds := least(
    greatest(
      round(extract(epoch FROM (
        v_job.scheduled_at - coalesce(v_job.submitted_at, v_job.created_at)
      )))::integer,
      60
    ),
    86400
  );

  UPDATE public.loft_proposal_cancellations
  SET proposal_id = p_proposal_id,
      submitted_at = v_submitted_at,
      status = 'retry',
      scheduled_at = v_submitted_at + make_interval(secs => v_delay_seconds),
      next_attempt_at = greatest(
        v_now,
        v_submitted_at + make_interval(secs => v_delay_seconds)
      ),
      attempt_count = 0,
      worker_id = NULL,
      lease_expires_at = NULL,
      last_error = 'Job reconciliado manualmente com identificador externo exato.',
      updated_at = v_now
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.recover_expired_loft_proposal_cancellations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_recovered integer := 0;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
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

  GET DIAGNOSTICS v_recovered = ROW_COUNT;
  RETURN v_recovered;
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
  v_now timestamptz;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF length(trim(coalesce(p_worker_id, ''))) < 2 OR length(p_worker_id) > 160 THEN
    RAISE EXCEPTION 'Worker invalido.' USING ERRCODE = '22023';
  END IF;

  -- Somente um claim global decide se a fila esta livre por vez. Sem esse lock,
  -- SKIP LOCKED permitiria que uma segunda instancia pulasse um job em selecao
  -- e liberasse uma nova simulacao antes de enxergar o estado processing.
  PERFORM pg_advisory_xact_lock(hashtextextended('nox:loft-cancellation-claim', 0));
  v_now := clock_timestamp();

  -- Jobs inequivocamente identificados e vencidos sao drenados mesmo quando
  -- outra linha exige reconciliacao. O bloqueio global abaixo continua
  -- impedindo NOVOS envios, mas nunca atrasa um cancelamento seguro ja devido.
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
    -- A recuperacao de leases roda em uma RPC anterior e, portanto, ja foi
    -- confirmada em outra transacao. Assim, esta excecao nao desfaz a passagem
    -- de processing para retry/failed. Sem identidade exata, nenhuma linha e
    -- inferida por CPF/CNPJ.
    IF EXISTS (
      SELECT 1
      FROM public.loft_proposal_cancellations
      WHERE status = 'prepared'
         OR status = 'failed'
         OR (
           status IN ('scheduled', 'retry')
           AND submitted_at IS NOT NULL
           AND proposal_id IS NULL
         )
    ) THEN
      RAISE EXCEPTION 'A fila possui submissao sem confirmacao, sem identidade exata ou cancelamento terminal; reconciliacao necessaria.'
        USING ERRCODE = '55000';
    END IF;

    -- Uma falha real em backoff (ou um lease ainda ativo em outro worker) deve
    -- impedir novos envios. Quando o retry vencer, a selecao acima o adquire e
    -- uma conclusao bem-sucedida libera novamente a operacao.
    IF EXISTS (
      SELECT 1
      FROM public.loft_proposal_cancellations
      WHERE status IN ('processing', 'retry')
    ) THEN
      RAISE EXCEPTION 'A fila possui cancelamento em execucao ou aguardando retentativa.'
        USING ERRCODE = '55000';
    END IF;
    RETURN;
  END IF;

  UPDATE public.loft_proposal_cancellations
  SET status = 'processing',
      worker_id = p_worker_id,
      lease_expires_at = v_now + interval '10 minutes',
      attempt_count = attempt_count + 1,
      updated_at = v_now
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN NEXT v_job;
END;
$$;

-- Funcoes novas recebem EXECUTE de PUBLIC por padrao no PostgreSQL. Revogamos
-- explicitamente todos os clientes e concedemos apenas ao service_role.
REVOKE ALL ON FUNCTION public.schedule_loft_proposal_cancellation(uuid, uuid, text[], integer),
  public.abort_loft_proposal_preparation(uuid, uuid, text[]),
  public.confirm_loft_proposal_submission(uuid, timestamptz, integer),
  public.attach_loft_proposal_id(uuid, text),
  public.reconcile_loft_proposal_cancellation(uuid, text, timestamptz),
  public.recover_expired_loft_proposal_cancellations(),
  public.claim_next_loft_proposal_cancellation(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.schedule_loft_proposal_cancellation(uuid, uuid, text[], integer),
  public.abort_loft_proposal_preparation(uuid, uuid, text[]),
  public.confirm_loft_proposal_submission(uuid, timestamptz, integer),
  public.attach_loft_proposal_id(uuid, text),
  public.reconcile_loft_proposal_cancellation(uuid, text, timestamptz),
  public.recover_expired_loft_proposal_cancellations(),
  public.claim_next_loft_proposal_cancellation(text)
  TO service_role;

COMMENT ON CONSTRAINT loft_proposal_cancellations_submission_token_key
  ON public.loft_proposal_cancellations IS
  'Garante um unico job idempotente para cada envio real ao portal da Loft.';
COMMENT ON CONSTRAINT loft_proposal_cancellations_consultation_terminal_check
  ON public.loft_proposal_cancellations IS
  'Impede apagar uma consulta enquanto ainda existir cancelamento nao terminal.';
COMMENT ON COLUMN public.loft_proposal_cancellations.submission_token IS
  'UUID imutavel gerado pelo worker antes de cada clique que envia uma simulacao.';
COMMENT ON COLUMN public.loft_proposal_cancellations.known_proposal_ids IS
  'Snapshot de auditoria dos IDs ja existentes antes do clique; nunca substitui o ID exato devolvido pelo envio.';
COMMENT ON COLUMN public.loft_proposal_cancellations.submitted_at IS
  'Instante em que o clique de envio retornou e armou o prazo de cancelamento.';
COMMENT ON COLUMN public.loft_proposal_cancellations.consultation_id IS
  'Vinculo de auditoria nao exclusivo; torna-se NULL somente apos job terminal e exclusao da consulta.';
COMMENT ON COLUMN public.loft_proposal_cancellations.correlation_id IS
  'Vinculo de execucao nao exclusivo; recuperacoes podem produzir varias submissoes.';
COMMENT ON FUNCTION public.schedule_loft_proposal_cancellation(uuid, uuid, text[], integer) IS
  'Prepara antes do clique, ou devolve sem mutacao, o job com snapshot de IDs anteriores identificado pelo submission_token.';
COMMENT ON FUNCTION public.abort_loft_proposal_preparation(uuid, uuid, text[]) IS
  'Cria ou conclui um tombstone idempotente apenas enquanto o clique comprovadamente ainda nao ocorreu.';
COMMENT ON FUNCTION public.confirm_loft_proposal_submission(uuid, timestamptz, integer) IS
  'Confirma o clique de forma idempotente e preserva seu instante original como inicio do prazo.';
COMMENT ON FUNCTION public.attach_loft_proposal_id(uuid, text) IS
  'Preenche uma unica vez um ID externo que nao existia no snapshot anterior; repeticao igual e idempotente, valor diferente e rejeitado.';
COMMENT ON FUNCTION public.reconcile_loft_proposal_cancellation(uuid, text, timestamptz) IS
  'Libera um job bloqueado somente com ID externo exato informado por service_role ou administrador do banco, preservando snapshot e delay.';
COMMENT ON FUNCTION public.recover_expired_loft_proposal_cancellations() IS
  'Recupera leases expirados em transacao propria para que um bloqueio posterior da fila nao reverta a recuperacao.';
COMMENT ON FUNCTION public.claim_next_loft_proposal_cancellation(text) IS
  'Adquire com lease somente o proximo job vencido que possui ID externo exato; bloqueios exigem reconciliacao ou retentativa.';
