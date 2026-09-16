BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(10);

SELECT is(
  public.seller_easter_sunday(2026),
  date '2026-04-05',
  'calculo da Pascoa de 2026 esta correto'
);
SELECT ok(public.is_seller_business_holiday(date '2026-04-03'), 'sexta-feira santa e feriado');
SELECT ok(public.is_seller_business_holiday(date '2026-04-21'), 'Tiradentes e feriado');
SELECT is(
  public.next_seller_business_day(date '2026-09-19'),
  date '2026-09-21',
  'sabado avanca para segunda-feira'
);
SELECT is(
  public.next_seller_business_day(date '2026-09-07'),
  date '2026-09-08',
  'feriado em dia util avanca para o proximo dia'
);

SELECT has_column('public', 'seller_appointments', 'meeting_feedback', 'agenda armazena feedback da reuniao');
SELECT has_column('public', 'seller_appointments', 'follow_up_owner_type', 'follow-up identifica SDR ou Closer');
SELECT has_column('public', 'seller_appointments', 'follow_up_message_key', 'follow-up escolhe uma mensagem do WhatsApp');
SELECT has_function('public', 'complete_closer_meeting', ARRAY['uuid', 'text'], 'RPC de conclusao com feedback existe');
SELECT has_function('public', 'get_meeting_signup_links', ARRAY['uuid'], 'RPC contextual de cadastro existe');

SELECT * FROM finish();
ROLLBACK;
