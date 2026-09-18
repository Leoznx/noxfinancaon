BEGIN;
SELECT plan(8);

SELECT has_function(
  'public',
  'get_my_seller_link_clients_activity',
  ARRAY[]::text[],
  'RPC individual de atividade dos clientes existe'
);

SELECT has_function_privilege(
  'authenticated',
  'public.get_my_seller_link_clients_activity()',
  'EXECUTE',
  'vendedor autenticado pode consultar sua carteira'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.get_my_seller_link_clients_activity()', 'EXECUTE'),
  'anonimo nao pode consultar a carteira comercial'
);

SELECT function_returns(
  'public',
  'get_my_seller_link_clients_activity',
  ARRAY[]::text[],
  'record',
  'RPC retorna linhas detalhadas'
);

SELECT function_lang_is(
  'public',
  'get_my_seller_link_clients_activity',
  ARRAY[]::text[],
  'plpgsql',
  'RPC usa validacao do vendedor autenticado'
);

SELECT function_is_security_definer(
  'public',
  'get_my_seller_link_clients_activity',
  ARRAY[]::text[],
  'RPC protege a leitura individual'
);

SELECT like(
  pg_get_functiondef('public.get_my_seller_link_clients_activity()'::regprocedure),
  '%attribution.seller_id = v_seller_id%',
  'consulta limita os dados ao SDR ou Closer atual'
);

SELECT like(
  pg_get_functiondef('public.get_my_seller_link_clients_activity()'::regprocedure),
  '%coalesce(attribution.source, ''link'') = ''link''%',
  'painel mostra apenas conversoes originadas por link'
);

SELECT * FROM finish();
ROLLBACK;
