-- A constraint consultas_credito_status_check (migration 20260616014333) não incluía os
-- status usados pelo fluxo de automação local CredPago (processando, recusado, em_analise,
-- erro), causando falha (23514) ao gravar o resultado da automação. Amplia a constraint
-- mantendo todos os valores legados já usados pelo restante do sistema.
ALTER TABLE public.consultas_credito DROP CONSTRAINT IF EXISTS consultas_credito_status_check;
ALTER TABLE public.consultas_credito ADD CONSTRAINT consultas_credito_status_check
  CHECK (status = ANY (ARRAY[
    'pendente'::text,
    'processando'::text,
    'aprovado'::text,
    'recusado'::text,
    'em_analise'::text,
    'erro'::text,
    'reprovado'::text,
    'pendente_documentacao'::text,
    'dados_complementares'::text,
    'finalizada'::text,
    'aguardando_ativacao'::text,
    'ativado'::text
  ]));
