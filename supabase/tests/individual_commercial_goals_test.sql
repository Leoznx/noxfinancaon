BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(8);

SELECT has_column('public', 'seller_goals', 'target_clients_daily',
  'meta individual de cadastros por dia existe');
SELECT has_column('public', 'seller_goals', 'target_clients_weekly',
  'meta individual de cadastros por semana existe');
SELECT has_function('public', 'count_seller_goal_registrations',
  ARRAY['uuid', 'timestamp with time zone', 'timestamp with time zone'],
  'contador deduplicado de cadastros existe');
SELECT has_function('public', 'get_my_seller_goal_progress', ARRAY[]::text[],
  'progresso individual do vendedor existe');
SELECT has_function('public', 'get_seller_team_goal_progress', ARRAY['integer', 'integer'],
  'progresso administrativo individual existe');

SELECT matches(
  pg_get_functiondef('public.count_seller_goal_registrations(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure),
  'seller_signup_attributions',
  'cadastros por link alimentam a meta'
);
SELECT matches(
  pg_get_functiondef('public.get_seller_team_goal_progress(integer,integer)'::regprocedure),
  'appointment\.sdr_id = seller\.id',
  'reuniao agendada alimenta a meta do SDR'
);
SELECT matches(
  pg_get_functiondef('public.get_seller_team_goal_progress(integer,integer)'::regprocedure),
  'appointment\.status = ''concluido''',
  'reuniao concluida alimenta a meta do Closer'
);

SELECT * FROM finish();
ROLLBACK;
