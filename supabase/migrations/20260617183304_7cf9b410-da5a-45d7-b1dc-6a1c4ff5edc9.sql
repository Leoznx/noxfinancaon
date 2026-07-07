
-- ============================================================================
-- Camada de Colaboradores Internos NOX (aditivo, não altera tabelas atuais)
-- ============================================================================

-- Enum de cargos internos
DO $$ BEGIN
  CREATE TYPE public.internal_role AS ENUM (
    'admin_master', 'juridico', 'financeiro', 'marketing', 'suporte', 'vendedor'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.internal_user_status AS ENUM ('ativo','bloqueado','pendente');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===== internal_users =====
CREATE TABLE IF NOT EXISTS public.internal_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  phone text,
  role public.internal_role NOT NULL,
  status public.internal_user_status NOT NULL DEFAULT 'ativo',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.internal_users TO authenticated;
GRANT ALL ON public.internal_users TO service_role;
ALTER TABLE public.internal_users ENABLE ROW LEVEL SECURITY;

-- Security-definer helper
CREATE OR REPLACE FUNCTION public.has_internal_role(_uid uuid, _role public.internal_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.internal_users
    WHERE auth_user_id = _uid AND role = _role AND status='ativo'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_internal(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.internal_users WHERE auth_user_id=_uid AND status='ativo');
$$;

CREATE OR REPLACE FUNCTION public.get_internal_role(_uid uuid)
RETURNS public.internal_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT role FROM public.internal_users WHERE auth_user_id=_uid AND status='ativo' LIMIT 1;
$$;

CREATE POLICY "internal_users self read" ON public.internal_users FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid() OR public.has_internal_role(auth.uid(),'admin_master'));
CREATE POLICY "internal_users admin master write" ON public.internal_users FOR ALL TO authenticated
  USING (public.has_internal_role(auth.uid(),'admin_master'))
  WITH CHECK (public.has_internal_role(auth.uid(),'admin_master'));

-- ===== role_permissions =====
CREATE TABLE IF NOT EXISTS public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role public.internal_role NOT NULL,
  module text NOT NULL,
  can_view boolean NOT NULL DEFAULT false,
  can_create boolean NOT NULL DEFAULT false,
  can_edit boolean NOT NULL DEFAULT false,
  can_delete boolean NOT NULL DEFAULT false,
  can_approve boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(role, module)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_permissions TO authenticated;
GRANT ALL ON public.role_permissions TO service_role;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "role_perms read internal" ON public.role_permissions FOR SELECT TO authenticated
  USING (public.is_internal(auth.uid()));
CREATE POLICY "role_perms admin master write" ON public.role_permissions FOR ALL TO authenticated
  USING (public.has_internal_role(auth.uid(),'admin_master'))
  WITH CHECK (public.has_internal_role(auth.uid(),'admin_master'));

-- ===== sales_leads =====
CREATE TABLE IF NOT EXISTS public.sales_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assigned_seller_id uuid REFERENCES public.internal_users(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  phone text,
  email text,
  origin text,
  city text,
  type text,
  interest text,
  status text NOT NULL DEFAULT 'novo',
  next_action_at timestamptz,
  notes text,
  converted_consulta_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_leads TO authenticated;
GRANT ALL ON public.sales_leads TO service_role;
ALTER TABLE public.sales_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sales_leads seller read own" ON public.sales_leads FOR SELECT TO authenticated USING (
  public.has_internal_role(auth.uid(),'admin_master')
  OR public.has_internal_role(auth.uid(),'marketing')
  OR assigned_seller_id IN (SELECT id FROM public.internal_users WHERE auth_user_id=auth.uid())
);
CREATE POLICY "sales_leads marketing/admin write" ON public.sales_leads FOR ALL TO authenticated USING (
  public.has_internal_role(auth.uid(),'admin_master')
  OR public.has_internal_role(auth.uid(),'marketing')
  OR assigned_seller_id IN (SELECT id FROM public.internal_users WHERE auth_user_id=auth.uid())
) WITH CHECK (
  public.has_internal_role(auth.uid(),'admin_master')
  OR public.has_internal_role(auth.uid(),'marketing')
  OR assigned_seller_id IN (SELECT id FROM public.internal_users WHERE auth_user_id=auth.uid())
);

-- ===== seller_goals =====
CREATE TABLE IF NOT EXISTS public.seller_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES public.internal_users(id) ON DELETE CASCADE,
  month int NOT NULL,
  year int NOT NULL,
  target_contracts int NOT NULL DEFAULT 20,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(seller_id, month, year)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.seller_goals TO authenticated;
GRANT ALL ON public.seller_goals TO service_role;
ALTER TABLE public.seller_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "seller_goals read" ON public.seller_goals FOR SELECT TO authenticated USING (
  public.has_internal_role(auth.uid(),'admin_master')
  OR public.has_internal_role(auth.uid(),'financeiro')
  OR seller_id IN (SELECT id FROM public.internal_users WHERE auth_user_id=auth.uid())
);
CREATE POLICY "seller_goals admin write" ON public.seller_goals FOR ALL TO authenticated USING (
  public.has_internal_role(auth.uid(),'admin_master')
) WITH CHECK (public.has_internal_role(auth.uid(),'admin_master'));

-- ===== seller_commissions =====
CREATE TABLE IF NOT EXISTS public.seller_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES public.internal_users(id) ON DELETE CASCADE,
  contract_id uuid,
  month int NOT NULL,
  year int NOT NULL,
  commission_amount numeric(12,2) NOT NULL DEFAULT 0,
  bonus_amount numeric(12,2) NOT NULL DEFAULT 0,
  reserve_amount numeric(12,2) NOT NULL DEFAULT 0,
  released_amount numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pendente',
  eligible_at timestamptz,
  released_at timestamptz,
  clawback_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.seller_commissions TO authenticated;
GRANT ALL ON public.seller_commissions TO service_role;
ALTER TABLE public.seller_commissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "seller_commissions read" ON public.seller_commissions FOR SELECT TO authenticated USING (
  public.has_internal_role(auth.uid(),'admin_master')
  OR public.has_internal_role(auth.uid(),'financeiro')
  OR seller_id IN (SELECT id FROM public.internal_users WHERE auth_user_id=auth.uid())
);
CREATE POLICY "seller_commissions fin/admin write" ON public.seller_commissions FOR ALL TO authenticated USING (
  public.has_internal_role(auth.uid(),'admin_master') OR public.has_internal_role(auth.uid(),'financeiro')
) WITH CHECK (
  public.has_internal_role(auth.uid(),'admin_master') OR public.has_internal_role(auth.uid(),'financeiro')
);

-- ===== seller_performance =====
CREATE TABLE IF NOT EXISTS public.seller_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES public.internal_users(id) ON DELETE CASCADE,
  month int NOT NULL,
  year int NOT NULL,
  contracts_closed int NOT NULL DEFAULT 0,
  contracts_activated int NOT NULL DEFAULT 0,
  contracts_canceled int NOT NULL DEFAULT 0,
  generated_revenue_ltv numeric(12,2) NOT NULL DEFAULT 0,
  immediate_revenue numeric(12,2) NOT NULL DEFAULT 0,
  commission_total numeric(12,2) NOT NULL DEFAULT 0,
  bonus_total numeric(12,2) NOT NULL DEFAULT 0,
  total_estimated_gain numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(seller_id, month, year)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.seller_performance TO authenticated;
GRANT ALL ON public.seller_performance TO service_role;
ALTER TABLE public.seller_performance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "seller_perf read" ON public.seller_performance FOR SELECT TO authenticated USING (
  public.has_internal_role(auth.uid(),'admin_master')
  OR public.has_internal_role(auth.uid(),'financeiro')
  OR seller_id IN (SELECT id FROM public.internal_users WHERE auth_user_id=auth.uid())
);
CREATE POLICY "seller_perf admin write" ON public.seller_performance FOR ALL TO authenticated USING (
  public.has_internal_role(auth.uid(),'admin_master')
) WITH CHECK (public.has_internal_role(auth.uid(),'admin_master'));

-- ===== support_tickets =====
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'aberto',
  priority text NOT NULL DEFAULT 'media',
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES public.internal_users(id) ON DELETE SET NULL,
  forwarded_to public.internal_role,
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_tickets TO authenticated;
GRANT ALL ON public.support_tickets TO service_role;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tickets read" ON public.support_tickets FOR SELECT TO authenticated USING (
  user_id = auth.uid()
  OR public.has_internal_role(auth.uid(),'admin_master')
  OR public.has_internal_role(auth.uid(),'suporte')
  OR (forwarded_to IS NOT NULL AND public.has_internal_role(auth.uid(), forwarded_to))
);
CREATE POLICY "tickets insert" ON public.support_tickets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "tickets update internal" ON public.support_tickets FOR UPDATE TO authenticated USING (
  public.has_internal_role(auth.uid(),'admin_master') OR public.has_internal_role(auth.uid(),'suporte')
) WITH CHECK (
  public.has_internal_role(auth.uid(),'admin_master') OR public.has_internal_role(auth.uid(),'suporte')
);

-- ===== sales_materials =====
CREATE TABLE IF NOT EXISTS public.sales_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  type text NOT NULL,
  content text NOT NULL,
  tags text[],
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_materials TO authenticated;
GRANT ALL ON public.sales_materials TO service_role;
ALTER TABLE public.sales_materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "materials read internal" ON public.sales_materials FOR SELECT TO authenticated USING (
  public.is_internal(auth.uid())
);
CREATE POLICY "materials write mkt/admin" ON public.sales_materials FOR ALL TO authenticated USING (
  public.has_internal_role(auth.uid(),'admin_master') OR public.has_internal_role(auth.uid(),'marketing')
) WITH CHECK (
  public.has_internal_role(auth.uid(),'admin_master') OR public.has_internal_role(auth.uid(),'marketing')
);

-- ===== updated_at triggers =====
DO $$ BEGIN
  PERFORM 1; -- noop
END $$;
CREATE TRIGGER trg_internal_users_upd BEFORE UPDATE ON public.internal_users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_role_perms_upd BEFORE UPDATE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_sales_leads_upd BEFORE UPDATE ON public.sales_leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_seller_goals_upd BEFORE UPDATE ON public.seller_goals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_seller_comm_upd BEFORE UPDATE ON public.seller_commissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_seller_perf_upd BEFORE UPDATE ON public.seller_performance
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_tickets_upd BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_materials_upd BEFORE UPDATE ON public.sales_materials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== Funções de comissão do vendedor =====
CREATE OR REPLACE FUNCTION public.calcular_comissao_vendedor(contratos int)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF contratos <= 9 THEN RETURN 0;
  ELSIF contratos <= 13 THEN RETURN contratos * 25;
  ELSIF contratos <= 19 THEN RETURN contratos * 35;
  ELSE RETURN (20*50) + ((contratos-20)*80);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.calcular_bonus_vendedor(contratos int)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE b numeric := 0;
BEGIN
  IF contratos >= 20 THEN b := b + 300; END IF;
  IF contratos >= 30 THEN b := b + 600; END IF;
  IF contratos >= 40 THEN b := b + 1000; END IF;
  RETURN b;
END $$;

-- ===== Seed de permissões padrão =====
INSERT INTO public.role_permissions(role, module, can_view, can_create, can_edit, can_delete, can_approve) VALUES
  ('admin_master','*', true,true,true,true,true),
  ('juridico','aprovacoes', true,false,true,false,true),
  ('juridico','contratos', true,false,false,false,false),
  ('juridico','apolices', true,false,false,false,false),
  ('juridico','documentos', true,false,true,false,true),
  ('financeiro','financeiro', true,true,true,false,true),
  ('financeiro','faturamento', true,false,true,false,false),
  ('financeiro','comissoes', true,false,true,false,true),
  ('financeiro','saques', true,false,true,false,true),
  ('marketing','leads', true,true,true,true,false),
  ('marketing','materiais', true,true,true,true,false),
  ('marketing','blog', true,true,true,true,false),
  ('suporte','tickets', true,true,true,false,false),
  ('suporte','usuarios', true,false,false,false,false),
  ('vendedor','leads_proprios', true,false,true,false,false),
  ('vendedor','pipeline', true,false,true,false,false),
  ('vendedor','metas', true,false,false,false,false),
  ('vendedor','comissoes_proprias', true,false,false,false,false)
ON CONFLICT (role, module) DO NOTHING;
