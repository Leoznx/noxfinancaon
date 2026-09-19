BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(10);

SELECT has_function(
  'public',
  'check_admin_team_meeting_availability',
  ARRAY['uuid[]', 'timestamp with time zone', 'boolean'],
  'disponibilidade administrativa existe'
);
SELECT has_function(
  'public',
  'schedule_admin_team_meeting',
  ARRAY['text', 'text', 'timestamp with time zone', 'uuid[]', 'boolean'],
  'agendamento administrativo atomico existe'
);
SELECT has_function(
  'public',
  'cancel_admin_team_meeting',
  ARRAY['uuid'],
  'cancelamento administrativo existe'
);
SELECT function_privs_are(
  'public',
  'schedule_admin_team_meeting',
  ARRAY['text', 'text', 'timestamp with time zone', 'uuid[]', 'boolean'],
  'authenticated',
  ARRAY['EXECUTE'],
  'usuarios autenticados chamam o RPC, que valida o cargo internamente'
);
SELECT trigger_is(
  'public',
  'seller_appointments',
  'trg_guard_admin_team_appointment',
  'public',
  'guard_admin_team_appointment',
  'reunioes administrativas sao protegidas no banco'
);
SELECT trigger_is(
  'public',
  'automation_errors',
  'trg_notify_admin_automation_error',
  'public',
  'notify_admin_automation_error',
  'erros novos geram notificacao administrativa'
);
SELECT like(
  pg_get_functiondef('public.schedule_admin_team_meeting(text,text,timestamptz,uuid[],boolean)'::regprocedure),
  '%pg_advisory_xact_lock%',
  'agendamento serializa concorrentes do mesmo horario'
);
SELECT like(
  pg_get_functiondef('public.schedule_admin_team_meeting(text,text,timestamptz,uuid[],boolean)'::regprocedure),
  '%seller_appointment_blocks_availability%',
  'agendamento usa a regra canonica de conflito'
);
SELECT like(
  pg_get_functiondef('public.schedule_admin_team_meeting(text,text,timestamptz,uuid[],boolean)'::regprocedure),
  '%enqueue_important_notification%',
  'participantes recebem notificacao pelo sino e push'
);
SELECT like(
  pg_get_functiondef('public.notify_admin_automation_error()'::regprocedure),
  '%/admin/central-erros%',
  'alerta de erro abre a central correta'
);

SELECT * FROM finish();
ROLLBACK;
