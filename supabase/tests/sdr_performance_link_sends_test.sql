BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(8);

SELECT has_table(
  'public',
  'seller_signup_link_send_events',
  'historico de envios de links existe'
);
SELECT has_column(
  'public',
  'seller_signup_link_send_events',
  'seller_id',
  'envio identifica o vendedor responsavel'
);
SELECT has_column(
  'public',
  'seller_signup_link_send_events',
  'source_sdr_id',
  'envio compartilhado identifica o SDR de origem'
);
SELECT has_column(
  'public',
  'seller_signup_link_send_events',
  'profile_role',
  'envio identifica o perfil de cadastro'
);
SELECT has_column(
  'public',
  'seller_signup_link_send_events',
  'channel',
  'envio identifica o canal utilizado'
);
SELECT has_column(
  'public',
  'seller_signup_link_send_events',
  'created_at',
  'envio registra data e hora'
);
SELECT has_function(
  'public',
  'record_my_seller_signup_link_send',
  ARRAY['text', 'text', 'text'],
  'RPC autenticada de registro de envio existe'
);
SELECT is(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.seller_signup_link_send_events'::regclass
  ),
  true,
  'historico de envios usa RLS'
);

SELECT * FROM finish();
ROLLBACK;
