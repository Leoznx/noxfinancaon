-- Suspende da fila manual as consultas em analise que continuam sem a
-- documentacao complementar depois de 5 horas dentro do expediente NOX.
--
-- Regra solicitada (America/Sao_Paulo):
--   * expediente de segunda a sexta, 08:00-18:00;
--   * a janela completa de 5 horas precisa caber no expediente;
--   * se ultrapassar 18:00, recomeca as 08:00 do proximo dia util e vence 13:00.

CREATE EXTENSION IF NOT EXISTS pg_cron;

ALTER TABLE public.consultas_credito
  ADD COLUMN IF NOT EXISTS documentos_prazo_iniciado_em timestamptz,
  ADD COLUMN IF NOT EXISTS documentos_prazo_limite_em timestamptz,
  ADD COLUMN IF NOT EXISTS documentos_faltantes_em timestamptz;

COMMENT ON COLUMN public.consultas_credito.documentos_prazo_iniciado_em IS
  'Inicio do prazo para documentacao complementar quando o resultado entra em analise.';
COMMENT ON COLUMN public.consultas_credito.documentos_prazo_limite_em IS
  'Vencimento do prazo de documentos calculado no expediente 08:00-18:00 America/Sao_Paulo.';
COMMENT ON COLUMN public.consultas_credito.documentos_faltantes_em IS
  'Momento em que a consulta foi suspensa da aprovacao manual por falta de documentos.';

CREATE OR REPLACE FUNCTION public.credit_document_business_deadline(
  p_started_at timestamptz,
  p_hours integer DEFAULT 5
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_local timestamp without time zone;
  v_candidate timestamp without time zone;
BEGIN
  IF p_started_at IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_hours < 1 OR p_hours > 10 THEN
    RAISE EXCEPTION 'p_hours must be between 1 and 10';
  END IF;

  v_local := p_started_at AT TIME ZONE 'America/Sao_Paulo';

  -- Move fins de semana para a proxima segunda-feira, as 08:00.
  WHILE extract(isodow FROM v_local) IN (6, 7) LOOP
    v_local := date_trunc('day', v_local) + interval '1 day 8 hours';
  END LOOP;

  IF v_local::time < time '08:00' THEN
    v_local := date_trunc('day', v_local) + interval '8 hours';
  ELSIF v_local::time >= time '18:00' THEN
    v_local := date_trunc('day', v_local) + interval '1 day 8 hours';
    WHILE extract(isodow FROM v_local) IN (6, 7) LOOP
      v_local := date_trunc('day', v_local) + interval '1 day 8 hours';
    END LOOP;
  END IF;

  v_candidate := v_local + make_interval(hours => p_hours);

  -- A janela inteira deve terminar ate as 18:00. Se nao couber, ela recomeca
  -- na abertura do proximo dia util, conforme a regra operacional solicitada.
  IF v_candidate::date <> v_local::date OR v_candidate::time > time '18:00' THEN
    v_local := date_trunc('day', v_local) + interval '1 day 8 hours';
    WHILE extract(isodow FROM v_local) IN (6, 7) LOOP
      v_local := date_trunc('day', v_local) + interval '1 day 8 hours';
    END LOOP;
    v_candidate := v_local + make_interval(hours => p_hours);
  END IF;

  RETURN v_candidate AT TIME ZONE 'America/Sao_Paulo';
END;
$$;

REVOKE ALL ON FUNCTION public.credit_document_business_deadline(timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_document_business_deadline(timestamptz, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_credit_document_deadline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entering_analysis boolean;
  v_started_at timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_entering_analysis := NEW.status::text IS NOT DISTINCT FROM 'em_analise';
  ELSE
    v_entering_analysis :=
      NEW.status::text IS NOT DISTINCT FROM 'em_analise'
      AND OLD.status::text IS DISTINCT FROM 'em_analise';
  END IF;

  IF NEW.status::text IS DISTINCT FROM 'em_analise' THEN
    RETURN NEW;
  END IF;

  IF NEW.substatus::text IS NOT DISTINCT FROM 'documentacao_complementar_enviada' THEN
    NEW.documentos_faltantes_em := NULL;
    RETURN NEW;
  END IF;

  IF v_entering_analysis OR NEW.documentos_prazo_limite_em IS NULL THEN
    -- Uma nova passagem pela automacao reativa a aprovacao e abre um novo prazo.
    IF NEW.substatus::text IS NOT DISTINCT FROM 'falta_documentos' THEN
      NEW.substatus := NULL;
    END IF;
    v_started_at := COALESCE(NEW.automation_finished_at, now());
    NEW.documentos_prazo_iniciado_em := v_started_at;
    NEW.documentos_prazo_limite_em := public.credit_document_business_deadline(v_started_at, 5);
    NEW.documentos_faltantes_em := NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_credit_document_deadline()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_prepare_credit_document_deadline ON public.consultas_credito;
CREATE TRIGGER trg_prepare_credit_document_deadline
BEFORE INSERT OR UPDATE OF status, substatus, automation_finished_at
ON public.consultas_credito
FOR EACH ROW EXECUTE FUNCTION public.prepare_credit_document_deadline();

-- Consultas antigas em analise passam a respeitar a mesma regra. O instante da
-- conclusao da automacao e a fonte preferida para nao prolongar prazos antigos.
UPDATE public.consultas_credito
SET documentos_prazo_iniciado_em = COALESCE(automation_finished_at, updated_at, created_at),
    documentos_prazo_limite_em = public.credit_document_business_deadline(
      COALESCE(automation_finished_at, updated_at, created_at),
      5
    )
WHERE status = 'em_analise'
  AND substatus IS DISTINCT FROM 'documentacao_complementar_enviada'
  AND documentos_prazo_limite_em IS NULL;

CREATE INDEX IF NOT EXISTS consultas_credito_documentos_prazo_idx
ON public.consultas_credito (documentos_prazo_limite_em)
WHERE status = 'em_analise'
  AND substatus IS DISTINCT FROM 'documentacao_complementar_enviada';

CREATE OR REPLACE FUNCTION public.process_expired_credit_document_deadlines()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_processed integer;
BEGIN
  WITH expired AS (
    UPDATE public.consultas_credito
    SET substatus = 'falta_documentos',
        documentos_faltantes_em = COALESCE(documentos_faltantes_em, now()),
        updated_at = now()
    WHERE status = 'em_analise'
      AND substatus IS DISTINCT FROM 'documentacao_complementar_enviada'
      AND substatus IS DISTINCT FROM 'falta_documentos'
      AND documentos_prazo_limite_em IS NOT NULL
      AND documentos_prazo_limite_em <= now()
    RETURNING id
  )
  SELECT count(*)::integer INTO v_processed FROM expired;

  RETURN v_processed;
END;
$$;

REVOKE ALL ON FUNCTION public.process_expired_credit_document_deadlines()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_expired_credit_document_deadlines()
  TO service_role;

CREATE OR REPLACE FUNCTION public.notify_requester_missing_credit_documents()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_name text := COALESCE(NULLIF(trim(NEW.tenant_name), ''), 'cliente');
BEGIN
  IF NEW.status::text IS DISTINCT FROM 'em_analise'
     OR NEW.substatus::text IS DISTINCT FROM 'falta_documentos'
     OR OLD.substatus::text IS NOT DISTINCT FROM 'falta_documentos'
     OR NEW.profile_id_solicitante IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.enqueue_important_notification(
    'falta-documentos:' || NEW.id || ':' || COALESCE(NEW.documentos_prazo_limite_em::text, 'sem-prazo'),
    NEW.profile_id_solicitante,
    'Falta de documentos',
    'A consulta de ' || v_tenant_name || ' foi pausada por falta de documentos. Envie a documentacao complementar para voltar a aprovacao manual.',
    'documentos_pendentes',
    'laranja',
    '/consultas/' || NEW.id || '/resultado'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_requester_missing_credit_documents ON public.consultas_credito;
CREATE TRIGGER trg_notify_requester_missing_credit_documents
AFTER UPDATE OF substatus ON public.consultas_credito
FOR EACH ROW EXECUTE FUNCTION public.notify_requester_missing_credit_documents();

-- Evita duplicar o job se a migration for reaplicada em ambiente de teste.
SELECT cron.unschedule('nox-expire-credit-document-deadlines')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'nox-expire-credit-document-deadlines'
);

SELECT cron.schedule(
  'nox-expire-credit-document-deadlines',
  '* * * * *',
  'SELECT public.process_expired_credit_document_deadlines();'
);

-- Processa imediatamente o backfill; depois o cron mantem a regra continuamente.
SELECT public.process_expired_credit_document_deadlines();

-- Casos de regressao da regra de horario. A migration falha se a politica mudar
-- sem uma decisao explicita.
DO $$
BEGIN
  IF public.credit_document_business_deadline('2026-08-03 07:00:00-03'::timestamptz, 5)
       IS DISTINCT FROM '2026-08-03 13:00:00-03'::timestamptz THEN
    RAISE EXCEPTION 'Business deadline regression before opening';
  END IF;

  IF public.credit_document_business_deadline('2026-08-03 13:00:00-03'::timestamptz, 5)
       IS DISTINCT FROM '2026-08-03 18:00:00-03'::timestamptz THEN
    RAISE EXCEPTION 'Business deadline regression inside same day';
  END IF;

  IF public.credit_document_business_deadline('2026-08-03 16:00:00-03'::timestamptz, 5)
       IS DISTINCT FROM '2026-08-04 13:00:00-03'::timestamptz THEN
    RAISE EXCEPTION 'Business deadline regression after closing';
  END IF;

  IF public.credit_document_business_deadline('2026-08-07 17:00:00-03'::timestamptz, 5)
       IS DISTINCT FROM '2026-08-10 13:00:00-03'::timestamptz THEN
    RAISE EXCEPTION 'Business deadline regression over weekend';
  END IF;
END;
$$;
