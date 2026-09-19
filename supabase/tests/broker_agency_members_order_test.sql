BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(5);

SELECT has_function(
  'public',
  'list_my_broker_agency_members',
  ARRAY[]::text[],
  'a listagem compartilhada de corretores existe'
);

SELECT matches(
  pg_get_functiondef('public.list_my_broker_agency_members()'::regprocedure),
  'UNION ALL',
  'ativos e pendentes continuam na mesma listagem'
);

SELECT matches(
  pg_get_functiondef('public.list_my_broker_agency_members()'::regprocedure),
  '\) members\s+ORDER BY',
  'a ordenacao atua sobre o resultado nomeado da uniao'
);

SELECT matches(
  pg_get_functiondef('public.list_my_broker_agency_members()'::regprocedure),
  'CASE members\.membership_status',
  'a ordenacao usa a coluna qualificada do resultado da uniao'
);

SELECT matches(
  pg_get_functiondef('public.list_my_broker_agency_members()'::regprocedure),
  'members\.linked_at DESC NULLS LAST',
  'os vinculos mais recentes continuam aparecendo primeiro'
);

SELECT * FROM finish();
ROLLBACK;
