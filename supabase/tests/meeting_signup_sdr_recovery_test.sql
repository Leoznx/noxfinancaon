BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(10);

SELECT has_function(
  'public',
  'claim_seller_signup_link_for_meeting',
  ARRAY['uuid', 'text', 'uuid', 'text', 'text', 'text'],
  'RPC contextual da reuniao continua disponivel'
);
SELECT matches(
  pg_get_functiondef('public.claim_seller_signup_link_for_meeting(uuid,text,uuid,text,text,text)'::regprocedure),
  'seller_contact_leads',
  'RPC consulta Leads do Dia para recuperar o SDR'
);
SELECT matches(
  pg_get_functiondef('public.claim_seller_signup_link_for_meeting(uuid,text,uuid,text,text,text)'::regprocedure),
  'lead.phone_normalized = v_profile_phone',
  'recuperacao exige telefone normalizado exato'
);
SELECT matches(
  pg_get_functiondef('public.claim_seller_signup_link_for_meeting(uuid,text,uuid,text,text,text)'::regprocedure),
  'seller_type = ''sdr''',
  'credito recuperado e registrado como SDR'
);
SELECT matches(
  pg_get_functiondef('public.claim_seller_signup_link_for_meeting(uuid,text,uuid,text,text,text)'::regprocedure),
  'assigned_closer_id = coalesce\(assigned_closer_id, v_closer_id\)',
  'Closer permanece associado a reuniao reparada'
);
SELECT matches(
  pg_get_functiondef('public.claim_seller_signup_link_for_meeting(uuid,text,uuid,text,text,text)'::regprocedure),
  'source_sdr_id = v_recovered_sdr.id',
  'eventos da reuniao passam a contabilizar o SDR'
);
SELECT matches(
  pg_get_functiondef('public.claim_seller_signup_link_for_meeting(uuid,text,uuid,text,text,text)'::regprocedure),
  'follow_up_owner_type = ''sdr''',
  'follow-ups pendentes voltam ao SDR originador'
);
SELECT matches(
  pg_get_functiondef('public.claim_seller_signup_link_for_meeting(uuid,text,uuid,text,text,text)'::regprocedure),
  'status NOT IN \(''concluido'', ''cancelado''\)',
  'historico concluido ou cancelado nao muda de dono'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.claim_seller_signup_link_for_meeting(uuid,text,uuid,text,text,text)',
    'EXECUTE'
  ),
  'service_role executa a atribuicao transacional'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.claim_seller_signup_link_for_meeting(uuid,text,uuid,text,text,text)',
    'EXECUTE'
  ),
  'cliente autenticado nao executa diretamente a RPC privilegiada'
);

SELECT * FROM finish();
ROLLBACK;
