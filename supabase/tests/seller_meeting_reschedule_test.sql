BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(12);

SELECT has_column(
  'public',
  'seller_appointments',
  'creation_notified_at',
  'agenda registra o envio da confirmacao de criacao ou reagendamento'
);

SELECT has_function(
  'public',
  'get_available_meeting_reschedule_slots',
  ARRAY['uuid', 'date', 'integer'],
  'agenda expoe os horarios livres para reagendamento'
);

SELECT has_table(
  'public',
  'seller_agenda_availability_events',
  'agenda possui canal seguro de invalidacao em tempo real'
);

SELECT has_trigger(
  'public',
  'seller_appointments',
  'trg_notify_seller_agenda_availability',
  'mudancas de reuniao invalidam os horarios em todos os logins'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'seller_agenda_availability_events'
  ),
  'mudancas de disponibilidade chegam em tempo real a SDR e Closer'
);

SELECT has_function(
  'public',
  'reschedule_seller_meeting',
  ARRAY['uuid', 'timestamp with time zone'],
  'agenda possui reagendamento atomico compartilhado'
);

SELECT has_function(
  'public',
  'reschedule_shared_sales_meeting',
  ARRAY['uuid', 'timestamp with time zone'],
  'contrato legado de reagendamento continua disponivel'
);

SELECT matches(
  pg_get_functiondef(
    'public.get_available_meeting_reschedule_slots(uuid,date,integer)'::regprocedure
  ),
  'get_available_closer_slots',
  'reuniao sem Closer valido consulta a distribuicao compartilhada'
);

SELECT matches(
  pg_get_functiondef(
    'public.get_available_meeting_reschedule_slots(uuid,date,integer)'::regprocedure
  ),
  'exclude_from_commercial_metrics',
  'Closer excluido das metricas tambem nao recebe reagendamento'
);

SELECT matches(
  pg_get_functiondef(
    'public.reschedule_seller_meeting(uuid,timestamp with time zone)'::regprocedure
  ),
  'SET seller_id = v_closer_id',
  'confirmacao normaliza o dono e o Closer da reuniao'
);

SELECT matches(
  pg_get_functiondef(
    'public.reschedule_seller_meeting(uuid,timestamp with time zone)'::regprocedure
  ),
  'get_available_closer_slots',
  'confirmacao recupera um Closer disponivel para reuniao legada'
);

SELECT matches(
  pg_get_functiondef(
    'public.reschedule_seller_meeting(uuid,timestamp with time zone)'::regprocedure
  ),
  'pg_advisory_xact_lock',
  'recuperacao do Closer mantem a reserva atomica do horario'
);

SELECT * FROM finish();
ROLLBACK;
