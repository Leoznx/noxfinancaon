BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(8);

SELECT has_function(
  'public',
  'seller_registration_credits_for',
  ARRAY['uuid'],
  'fonte canonica de creditos comerciais existe'
);
SELECT matches(
  pg_get_functiondef('public.seller_registration_credits_for(uuid)'::regprocedure),
  'seller_signup_attributions',
  'creditos incluem cadastros por link'
);
SELECT matches(
  pg_get_functiondef('public.seller_registration_credits_for(uuid)'::regprocedure),
  'seller_client_partnerships',
  'creditos preservam os vinculos legados'
);
SELECT matches(
  pg_get_functiondef('public.seller_client_contract_events_for(uuid)'::regprocedure),
  'seller_registration_credits_for',
  'contratos usam a atribuicao canonica'
);
SELECT matches(
  pg_get_functiondef('public.seller_client_contract_events_for(uuid)'::regprocedure),
  '''ativa''.*''active''',
  'somente contratos ativos entram na producao comercial'
);
SELECT matches(
  pg_get_functiondef('public.ranking_vendedores(integer,integer)'::regprocedure),
  'count_seller_goal_registrations',
  'ranking conta os cadastros atribuidos'
);
SELECT matches(
  pg_get_functiondef('public.ranking_vendedores(integer,integer)'::regprocedure),
  'seller_client_contract_events_for',
  'ranking expoe os contratos ativos atribuidos'
);
SELECT has_trigger(
  'public',
  'seller_signup_attributions',
  'trg_refresh_seller_commissions_after_credit',
  'novo credito reprocessa comissoes automaticamente'
);

SELECT * FROM finish();
ROLLBACK;
