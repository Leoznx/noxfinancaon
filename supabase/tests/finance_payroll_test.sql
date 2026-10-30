BEGIN;
SELECT plan(11);

SELECT has_table('public', 'seller_monthly_payrolls', 'folha mensal dos vendedores existe');
SELECT has_table('public', 'seller_monthly_payroll_events', 'auditoria da folha existe');
SELECT has_function('public', 'list_seller_monthly_payroll', ARRAY['integer', 'integer'], 'listagem da folha existe');
SELECT has_function('public', 'mark_seller_monthly_payroll_paid', ARRAY['uuid', 'text'], 'baixa da folha existe');
SELECT ok(
  position('230000' in pg_get_functiondef('public.materialize_seller_monthly_payroll(integer,integer)'::regprocedure)) > 0,
  'salario fixo e R$ 2.300'
);
SELECT ok(
  position('1 month + 4 days' in pg_get_functiondef('public.materialize_seller_monthly_payroll(integer,integer)'::regprocedure)) > 0,
  'vencimento da folha e dia 05 do mes seguinte'
);
SELECT ok(
  position('cakto_payments' in pg_get_functiondef('public.get_finance_dashboard_summary()'::regprocedure)) = 0,
  'resumo financeiro nao depende da integracao Cakto removida'
);
SELECT ok(
  position('seller_payroll_payable_cents' in pg_get_functiondef('public.get_finance_dashboard_summary()'::regprocedure)) > 0,
  'resumo financeiro inclui folha a pagar'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.list_seller_monthly_payroll(integer,integer)', 'EXECUTE'),
  'anonimo nao consulta folha'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.list_seller_monthly_payroll(integer,integer)', 'EXECUTE'),
  'usuario autenticado pode chamar listagem protegida'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.mark_seller_monthly_payroll_paid(uuid,text)', 'EXECUTE'),
  'anonimo nao confirma pagamento da folha'
);

SELECT * FROM finish();
ROLLBACK;
