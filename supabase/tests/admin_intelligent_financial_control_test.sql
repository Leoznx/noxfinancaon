BEGIN;
SELECT plan(5);

SELECT ok(
  to_regprocedure('public.get_admin_contract_billing_overview()') IS NOT NULL,
  'visao financeira administrativa existe'
);
SELECT ok(
  to_regprocedure('public.get_finance_dashboard_summary()') IS NOT NULL,
  'resumo financeiro canonico existe'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.get_admin_contract_billing_overview()', 'EXECUTE'),
  'anonimo nao acessa contratos financeiros'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.get_admin_contract_billing_overview()', 'EXECUTE'),
  'usuario autenticado pode chamar a RPC, sujeita a autorizacao interna'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_admin_contract_billing_overview' AND p.prosecdef
  ),
  'RPC usa security definer e valida o papel internamente'
);

SELECT * FROM finish();
ROLLBACK;
