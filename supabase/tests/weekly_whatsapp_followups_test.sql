BEGIN;
SELECT plan(21);

SELECT has_table('public', 'weekly_whatsapp_followups', 'fila semanal existe');
SELECT has_table('public', 'weekly_whatsapp_followup_opt_outs', 'opt-out existe');
SELECT has_table('public', 'weekly_whatsapp_followup_settings', 'configuração existe');
SELECT has_table(
  'public',
  'weekly_whatsapp_followup_excluded_phones',
  'números operacionais e de teste possuem bloqueio dedicado'
);

SELECT has_column('public', 'weekly_whatsapp_followups', 'recipient_profile_id', 'fila guarda o login');
SELECT has_column('public', 'weekly_whatsapp_followups', 'scheduled_at', 'fila guarda o horário aleatório');
SELECT has_column('public', 'weekly_whatsapp_followups', 'provider_message_id', 'fila rastreia a Z-API');
SELECT has_column('public', 'weekly_whatsapp_followups', 'is_test', 'testes ficam auditados');
SELECT has_index(
  'public',
  'weekly_whatsapp_followups',
  'weekly_whatsapp_followups_phone_week_idx',
  'o banco impede duplicidade semanal por telefone'
);

SELECT has_function(
  'public',
  'plan_weekly_whatsapp_followups',
  ARRAY['timestamp with time zone'],
  'planejador semanal existe'
);
SELECT has_function(
  'public',
  'claim_due_weekly_whatsapp_followups',
  ARRAY['integer', 'timestamp with time zone'],
  'claim atômico existe'
);

SELECT function_privs_are(
  'public',
  'plan_weekly_whatsapp_followups',
  ARRAY['timestamp with time zone'],
  'authenticated',
  ARRAY[]::text[],
  'usuários não executam o planejador'
);

SELECT like(
  pg_get_functiondef('public.plan_weekly_whatsapp_followups(timestamp with time zone)'::regprocedure),
  '%internal_users%',
  'planejador exclui colaboradores NOX'
);
SELECT like(
  pg_get_functiondef('public.plan_weekly_whatsapp_followups(timestamp with time zone)'::regprocedure),
  '%America/Sao_Paulo%',
  'planejador usa o fuso comercial correto'
);
SELECT like(
  pg_get_functiondef('public.plan_weekly_whatsapp_followups(timestamp with time zone)'::regprocedure),
  '%interval ''10 minutes''%',
  'horários são distribuídos em intervalos de dez minutos'
);
SELECT like(
  pg_get_functiondef('public.plan_weekly_whatsapp_followups(timestamp with time zone)'::regprocedure),
  '%weekly_whatsapp_followup_excluded_phones%',
  'planejador nunca usa números de teste ou operacionais'
);
SELECT like(
  pg_get_functiondef('public.plan_weekly_whatsapp_followups(timestamp with time zone)'::regprocedure),
  '%PARTITION BY normalized.phone%',
  'planejador cria somente uma mensagem semanal por telefone'
);
SELECT like(
  pg_get_functiondef('public.claim_due_weekly_whatsapp_followups(integer,timestamp with time zone)'::regprocedure),
  '%weekly_whatsapp_followup_excluded_phones%',
  'claim aplica novamente o bloqueio do número de teste'
);
SELECT has_function(
  'public',
  'set_weekly_whatsapp_message_variant',
  ARRAY[]::text[],
  'rotacionador semanal existe'
);
SELECT like(
  pg_get_functiondef('public.set_weekly_whatsapp_message_variant()'::regprocedure),
  '%2026-01-05%',
  'rotacionador usa uma base semanal estável'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'followup-semanal-usuarios-nox'
      AND schedule = '*/10 12-20 * * 1-5'
  ),
  'cron executa em dias úteis durante a faixa comercial'
);

SELECT * FROM finish();
ROLLBACK;
