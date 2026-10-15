BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(9);

SELECT has_function(
  'public',
  'guard_contract_period_after_commitment',
  ARRAY[]::text[],
  'a proteção do período continua instalada'
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
    'NEW.contract_period_locked_at := NULL' IN
    pg_get_functiondef('public.guard_contract_period_after_commitment()'::regprocedure)
  ) > 0,
  'tentativa antiga sem efeito externo é liberada ao trocar o período'
);

SELECT ok(
  position(
    'FROM public.asaas_payments AS payment' IN
    pg_get_functiondef('public.guard_contract_period_after_commitment()'::regprocedure)
  ) > 0,
  'cobranças externas continuam protegidas'
);

SELECT ok(
  position(
    'FROM public.contract_signatures AS signature' IN
    pg_get_functiondef('public.guard_contract_period_after_commitment()'::regprocedure)
  ) > 0,
  'assinaturas externas continuam protegidas'
);

SELECT ok(
  position(
    'FROM public.faturas_inquilino AS invoice' IN
    pg_get_functiondef('public.guard_contract_period_after_commitment()'::regprocedure)
  ) > 0,
  'faturas confirmadas continuam protegidas'
);

SELECT ok(
  position(
    'DELETE FROM public.cakto_payments AS payment' IN
    pg_get_functiondef('public.guard_contract_period_after_commitment()'::regprocedure)
  ) > 0,
  'rascunhos locais da Cakto também são limpos'
);

SELECT ok(
  position(
    'DELETE FROM public.billing_operations AS operation' IN
    pg_get_functiondef('public.guard_contract_period_after_commitment()'::regprocedure)
  ) > 0,
  'reservas locais abandonadas são limpas para a retomada automática'
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
