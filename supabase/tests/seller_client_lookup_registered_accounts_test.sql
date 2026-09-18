BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, private, extensions, pg_catalog;

SELECT plan(8);

SELECT has_function(
  'private',
  'resolve_seller_client_profile_id',
  ARRAY['text'],
  'resolvedor central de contas cadastradas existe'
);
SELECT function_returns(
  'private',
  'resolve_seller_client_profile_id',
  ARRAY['text'],
  'uuid',
  'resolvedor retorna o profile id canonico'
);
SELECT matches(
  pg_get_functiondef('private.resolve_seller_client_profile_id(text)'::regprocedure),
  'JOIN auth[.]users',
  'busca sempre valida a conta no banco de usuarios'
);
SELECT matches(
  pg_get_functiondef('private.resolve_seller_client_profile_id(text)'::regprocedure),
  'pendente_aprovacao',
  'conta cadastrada aguardando aprovacao pode ser vinculada'
);
SELECT matches(
  pg_get_functiondef('private.resolve_seller_client_profile_id(text)'::regprocedure),
  'deleted_at IS NULL',
  'conta removida do auth nao pode ser vinculada'
);
SELECT matches(
  pg_get_functiondef('public.lookup_seller_client_by_email(text)'::regprocedure),
  'resolve_seller_client_profile_id',
  'busca publica usa o resolvedor central'
);
SELECT matches(
  pg_get_functiondef('public.register_my_seller_client(text)'::regprocedure),
  'resolve_seller_client_profile_id',
  'cadastro manual usa a mesma regra da busca'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'private.resolve_seller_client_profile_id(text)',
    'EXECUTE'
  ),
  'resolvedor interno nao pode ser chamado diretamente pelo cliente'
);

SELECT * FROM finish();
ROLLBACK;
