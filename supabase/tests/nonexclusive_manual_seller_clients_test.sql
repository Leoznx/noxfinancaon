BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(10);

SELECT has_column(
  'public',
  'seller_signup_attributions',
  'manual_relationship',
  'credito manual registra a relacao declarada'
);

SELECT has_function(
  'public',
  'lookup_manual_seller_client_by_email',
  ARRAY['text'],
  'busca especifica do cadastro manual existe'
);

SELECT has_function(
  'public',
  'register_my_manual_seller_client',
  ARRAY['text', 'text'],
  'cadastro manual recebe email e tipo de relacao'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.seller_signup_attributions'::regclass
      AND conname = 'seller_signup_attributions_registered_profile_id_seller_type_key'
  ),
  'credito nao e mais exclusivo por cliente e funcao'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'seller_signup_attributions'
      AND indexname = 'seller_signup_attributions_profile_seller_type_key'
      AND indexdef LIKE '%registered_profile_id, seller_id, seller_type%'
  ),
  'cada vendedor mantem um unico credito por cliente e funcao'
);

SELECT matches(
  pg_get_functiondef('public.register_my_manual_seller_client(text,text)'::regprocedure),
  'apresentou.*captou',
  'backend exige apresentou ou captou'
);

SELECT matches(
  pg_get_functiondef('public.register_my_manual_seller_client(text,text)'::regprocedure),
  'manual_relationship',
  'tipo de relacao e persistido no credito'
);

SELECT matches(
  pg_get_functiondef('public.lookup_manual_seller_client_by_email(text)'::regprocedure),
  'seller_id = v_seller_id',
  'busca prioriza o vinculo do vendedor atual'
);

SELECT matches(
  pg_get_functiondef('public.claim_seller_signup_link(text,uuid,text,text,text)'::regprocedure),
  'registered_profile_id, seller_id, seller_type',
  'links continuam idempotentes com a nova chave'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.register_my_manual_seller_client(text,text)',
    'EXECUTE'
  ),
  'anonimos nao podem criar creditos manuais'
);

SELECT * FROM finish();
ROLLBACK;
