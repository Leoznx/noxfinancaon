BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(13);

SELECT is(public.is_seller_shared_slot_within_business_hours('2026-09-17 11:00:00+00', 60), true, 'quinta aceita inicio as 08:00');
SELECT is(public.is_seller_shared_slot_within_business_hours('2026-09-17 14:00:00+00', 60), true, 'quinta aceita inicio as 11:00');
SELECT is(public.is_seller_shared_slot_within_business_hours('2026-09-17 15:00:00+00', 60), false, 'intervalo de almoco nao recebe reuniao');
SELECT is(public.is_seller_shared_slot_within_business_hours('2026-09-17 16:00:00+00', 60), true, 'quinta aceita retorno as 13:00');
SELECT is(public.is_seller_shared_slot_within_business_hours('2026-09-17 20:00:00+00', 60), true, 'quinta aceita ultima reuniao as 17:00');
SELECT is(public.is_seller_shared_slot_within_business_hours('2026-09-17 21:00:00+00', 60), false, 'quinta encerra as 18:00');
SELECT is(public.is_seller_shared_slot_within_business_hours('2026-09-18 19:00:00+00', 60), true, 'sexta aceita ultima reuniao as 16:00');
SELECT is(public.is_seller_shared_slot_within_business_hours('2026-09-18 20:00:00+00', 60), false, 'sexta encerra as 17:00');
SELECT is(public.is_seller_shared_slot_within_business_hours('2026-09-19 14:00:00+00', 60), false, 'sabado permanece fechado');
SELECT is(public.is_seller_shared_slot_within_business_hours('2026-09-17 17:30:00+00', 60), false, 'novos horarios comecam em hora cheia');

SELECT is(public.seller_appointment_blocks_availability('follow_up', 'agendado'), false, 'follow-up ativo e apenas lembrete');
SELECT is(public.seller_appointment_blocks_availability('reuniao', 'agendado'), true, 'reuniao ativa bloqueia o horario');
SELECT is(public.seller_appointment_blocks_availability('reuniao', 'cancelado'), false, 'reuniao cancelada libera o horario');

SELECT * FROM finish();
ROLLBACK;
