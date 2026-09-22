BEGIN;

SELECT plan(11);

SELECT has_function(
  'public',
  'admin_list_seller_client_portfolios',
  ARRAY[]::text[],
  'admin seller portfolios list exists'
);
SELECT has_function(
  'public',
  'admin_list_seller_portfolio_clients',
  ARRAY['uuid'],
  'admin seller portfolio clients list exists'
);
SELECT has_function(
  'public',
  'admin_unlink_seller_client',
  ARRAY['uuid', 'uuid'],
  'admin seller client unlink exists'
);

SELECT function_returns(
  'public',
  'admin_unlink_seller_client',
  ARRAY['uuid', 'uuid'],
  'jsonb',
  'unlink returns an auditable summary'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.admin_list_seller_client_portfolios()', 'EXECUTE'),
  'authenticated can call the portfolios guard'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.admin_list_seller_portfolio_clients(uuid)', 'EXECUTE'),
  'authenticated can call the clients guard'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.admin_unlink_seller_client(uuid,uuid)', 'EXECUTE'),
  'authenticated can call the unlink guard'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.admin_list_seller_client_portfolios()', 'EXECUTE'),
  'anonymous cannot list seller portfolios'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.admin_list_seller_portfolio_clients(uuid)', 'EXECUTE'),
  'anonymous cannot list seller clients'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.admin_unlink_seller_client(uuid,uuid)', 'EXECUTE'),
  'anonymous cannot unlink seller clients'
);
SELECT volatility_is(
  'public',
  'admin_list_seller_client_portfolios',
  ARRAY[]::text[],
  'stable',
  'seller portfolio listing is stable'
);

SELECT * FROM finish();
ROLLBACK;
