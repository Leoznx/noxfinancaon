BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(11);

SELECT has_table('public', 'seller_team_goals',
  'configuracao compartilhada de metas existe');
SELECT has_column('public', 'seller_team_goals', 'seller_type',
  'meta compartilhada identifica a equipe');
SELECT has_column('public', 'seller_team_goals', 'target_meetings_daily',
  'meta compartilhada possui reunioes diarias');
SELECT has_column('public', 'seller_team_goals', 'target_clients_monthly',
  'meta compartilhada possui cadastros mensais');
SELECT has_function(
  'public',
  'upsert_seller_team_goals',
  ARRAY['text', 'integer', 'integer', 'integer', 'integer', 'integer', 'integer', 'integer', 'integer'],
  'salvamento atomico da meta da equipe existe'
);
SELECT has_function('public', 'get_my_seller_goal_progress', ARRAY[]::text[],
  'consulta da meta do vendedor existe');
SELECT has_function('public', 'get_seller_team_goal_progress', ARRAY['integer', 'integer'],
  'consulta administrativa da equipe existe');

SELECT matches(
  pg_get_functiondef('public.get_my_seller_goal_progress()'::regprocedure),
  'seller_team_goals',
  'vendedor recebe a meta compartilhada do proprio time'
);
SELECT matches(
  pg_get_functiondef('public.get_my_seller_monthly_progress(integer,integer)'::regprocedure),
  'seller_team_goals',
  'resumo mensal legado tambem usa a meta compartilhada'
);
SELECT matches(
  pg_get_functiondef('public.get_seller_team_goal_progress(integer,integer)'::regprocedure),
  'goal\.seller_type = coalesce\(seller\.seller_type',
  'administracao aplica a mesma configuracao pelo tipo da equipe'
);
SELECT matches(
  pg_get_functiondef('public.upsert_seller_team_goals(text,integer,integer,integer,integer,integer,integer,integer,integer)'::regprocedure),
  'ON CONFLICT \(seller_type, month, year\) DO UPDATE',
  'salvar novamente atualiza a unica meta da equipe no mes'
);

SELECT * FROM finish();
ROLLBACK;
