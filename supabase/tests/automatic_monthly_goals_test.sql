BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(14);

SELECT has_column('public', 'seller_team_goals', 'generation_mode', 'origem da meta e registrada');
SELECT has_table('public', 'admin_goal_daily_notices', 'controle de aviso diario existe');
SELECT has_function('public', 'materialize_seller_team_goals_month', ARRAY['integer', 'integer'], 'geracao mensal existe');
SELECT has_function('public', 'get_seller_team_goal_configs', ARRAY['integer', 'integer'], 'leitura inteligente de configuracoes existe');
SELECT has_function('public', 'get_admin_goal_daily_notice', ARRAY[]::text[], 'aviso diario existe');

INSERT INTO public.seller_team_goals (
  seller_type, month, year,
  target_meetings_daily, target_meetings_weekly, target_meetings_monthly,
  target_clients_daily, target_clients_weekly, target_clients_monthly,
  target_calls_daily, target_leads_contacted_daily
) VALUES
  ('sdr', 10, 2096, 3, 15, 60, 2, 10, 40, 30, 8),
  ('closer', 10, 2096, 2, 10, 40, 1, 5, 20, 30, 8);

SELECT is(public.materialize_seller_team_goals_month(11, 2096), 2, 'gera as duas equipes no novo mes');
SELECT is(
  (SELECT target_meetings_daily FROM public.seller_team_goals WHERE seller_type = 'sdr' AND month = 11 AND year = 2096),
  5,
  'soma dois a meta diaria'
);
SELECT is(
  (SELECT target_clients_monthly FROM public.seller_team_goals WHERE seller_type = 'closer' AND month = 11 AND year = 2096),
  22,
  'soma dois a meta mensal'
);
SELECT is(
  (SELECT target_leads_contacted_daily FROM public.seller_team_goals WHERE seller_type = 'sdr' AND month = 11 AND year = 2096),
  10,
  'soma dois a meta compartilhada de contatos'
);
SELECT is(
  (SELECT generation_mode FROM public.seller_team_goals WHERE seller_type = 'sdr' AND month = 11 AND year = 2096),
  'automatic',
  'marca a competencia como automatica'
);
SELECT is(
  (SELECT generated_from_month FROM public.seller_team_goals WHERE seller_type = 'sdr' AND month = 11 AND year = 2096),
  '2096-10-01'::date,
  'registra a competencia de origem'
);
SELECT is(public.materialize_seller_team_goals_month(11, 2096), 0, 'geracao e idempotente');

UPDATE public.seller_team_goals
SET target_meetings_daily = 99, generation_mode = 'manual'
WHERE seller_type = 'sdr' AND month = 11 AND year = 2096;
SELECT is(public.materialize_seller_team_goals_month(11, 2096), 0, 'nao sobrescreve ajuste manual');
SELECT is(
  (SELECT target_meetings_daily FROM public.seller_team_goals WHERE seller_type = 'sdr' AND month = 11 AND year = 2096),
  99,
  'valor manual permanece intacto'
);

SELECT * FROM finish();
ROLLBACK;
