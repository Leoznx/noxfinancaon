-- =============================================================================
-- Dashboards: authenticated grants, least privilege, and canonical claim RLS.
--
-- GRANT authorizes the table operation. RLS then restricts which rows each
-- authenticated profile can access. Anonymous visitors do not need any access
-- to these operational dashboard tables.
-- =============================================================================

ALTER TABLE public.apolices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mensalidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faturas_inquilino ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comissoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sinistros ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  public.apolices,
  public.mensalidades,
  public.faturas_inquilino,
  public.comissoes,
  public.sinistros
FROM anon;

-- Remove inherited TRUNCATE/TRIGGER/REFERENCES grants and restore only what
-- client applications use. Financial writes remain in trusted RPCs and Edge
-- Functions running with service_role.
REVOKE ALL PRIVILEGES ON TABLE
  public.apolices,
  public.mensalidades,
  public.faturas_inquilino,
  public.comissoes,
  public.sinistros
FROM authenticated;

GRANT SELECT ON TABLE
  public.apolices,
  public.mensalidades,
  public.faturas_inquilino,
  public.comissoes,
  public.sinistros
TO authenticated;

GRANT INSERT ON TABLE public.sinistros TO authenticated;
GRANT ALL PRIVILEGES ON TABLE
  public.apolices,
  public.mensalidades,
  public.faturas_inquilino,
  public.comissoes,
  public.sinistros
TO service_role;

-- The policy relation covers brokers, agencies and their team, owner/billing
-- responsible, tenant, and authorized internal staff through can_view_policy.
DROP POLICY IF EXISTS "Users can view their own sinistros" ON public.sinistros;
DROP POLICY IF EXISTS "Admins can view all sinistros" ON public.sinistros;
DROP POLICY IF EXISTS "Users can insert their own sinistros" ON public.sinistros;
DROP POLICY IF EXISTS "Dashboard users read authorized claims" ON public.sinistros;
DROP POLICY IF EXISTS "Dashboard users create claims for authorized policies" ON public.sinistros;

CREATE POLICY "Dashboard users read authorized claims"
  ON public.sinistros
  FOR SELECT
  TO authenticated
  USING (public.can_view_policy(auth.uid(), apolice_id));

CREATE POLICY "Dashboard users create claims for authorized policies"
  ON public.sinistros
  FOR INSERT
  TO authenticated
  WITH CHECK (
    profile_id = auth.uid()
    AND public.can_view_policy(auth.uid(), apolice_id)
  );

-- Supabase default privileges had given anon EXECUTE on every new SECURITY
-- DEFINER routine. Close that surface and re-open only the three documented
-- public APIs used before sign-in.
DO $dashboard_permissions$
DECLARE
  routine record;
BEGIN
  FOR routine IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC, anon',
      routine.signature
    );
  END LOOP;
END
$dashboard_permissions$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.find_corretor(text, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validar_ativacao_token(text, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.criar_lead_site_publico(text, text, text, text, text, text)
  TO anon, authenticated, service_role;

-- Explicit dashboard RPC contract. Function bodies still validate auth.uid(),
-- profile ownership, and internal role permissions before returning data.
GRANT EXECUTE ON FUNCTION public.can_view_policy(uuid, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_financial_summary()
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_commissions()
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_withdrawals()
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_commission_contracts()
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_finance_dashboard_summary()
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_finance_withdrawals(
  text, text, date, date, text, uuid, text, bigint, bigint
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_finance_commissions()
  TO authenticated, service_role;
