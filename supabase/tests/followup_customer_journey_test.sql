BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(16);

SELECT has_column('public', 'seller_appointments', 'tracked_profile_id', 'follow-up guarda o perfil acompanhado');
SELECT has_column('public', 'seller_appointments', 'visible_from', 'follow-up guarda o momento em que aparece');
SELECT has_column('public', 'seller_appointments', 'journey_test_status', 'agenda suporta simulacao isolada da jornada');
SELECT has_column('public', 'seller_signup_link_send_events', 'appointment_id', 'envio identifica a reuniao de origem');
SELECT has_column('public', 'seller_signup_link_send_events', 'claimed_profile_id', 'envio identifica o cadastro resultante');
SELECT has_column('public', 'seller_signup_link_send_events', 'claimed_at', 'envio registra quando foi convertido');
SELECT has_function('public', 'record_meeting_signup_link_send', ARRAY['uuid', 'text', 'text', 'text'], 'RPC registra envio dentro da reuniao');
SELECT has_function('public', 'resolve_meeting_signup_link', ARRAY['uuid', 'text', 'text'], 'RPC valida o contexto antes do cadastro');
SELECT has_function('public', 'claim_seller_signup_link_for_meeting', ARRAY['uuid', 'text', 'uuid', 'text', 'text', 'text'], 'RPC liga cadastro, reuniao e follow-ups');
SELECT has_function('public', 'get_my_follow_up_journeys', ARRAY['uuid[]'], 'RPC entrega a jornada ao vendedor autenticado');
SELECT has_trigger('public', 'seller_appointments', 'trg_protect_required_seller_follow_up', 'follow-up automatico exige conclusao');
SELECT has_function('public', 'touch_seller_follow_up_journeys', ARRAY['uuid'], 'mudanca de jornada atualiza a agenda em tempo real');
SELECT has_trigger('public', 'consultas_credito', 'trg_notify_seller_follow_up_credit_change', 'consulta atualiza o follow-up em tempo real');
SELECT has_trigger('public', 'apolices', 'trg_notify_seller_follow_up_contract_change', 'contrato atualiza o follow-up em tempo real');
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.seller_appointments AS appointment
    WHERE appointment.source = 'meeting_follow_up'
      AND appointment.visible_from IS NULL
  ),
  'todos os follow-ups automaticos possuem horario de exibicao'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.seller_appointments AS appointment
    WHERE appointment.source = 'meeting_follow_up'
      AND appointment.journey_test_status IS NULL
      AND (appointment.visible_from AT TIME ZONE 'America/Sao_Paulo')::time <> time '10:00'
  ),
  'follow-ups reais aparecem as 10h do dia anterior'
);

SELECT * FROM finish();
ROLLBACK;
