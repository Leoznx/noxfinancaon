BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(5);

SELECT has_function(
  'public',
  'get_my_seller_link_clients_activity',
  ARRAY[]::text[],
  'carteira individual de clientes existe'
);

SELECT matches(
  pg_get_functiondef('public.get_my_seller_link_clients_activity()'::regprocedure),
  'seller_registration_credits_for',
  'carteira usa a mesma fonte canonica do ranking'
);

SELECT ok(
  position(
    'coalesce(attribution.source' IN
    pg_get_functiondef('public.get_my_seller_link_clients_activity()'::regprocedure)
  ) = 0,
  'carteira nao descarta mais cadastros manuais'
);

SELECT matches(
  pg_get_functiondef('public.ranking_vendedores(integer,integer)'::regprocedure),
  'count_seller_goal_registrations',
  'ranking contabiliza a fonte canonica de cadastros'
);

SELECT matches(
  pg_get_functiondef('public.count_seller_goal_registrations(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure),
  'seller_registration_credits_for',
  'contagem mensal inclui links e cadastros manuais'
);

SELECT * FROM finish();
ROLLBACK;
