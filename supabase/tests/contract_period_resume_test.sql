BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(12);

SELECT has_function(
  'public',
  'guard_contract_period_after_commitment',
  ARRAY[]::text[],
  'a proteção do período continua instalada'
);

SELECT has_function(
  'public',
  'contract_period_has_irreversible_commitment',
  ARRAY['uuid']::text[],
  'pagamento, assinatura concluída e apólice ativa têm verificação própria'
);

SELECT has_function(
  'public',
  'begin_contract_period_change',
  ARRAY['uuid', 'integer']::text[],
  'a troca segura reserva exclusivamente a proposta'
);

SELECT has_function(
  'public',
  'finish_contract_period_change',
  ARRAY['uuid', 'integer']::text[],
  'a troca segura possui finalização atômica'
);

SELECT ok(
  position(
    'interval ''5 minutes''' IN
    pg_get_functiondef('public.guard_contract_period_after_commitment()'::regprocedure)
  ) > 0,
  'lock recente continua protegendo uma integração em andamento'
);

SELECT ok(
  position(
    'nox.contract_period_replan' IN
    pg_get_functiondef('public.guard_contract_period_after_commitment()'::regprocedure)
  ) > 0,
  'somente o fluxo service role pode concluir o replanejamento reservado'
);

SELECT ok(
  position(
    'FROM public.asaas_payments AS payment' IN
    pg_get_functiondef('public.guard_contract_period_after_commitment()'::regprocedure)
  ) > 0,
  'cobranças pendentes exigem o fluxo seguro antes da alteração direta'
);

SELECT ok(
  position(
    'FROM public.contract_signatures AS signature' IN
    pg_get_functiondef('public.guard_contract_period_after_commitment()'::regprocedure)
  ) > 0,
  'assinaturas pendentes exigem cancelamento seguro antes da substituição'
);

SELECT ok(
  position(
    'FROM public.faturas_inquilino AS invoice' IN
    pg_get_functiondef('public.guard_contract_period_after_commitment()'::regprocedure)
  ) > 0,
  'faturas confirmadas continuam sendo compromisso irreversível'
);

SELECT ok(
  position(
    'Período só pode ser alterado antes do primeiro pagamento' IN
    pg_get_functiondef('public.contract_period_has_irreversible_commitment(uuid)'::regprocedure)
    || pg_get_functiondef('public.finish_contract_period_change(uuid,integer)'::regprocedure)
  ) > 0,
  'o bloqueio irreversível preserva a mensagem de domínio'
);

SELECT has_table(
  'public',
  'contract_signature_superseded_documents',
  'webhooks de documentos substituídos continuam reconhecíveis'
);

SELECT ok(EXISTS (
  SELECT 1
  FROM pg_trigger
  WHERE tgrelid = 'public.consultas_credito'::regclass
    AND tgname = 'guard_contract_period_after_commitment'
    AND NOT tgisinternal
), 'trigger continua ativo na consulta');

SELECT * FROM finish();
ROLLBACK;
