BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(18);

SELECT has_function(
  'public',
  'backfill_shared_seller_control_goals',
  ARRAY[]::text[],
  'backfill de metas comerciais compartilhadas existe'
);
SELECT has_function(
  'public',
  'upsert_seller_control_goals',
  ARRAY['text', 'integer', 'integer', 'integer', 'integer'],
  'contrato legado de metas comerciais continua disponivel'
);
SELECT has_function(
  'public',
  'upsert_seller_team_goals_complete',
  ARRAY[
    'text', 'integer', 'integer', 'integer', 'integer', 'integer',
    'integer', 'integer', 'integer', 'integer', 'integer'
  ],
  'gravacao atomica das oito metas existe'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.upsert_seller_control_goals(text,integer,integer,integer,integer)',
    'EXECUTE'
  ),
  'authenticated pode chamar o contrato legado protegido internamente'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.upsert_seller_control_goals(text,integer,integer,integer,integer)',
    'EXECUTE'
  ),
  'anon nao pode gravar metas pelo contrato legado'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.upsert_seller_team_goals_complete(text,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer)',
    'EXECUTE'
  ),
  'authenticated pode chamar a gravacao atomica protegida internamente'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.upsert_seller_team_goals_complete(text,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer)',
    'EXECUTE'
  ),
  'anon nao pode chamar a gravacao atomica'
);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    'c1000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'shared-goals-admin@example.invalid', '', now(),
    '{}'::jsonb, '{"nome":"Shared Goals Admin"}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'c1000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'shared-goals-closer@example.invalid', '', now(),
    '{}'::jsonb, '{"nome":"Shared Goals Closer"}'::jsonb, now(), now()
  );

INSERT INTO public.internal_users (
  id, auth_user_id, full_name, email, role, status, seller_type
) VALUES
  (
    'c2000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000001',
    'Shared Goals Admin', 'shared-goals-admin@example.invalid',
    'admin_master', 'ativo', NULL
  ),
  (
    'c2000000-0000-4000-8000-000000000002',
    'c1000000-0000-4000-8000-000000000002',
    'Shared Goals Closer', 'shared-goals-closer@example.invalid',
    'vendedor', 'ativo', 'closer'
  );

SELECT set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);

SELECT is(
  public.upsert_seller_control_goals('sdr', 10, 2098, 40, 8)->'shared_seller_types',
  '["sdr", "closer"]'::jsonb,
  'contrato legado informa que a meta foi compartilhada'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.seller_team_goals
    WHERE month = 10 AND year = 2098
      AND seller_type IN ('sdr', 'closer')
  ),
  2::bigint,
  'contrato legado cria as duas configuracoes comerciais'
);
SELECT ok(
  (
    SELECT bool_and(
      target_calls_daily = 40
      AND target_leads_contacted_daily = 8
    )
    FROM public.seller_team_goals
    WHERE month = 10 AND year = 2098
      AND seller_type IN ('sdr', 'closer')
  ),
  'contrato legado sincroniza ligacoes e leads nas duas equipes'
);

SELECT public.upsert_seller_team_goals(
  'closer', 10, 2098,
  2, 10, 40,
  1, 5, 20
);

SELECT is(
  (public.upsert_seller_team_goals_complete(
    'sdr', 10, 2098,
    3, 15, 60,
    2, 10, 40,
    55, 11
  )->>'calls_daily')::integer,
  55,
  'gravacao completa retorna a nova meta visual'
);
SELECT ok(
  (
    SELECT bool_and(
      target_calls_daily = 55
      AND target_leads_contacted_daily = 11
    )
    FROM public.seller_team_goals
    WHERE month = 10 AND year = 2098
      AND seller_type IN ('sdr', 'closer')
  ),
  'gravacao completa sincroniza as metas compartilhadas'
);
SELECT is(
  (
    SELECT target_meetings_monthly
    FROM public.seller_team_goals
    WHERE seller_type = 'sdr' AND month = 10 AND year = 2098
  ),
  60,
  'gravacao completa atualiza a meta especifica da equipe selecionada'
);
SELECT is(
  (
    SELECT target_meetings_monthly
    FROM public.seller_team_goals
    WHERE seller_type = 'closer' AND month = 10 AND year = 2098
  ),
  40,
  'gravacao completa preserva a meta especifica da outra equipe'
);
SELECT is(
  (
    public.seller_control_dashboard_for(
      'c2000000-0000-4000-8000-000000000002',
      'daily',
      '2098-10-15'
    )->'goals'->>'calls_daily'
  )::integer,
  55,
  'Closer recebe no dashboard a meta compartilhada salva por Vendedor'
);

INSERT INTO public.seller_team_goals (
  seller_type, month, year, target_calls_daily, target_leads_contacted_daily
) VALUES
  ('sdr', 11, 2097, 33, 7),
  ('closer', 11, 2097, NULL, NULL),
  ('sdr', 12, 2097, 44, 9),
  ('closer', 12, 2097, 22, 5);

SELECT ok(
  public.backfill_shared_seller_control_goals() >= 1,
  'backfill encontra configuracoes compartilhadas ausentes'
);
SELECT is(
  (
    SELECT target_calls_daily
    FROM public.seller_team_goals
    WHERE seller_type = 'closer' AND month = 11 AND year = 2097
  ),
  33,
  'backfill copia a meta ausente para a outra equipe'
);
SELECT is(
  (
    SELECT target_calls_daily
    FROM public.seller_team_goals
    WHERE seller_type = 'closer' AND month = 12 AND year = 2097
  ),
  22,
  'backfill nunca sobrescreve uma meta ja definida'
);

SELECT * FROM finish();
ROLLBACK;
