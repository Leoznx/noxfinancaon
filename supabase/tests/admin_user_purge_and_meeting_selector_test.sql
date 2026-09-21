BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(8);

SELECT has_function(
  'public',
  'record_meeting_signup_selector_send',
  ARRAY['uuid', 'text', 'text', 'text', 'text'],
  'envio unico para a tela de escolha existe'
);
SELECT has_column(
  'public',
  'seller_signup_link_send_events',
  'send_group_id',
  'eventos agrupam os tres tokens em um envio'
);
SELECT like(
  pg_get_functiondef('public.record_meeting_signup_selector_send(uuid,text,text,text,text)'::regprocedure),
  '%record_meeting_signup_link_send%',
  'seletor reutiliza a validacao e atribuicao canonicas da reuniao'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.record_meeting_signup_selector_send(uuid,text,text,text,text)', 'EXECUTE'),
  'Closer autenticado pode registrar o envio do seletor'
);

SELECT has_function(
  'public',
  'admin_purge_user_data',
  ARRAY['uuid'],
  'purga administrativa integral existe'
);
SELECT ok(
  has_function_privilege('service_role', 'public.admin_purge_user_data(uuid)', 'EXECUTE'),
  'somente o backend privilegiado executa a purga'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.admin_purge_user_data(uuid)', 'EXECUTE'),
  'usuarios autenticados nao executam a purga diretamente'
);
SELECT like(
  pg_get_functiondef('public.admin_purge_user_data(uuid)'::regprocedure),
  '%seller_signup_attributions%',
  'purga remove os vinculos comerciais de SDR e Closer'
);

SELECT * FROM finish();
ROLLBACK;
