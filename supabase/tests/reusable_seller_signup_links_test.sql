BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(8);

SELECT has_trigger(
  'public',
  'profiles',
  'trg_auto_claim_seller_signup_from_auth_metadata',
  'novo perfil recupera automaticamente o credito comercial'
);
SELECT has_function(
  'public',
  'auto_claim_seller_signup_from_auth_metadata',
  ARRAY[]::text[],
  'funcao de recuperacao automatica existe'
);
SELECT matches(
  pg_get_functiondef('public.auto_claim_seller_signup_from_auth_metadata()'::regprocedure),
  'seller_link_token',
  'gatilho le o token persistido pelo backend'
);
SELECT matches(
  pg_get_functiondef('public.claim_seller_signup_link(text,uuid,text,text,text)'::regprocedure),
  'usage_count = usage_count \+ 1',
  'cada novo perfil incrementa o uso do link'
);
SELECT unlike(
  pg_get_functiondef('public.claim_seller_signup_link(text,uuid,text,text,text)'::regprocedure),
  'active = false',
  'link individual nunca e consumido'
);
SELECT unlike(
  pg_get_functiondef('public.claim_seller_signup_link_for_meeting(uuid,text,uuid,text,text,text)'::regprocedure),
  'ja foi vinculado a outro cadastro',
  'link da reuniao nao bloqueia o segundo cliente'
);
SELECT matches(
  pg_get_functiondef('public.claim_seller_signup_link_for_meeting(uuid,text,uuid,text,text,text)'::regprocedure),
  'claimed_profile_id = coalesce\(claimed_profile_id, p_profile_id\)',
  'auditoria da reuniao conserva o primeiro cliente sem consumir o link'
);
SELECT matches(
  pg_get_functiondef('public.claim_seller_signup_link_for_meeting(uuid,text,uuid,text,text,text)'::regprocedure),
  'tracked_profile_id = coalesce\(tracked_profile_id, p_profile_id\)',
  'reuso nao troca o cliente original nem os follow-ups'
);
SELECT * FROM finish();
ROLLBACK;
