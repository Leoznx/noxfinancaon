BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(8);

SELECT has_column(
  'public',
  'seller_signup_attributions',
  'source',
  'atribuicao comercial registra a origem'
);
SELECT col_is_nullable(
  'public',
  'seller_signup_attributions',
  'link_id',
  'cadastro manual nao exige link'
);
SELECT has_function(
  'public',
  'lookup_seller_client_by_email',
  ARRAY['text'],
  'busca automatica por e-mail existe'
);
SELECT has_function(
  'public',
  'register_my_seller_client',
  ARRAY['text'],
  'atribuicao manual por e-mail existe'
);
SELECT matches(
  pg_get_functiondef('public.lookup_seller_client_by_email(text)'::regprocedure),
  '''cliente''',
  'busca aceita contas NOX ativas alem dos tres perfis comerciais'
);
SELECT matches(
  pg_get_functiondef('public.register_my_seller_client(text)'::regprocedure),
  'seller_signup_attributions',
  'cadastro manual alimenta a fonte de metas e ranking'
);
SELECT matches(
  pg_get_functiondef('public.register_my_seller_client(text)'::regprocedure),
  '''manual''',
  'cadastro grava a origem manual'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.register_my_seller_client(text)', 'EXECUTE'),
  'anonimos nao podem atribuir clientes'
);

SELECT * FROM finish();
ROLLBACK;
