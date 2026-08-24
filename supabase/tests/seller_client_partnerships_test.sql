BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(13);

SELECT has_table('public', 'seller_client_partnerships', 'seller client partnerships table exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.seller_client_partnerships'::regclass),
  'seller client partnerships uses RLS'
);
SELECT ok(
  has_table_privilege('authenticated', 'public.seller_client_partnerships', 'SELECT'),
  'authenticated can read partnerships through RLS'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.seller_client_partnerships', 'INSERT'),
  'authenticated cannot bypass registration RPC with direct inserts'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.seller_client_partnerships', 'UPDATE'),
  'authenticated cannot update partnerships directly'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.seller_client_partnerships', 'DELETE'),
  'authenticated cannot delete partnerships directly'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.seller_client_partnerships', 'SELECT'),
  'anonymous users cannot read partnerships'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.register_my_seller_client(text)', 'EXECUTE'),
  'authenticated sellers can register clients through the RPC'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.get_my_seller_clients()', 'EXECUTE'),
  'authenticated sellers can list their clients'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.get_my_seller_client_monthly_history()', 'EXECUTE'),
  'authenticated sellers can read monthly history'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.get_my_seller_client_contracts(integer,integer)', 'EXECUTE'),
  'authenticated sellers can read contract details'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.register_my_seller_client(text)', 'EXECUTE'),
  'anonymous users cannot register seller clients'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.seller_client_contract_events_for(uuid)',
    'EXECUTE'
  ),
  'internal contract event helper is not directly callable by authenticated users'
);

SELECT * FROM finish();
ROLLBACK;
