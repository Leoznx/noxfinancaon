BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(21);

SELECT has_table('public', 'broker_agency_signup_links', 'tabela de links permanentes existe');
SELECT has_table('public', 'broker_agency_signup_attributions', 'tabela de atribuicoes existe');
SELECT has_column('public', 'broker_agency_signup_links', 'token', 'link guarda token aleatorio');
SELECT has_column('public', 'broker_agency_signup_links', 'active', 'link pode ser administrativamente desativado');
SELECT has_column('public', 'broker_agency_signup_links', 'usage_count', 'link contabiliza cadastros concluidos');
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'broker_agency_signup_links'
      AND column_name = 'expires_at'
  ),
  'link nao possui expiracao'
);

SELECT ok(to_regprocedure('public.get_or_create_my_broker_agency_signup_link()') IS NOT NULL,
  'imobiliaria pode obter seu link');
SELECT ok(to_regprocedure('public.resolve_broker_agency_signup_link(text)') IS NOT NULL,
  'cadastro pode validar o link');
SELECT ok(to_regprocedure('public.claim_broker_agency_signup_link(text,uuid)') IS NOT NULL,
  'backend pode concluir o vinculo');

SELECT ok(has_function_privilege('authenticated', 'public.get_or_create_my_broker_agency_signup_link()', 'EXECUTE'),
  'usuario autenticado pode solicitar o proprio link');
SELECT ok(NOT has_function_privilege('anon', 'public.get_or_create_my_broker_agency_signup_link()', 'EXECUTE'),
  'visitante nao pode gerar link');
SELECT ok(has_function_privilege('anon', 'public.resolve_broker_agency_signup_link(text)', 'EXECUTE'),
  'visitante pode validar link no cadastro');
SELECT ok(has_function_privilege('authenticated', 'public.resolve_broker_agency_signup_link(text)', 'EXECUTE'),
  'usuario autenticado tambem pode validar link');
SELECT ok(has_function_privilege('service_role', 'public.claim_broker_agency_signup_link(text,uuid)', 'EXECUTE'),
  'somente backend autorizado conclui vinculo');
SELECT ok(NOT has_function_privilege('authenticated', 'public.claim_broker_agency_signup_link(text,uuid)', 'EXECUTE'),
  'cliente autenticado nao pode forcar vinculo');
SELECT ok(NOT has_function_privilege('anon', 'public.claim_broker_agency_signup_link(text,uuid)', 'EXECUTE'),
  'visitante nao pode forcar vinculo');

SELECT ok(NOT has_table_privilege('anon', 'public.broker_agency_signup_links', 'SELECT'),
  'visitante nao le tokens diretamente');
SELECT ok(NOT has_table_privilege('authenticated', 'public.broker_agency_signup_links', 'SELECT'),
  'cliente autenticado nao lista tokens diretamente');
SELECT matches(
  pg_get_functiondef('public.get_or_create_my_broker_agency_signup_link()'::regprocedure),
  'current_imobiliaria_id',
  'link sempre pertence a imobiliaria da sessao'
);
SELECT matches(
  pg_get_functiondef('public.claim_broker_agency_signup_link(text,uuid)'::regprocedure),
  'usage_count = usage_count \+ 1',
  'cada novo corretor incrementa o uso uma unica vez'
);
SELECT unlike(
  pg_get_functiondef('public.claim_broker_agency_signup_link(text,uuid)'::regprocedure),
  'active = false',
  'uso nao consome nem expira o link'
);

SELECT * FROM finish();
ROLLBACK;
