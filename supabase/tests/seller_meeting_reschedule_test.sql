BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(6);

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

SELECT * FROM finish();
ROLLBACK;
