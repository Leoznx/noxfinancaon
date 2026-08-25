BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(31);

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.apolices'::regclass), 'apolices uses RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.mensalidades'::regclass), 'mensalidades uses RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.faturas_inquilino'::regclass), 'faturas_inquilino uses RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.comissoes'::regclass), 'comissoes uses RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sinistros'::regclass), 'sinistros uses RLS');

SELECT ok(NOT EXISTS (
  SELECT 1
  FROM information_schema.role_table_grants
  WHERE grantee = 'anon'
    AND table_schema = 'public'
    AND table_name IN ('apolices', 'mensalidades', 'faturas_inquilino', 'comissoes', 'sinistros')
), 'anon has no dashboard table privileges');

SELECT ok(has_table_privilege('authenticated', 'public.apolices', 'SELECT'), 'authenticated reads apolices through RLS');
SELECT ok(has_table_privilege('authenticated', 'public.mensalidades', 'SELECT'), 'authenticated reads mensalidades through RLS');
SELECT ok(has_table_privilege('authenticated', 'public.faturas_inquilino', 'SELECT'), 'authenticated reads faturas through RLS');
SELECT ok(has_table_privilege('authenticated', 'public.comissoes', 'SELECT'), 'authenticated reads comissoes through RLS');
SELECT ok(has_table_privilege('authenticated', 'public.sinistros', 'SELECT'), 'authenticated reads sinistros through RLS');
SELECT ok(has_table_privilege('authenticated', 'public.sinistros', 'INSERT'), 'authenticated creates sinistros through RLS');

SELECT ok(NOT has_table_privilege('authenticated', 'public.apolices', 'INSERT'), 'client cannot create apolices directly');
SELECT ok(NOT has_table_privilege('authenticated', 'public.mensalidades', 'INSERT'), 'client cannot create mensalidades directly');
SELECT ok(NOT has_table_privilege('authenticated', 'public.comissoes', 'INSERT'), 'client cannot create comissoes directly');
SELECT ok(NOT has_table_privilege('authenticated', 'public.faturas_inquilino', 'INSERT'), 'client cannot create faturas directly');
SELECT ok(NOT has_table_privilege('authenticated', 'public.sinistros', 'UPDATE'), 'client cannot update sinistros directly');
SELECT ok(NOT has_table_privilege('authenticated', 'public.sinistros', 'DELETE'), 'client cannot delete sinistros directly');

SELECT ok(EXISTS (
  SELECT 1 FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'sinistros'
    AND policyname = 'Dashboard users read authorized claims' AND cmd = 'SELECT'
), 'sinistros has canonical read policy');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'sinistros'
    AND policyname = 'Dashboard users create claims for authorized policies' AND cmd = 'INSERT'
), 'sinistros has canonical insert policy');

SELECT ok(NOT has_function_privilege('anon', 'public.can_view_policy(uuid,uuid)', 'EXECUTE'), 'anon cannot execute can_view_policy');
SELECT ok(NOT has_function_privilege('anon', 'public.get_user_financial_summary()', 'EXECUTE'), 'anon cannot execute financial summary');
SELECT ok(NOT has_function_privilege('anon', 'public.get_my_commissions()', 'EXECUTE'), 'anon cannot execute commissions RPC');
SELECT ok(NOT has_function_privilege('anon', 'public.get_my_withdrawals()', 'EXECUTE'), 'anon cannot execute withdrawals RPC');
SELECT ok(NOT has_function_privilege('anon', 'public.get_my_commission_contracts()', 'EXECUTE'), 'anon cannot execute commission contracts RPC');
SELECT ok(NOT has_function_privilege('anon', 'public.get_finance_dashboard_summary()', 'EXECUTE'), 'anon cannot execute finance dashboard RPC');
SELECT ok(NOT has_function_privilege('anon', 'public.list_finance_commissions()', 'EXECUTE'), 'anon cannot list finance commissions');

SELECT ok(NOT has_function_privilege('anon', 'public.find_corretor(text,text)', 'EXECUTE'), 'anonymous users cannot enumerate broker data');
SELECT ok(has_function_privilege('anon', 'public.validar_ativacao_token(text,text)', 'EXECUTE'), 'public activation remains available');
SELECT ok(has_function_privilege('anon', 'public.criar_lead_site_publico(text,text,text,text,text,text)', 'EXECUTE'), 'public lead capture remains available');

SELECT ok(NOT EXISTS (
  SELECT 1
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND has_function_privilege('anon', p.oid, 'EXECUTE')
    AND p.oid NOT IN (
      'public.validar_ativacao_token(text,text)'::regprocedure,
      'public.criar_lead_site_publico(text,text,text,text,text,text)'::regprocedure
    )
), 'no other SECURITY DEFINER routine is exposed to anon');

SELECT * FROM finish();
ROLLBACK;
