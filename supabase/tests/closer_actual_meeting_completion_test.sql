BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(7);

SELECT has_column(
  'public',
  'seller_appointments',
  'actual_duration_minutes',
  'agenda armazena a duracao efetiva da reuniao'
);
SELECT col_type_is(
  'public',
  'seller_appointments',
  'actual_duration_minutes',
  'integer',
  'duracao efetiva e armazenada em minutos'
);
SELECT has_function(
  'public',
  'seller_meeting_actual_duration_minutes',
  ARRAY['timestamp with time zone', 'timestamp with time zone'],
  'funcao de calculo da duracao efetiva existe'
);
SELECT is(
  public.seller_meeting_actual_duration_minutes(
    timestamptz '2026-09-17 15:00:00-03',
    timestamptz '2026-09-17 15:42:10-03'
  ),
  43,
  'duracao parcial e arredondada para cima sem esperar a hora reservada'
);
SELECT has_trigger(
  'public',
  'seller_appointments',
  'trg_00_enforce_closer_meeting_completion',
  'conclusao de reuniao valida o Closer responsavel no banco'
);
SELECT ok(
  position(
    'scheduled_at + make_interval'
    IN pg_get_functiondef('public.complete_closer_meeting(uuid,text)'::regprocedure)
  ) = 0,
  'RPC nao exige mais o fim do horario reservado'
);
SELECT ok(
  position(
    'v_completed_at < v_meeting.scheduled_at'
    IN pg_get_functiondef('public.complete_closer_meeting(uuid,text)'::regprocedure)
  ) > 0,
  'RPC permite concluir a partir do inicio da reuniao'
);

SELECT * FROM finish();
ROLLBACK;
