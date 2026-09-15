-- Defesa em profundidade para workers antigos: o bloqueio comercial da Loft
-- nunca pode voltar a ser classificado como falha de seletor nem entrar em
-- tentativas automaticas que nao conseguem liberar a conta do parceiro.

CREATE OR REPLACE FUNCTION public.normalize_credpago_partner_block_error()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.message_redacted ~* (
    'CREDPAGO_ACCOUNT_BLOCKED|' ||
    'libera[cç][aã]o necess[aá]ria para criar contratos|' ||
    'plataforma de fian[cç]a.*bloquead[ao].*cria[cç][aã]o de contratos|' ||
    'solicite a libera[cç][aã]o.*time comercial da loft'
  ) THEN
    NEW.category := 'CREDPAGO_UNAVAILABLE';
    NEW.severity := 'ERROR';
    NEW.status := 'INTERVENCAO_NECESSARIA';
    NEW.initial_diagnosis :=
      'Conta autenticada, mas bloqueada pela Loft para criar contratos. Liberacao externa necessaria.';
    NEW.resolved_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_credpago_partner_block_error
  ON public.automation_errors;
CREATE TRIGGER trg_normalize_credpago_partner_block_error
BEFORE INSERT OR UPDATE OF message_redacted
ON public.automation_errors
FOR EACH ROW
EXECUTE FUNCTION public.normalize_credpago_partner_block_error();

CREATE OR REPLACE FUNCTION public.guard_credpago_partner_block_repair()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status NOT IN ('SUCCESS', 'ROLLED_BACK', 'MANUAL_REQUIRED')
    AND EXISTS (
      SELECT 1
      FROM public.automation_errors AS error
      WHERE error.id = NEW.error_id
        AND (
          error.category = 'CREDPAGO_UNAVAILABLE'
          OR error.message_redacted ~* (
            'CREDPAGO_ACCOUNT_BLOCKED|' ||
            'libera[cç][aã]o necess[aá]ria para criar contratos|' ||
            'plataforma de fian[cç]a.*bloquead[ao].*cria[cç][aã]o de contratos|' ||
            'solicite a libera[cç][aã]o.*time comercial da loft'
          )
        )
    )
  THEN
    NEW.status := 'MANUAL_REQUIRED';
    NEW.progress := 100;
    NEW.stage_message := 'Liberacao externa necessaria; tentativas automaticas pausadas.';
    NEW.result_summary :=
      'A conta precisa ser liberada pela Loft antes de novas simulacoes.';
    NEW.failure_reason :=
      'CREDPAGO_ACCOUNT_BLOCKED: conta bloqueada pelo parceiro para criar contratos.';
    NEW.finished_at := coalesce(NEW.finished_at, clock_timestamp());
    NEW.lease_expires_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_credpago_partner_block_repair
  ON public.repair_jobs;
CREATE TRIGGER trg_guard_credpago_partner_block_repair
BEFORE INSERT OR UPDATE OF status
ON public.repair_jobs
FOR EACH ROW
EXECUTE FUNCTION public.guard_credpago_partner_block_repair();

-- Normaliza os incidentes que chegaram entre a primeira correcao e o deploy
-- do worker novo, incluindo a consulta que motivou este hotfix.
UPDATE public.automation_errors
SET message_redacted = message_redacted
WHERE message_redacted ~* (
  'CREDPAGO_ACCOUNT_BLOCKED|' ||
  'libera[cç][aã]o necess[aá]ria para criar contratos|' ||
  'plataforma de fian[cç]a.*bloquead[ao].*cria[cç][aã]o de contratos|' ||
  'solicite a libera[cç][aã]o.*time comercial da loft'
);

UPDATE public.repair_jobs AS job
SET status = job.status
FROM public.automation_errors AS error
WHERE error.id = job.error_id
  AND error.category = 'CREDPAGO_UNAVAILABLE'
  AND job.status NOT IN ('SUCCESS', 'ROLLED_BACK', 'MANUAL_REQUIRED');

UPDATE public.consultas_credito AS consultation
SET status = 'erro',
    resultado = 'erro',
    automation_step = 'aguardando_liberacao_parceiro',
    mensagem =
      'A integracao da Loft aguarda liberacao para criar contratos. Tente novamente apos a liberacao.',
    error_message =
      'A integracao da Loft aguarda liberacao para criar contratos. Tente novamente apos a liberacao.',
    updated_at = clock_timestamp()
WHERE consultation.status IN ('pendente', 'processando', 'erro')
  AND EXISTS (
    SELECT 1
    FROM public.automation_errors AS error
    WHERE error.simulation_id = consultation.id
      AND error.category = 'CREDPAGO_UNAVAILABLE'
  );

REVOKE ALL ON FUNCTION public.normalize_credpago_partner_block_error() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_credpago_partner_block_repair() FROM PUBLIC;

COMMENT ON FUNCTION public.normalize_credpago_partner_block_error() IS
  'Normaliza no banco o bloqueio comercial da Loft mesmo quando reportado por um worker antigo.';
COMMENT ON FUNCTION public.guard_credpago_partner_block_repair() IS
  'Impede retries automaticos para bloqueios que dependem de liberacao externa da Loft.';
