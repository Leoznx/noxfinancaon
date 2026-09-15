-- O worker legado grava primeiro o erro generico na consulta e so depois
-- registra o incidente. Mantem a consulta sincronizada no proprio gatilho de
-- normalizacao para que cada nova tentativa volte imediatamente ao estado
-- correto, mesmo antes do deploy do worker atualizado na VPS.

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

    IF NEW.simulation_id IS NOT NULL THEN
      UPDATE public.consultas_credito
      SET status = 'erro',
          resultado = 'erro',
          automation_step = 'aguardando_liberacao_parceiro',
          mensagem =
            'A integracao da Loft aguarda liberacao para criar contratos. Tente novamente apos a liberacao.',
          error_message =
            'A integracao da Loft aguarda liberacao para criar contratos. Tente novamente apos a liberacao.',
          automation_finished_at = coalesce(automation_finished_at, clock_timestamp()),
          updated_at = clock_timestamp()
      WHERE id = NEW.simulation_id
        AND status IN ('pendente', 'processando', 'erro');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Dispara novamente o gatilho para corrigir consultas que o worker legado
-- sobrescreveu depois da migration anterior.
UPDATE public.automation_errors
SET message_redacted = message_redacted
WHERE message_redacted ~* (
  'CREDPAGO_ACCOUNT_BLOCKED|' ||
  'libera[cç][aã]o necess[aá]ria para criar contratos|' ||
  'plataforma de fian[cç]a.*bloquead[ao].*cria[cç][aã]o de contratos|' ||
  'solicite a libera[cç][aã]o.*time comercial da loft'
);

COMMENT ON FUNCTION public.normalize_credpago_partner_block_error() IS
  'Normaliza o bloqueio comercial da Loft e mantem a consulta sincronizada para workers legados.';
