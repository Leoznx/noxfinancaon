
-- ============================================================
-- FASE 2 — Cargos, Permissões e Auditoria (Painel Admin NOX)
-- ============================================================

-- 1) CARGOS ADMIN ------------------------------------------------
CREATE TABLE public.cargos_admin (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave text NOT NULL UNIQUE,
  nome text NOT NULL,
  descricao text,
  is_sistema boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.cargos_admin TO authenticated;
GRANT ALL ON public.cargos_admin TO service_role;
ALTER TABLE public.cargos_admin ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin lê cargos" ON public.cargos_admin
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admin gerencia cargos" ON public.cargos_admin
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE TRIGGER trg_cargos_admin_updated
BEFORE UPDATE ON public.cargos_admin
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- 2) PERMISSÕES --------------------------------------------------
CREATE TABLE public.permissoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave text NOT NULL UNIQUE,
  modulo text NOT NULL,
  acao text NOT NULL,
  descricao text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.permissoes TO authenticated;
GRANT ALL ON public.permissoes TO service_role;
ALTER TABLE public.permissoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin lê permissões" ON public.permissoes
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admin gerencia permissões" ON public.permissoes
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));


-- 3) CARGO × PERMISSÃO -------------------------------------------
CREATE TABLE public.cargo_permissoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cargo_id uuid NOT NULL REFERENCES public.cargos_admin(id) ON DELETE CASCADE,
  permissao_id uuid NOT NULL REFERENCES public.permissoes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cargo_id, permissao_id)
);
GRANT SELECT ON public.cargo_permissoes TO authenticated;
GRANT ALL ON public.cargo_permissoes TO service_role;
ALTER TABLE public.cargo_permissoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin lê cargo_permissoes" ON public.cargo_permissoes
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admin gerencia cargo_permissoes" ON public.cargo_permissoes
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));


-- 4) USUÁRIOS INTERNOS -------------------------------------------
CREATE TABLE public.usuarios_internos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  cargo_id uuid NOT NULL REFERENCES public.cargos_admin(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ativo',
  criado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.usuarios_internos TO authenticated;
GRANT ALL ON public.usuarios_internos TO service_role;
ALTER TABLE public.usuarios_internos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin lê usuários internos" ON public.usuarios_internos
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Usuário interno vê próprio registro" ON public.usuarios_internos
  FOR SELECT TO authenticated USING (profile_id = auth.uid());
CREATE POLICY "Admin gerencia usuários internos" ON public.usuarios_internos
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE TRIGGER trg_usuarios_internos_updated
BEFORE UPDATE ON public.usuarios_internos
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- 5) AUDIT LOGS --------------------------------------------------
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  module text NOT NULL,
  performed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_id uuid,
  target_table text,
  old_value jsonb,
  new_value jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin lê audit logs" ON public.audit_logs
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Authenticated insere audit logs" ON public.audit_logs
  FOR INSERT TO authenticated WITH CHECK (performed_by = auth.uid());

CREATE INDEX idx_audit_logs_created_at ON public.audit_logs (created_at DESC);
CREATE INDEX idx_audit_logs_module ON public.audit_logs (module);
CREATE INDEX idx_audit_logs_performed_by ON public.audit_logs (performed_by);


-- 6) CAMPOS EXTRAS EM CONSULTAS ---------------------------------
ALTER TABLE public.consultas_credito
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS internal_notes text;


-- 7) FUNÇÃO has_permission --------------------------------------
CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _permission_key text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_admin(_user_id)
    OR EXISTS (
      SELECT 1
      FROM public.usuarios_internos ui
      JOIN public.cargo_permissoes cp ON cp.cargo_id = ui.cargo_id
      JOIN public.permissoes p ON p.id = cp.permissao_id
      JOIN public.cargos_admin c ON c.id = ui.cargo_id
      WHERE ui.profile_id = _user_id
        AND ui.status = 'ativo'
        AND c.ativo = true
        AND p.chave = _permission_key
    );
$$;


-- 8) SEED — Cargos padrão ---------------------------------------
INSERT INTO public.cargos_admin (chave, nome, descricao, is_sistema) VALUES
  ('admin_master', 'Admin Master', 'Acesso total à plataforma', true),
  ('financeiro', 'Financeiro', 'Gestão financeira, saques, comissões e faturamento', true),
  ('vendedor', 'Vendedor', 'Acompanhamento comercial de corretores, imobiliárias e leads', true),
  ('marketing', 'Marketing', 'Acesso a leads, campanhas e métricas', true),
  ('advogado', 'Jurídico', 'Sinistros, contratos e documentação legal', true),
  ('suporte', 'Suporte', 'Atendimento a usuários e visualização operacional', true)
ON CONFLICT (chave) DO NOTHING;


-- 9) SEED — Permissões ------------------------------------------
INSERT INTO public.permissoes (chave, modulo, acao, descricao) VALUES
  ('dashboard.view', 'dashboard', 'view', 'Ver dashboard admin'),
  ('consultas.view', 'consultas', 'view', 'Ver consultas'),
  ('consultas.approve', 'consultas', 'approve', 'Aprovar consulta'),
  ('consultas.reject', 'consultas', 'reject', 'Recusar consulta'),
  ('contratos.view', 'contratos', 'view', 'Ver contratos ativos'),
  ('contratos.manage', 'contratos', 'manage', 'Gerenciar contratos'),
  ('corretores.view', 'corretores', 'view', 'Ver corretores'),
  ('corretores.manage', 'corretores', 'manage', 'Gerenciar corretores'),
  ('imobiliarias.view', 'imobiliarias', 'view', 'Ver imobiliárias'),
  ('imobiliarias.manage', 'imobiliarias', 'manage', 'Gerenciar imobiliárias'),
  ('proprietarios.view', 'proprietarios', 'view', 'Ver proprietários'),
  ('proprietarios.manage', 'proprietarios', 'manage', 'Gerenciar proprietários'),
  ('inquilinos.view', 'inquilinos', 'view', 'Ver inquilinos'),
  ('inquilinos.manage', 'inquilinos', 'manage', 'Gerenciar inquilinos'),
  ('financeiro.view', 'financeiro', 'view', 'Ver financeiro'),
  ('financeiro.pay', 'financeiro', 'pay', 'Marcar pagamentos'),
  ('financeiro.view_bank_data', 'financeiro', 'view_bank_data', 'Ver dados bancários'),
  ('faturamento.view', 'faturamento', 'view', 'Ver faturamento'),
  ('faturamento.manage', 'faturamento', 'manage', 'Gerenciar faturas'),
  ('sinistros.view', 'sinistros', 'view', 'Ver sinistros'),
  ('sinistros.manage', 'sinistros', 'manage', 'Gerenciar sinistros'),
  ('leads.view', 'leads', 'view', 'Ver leads'),
  ('leads.manage', 'leads', 'manage', 'Gerenciar leads'),
  ('aprovacoes.view', 'aprovacoes', 'view', 'Ver aprovações pendentes'),
  ('aprovacoes.decide', 'aprovacoes', 'decide', 'Decidir aprovações'),
  ('usuarios.view', 'usuarios', 'view', 'Ver usuários internos'),
  ('usuarios.create', 'usuarios', 'create', 'Criar usuários internos'),
  ('usuarios.manage', 'usuarios', 'manage', 'Gerenciar usuários internos'),
  ('permissoes.view', 'permissoes', 'view', 'Ver cargos e permissões'),
  ('permissoes.manage', 'permissoes', 'manage', 'Gerenciar cargos e permissões'),
  ('auditoria.view', 'auditoria', 'view', 'Ver logs de auditoria'),
  ('configuracoes.view', 'configuracoes', 'view', 'Ver configurações'),
  ('configuracoes.manage', 'configuracoes', 'manage', 'Gerenciar configurações')
ON CONFLICT (chave) DO NOTHING;


-- 10) SEED — Vínculo cargo × permissão --------------------------
-- Admin Master: todas as permissões
INSERT INTO public.cargo_permissoes (cargo_id, permissao_id)
SELECT c.id, p.id
FROM public.cargos_admin c
CROSS JOIN public.permissoes p
WHERE c.chave = 'admin_master'
ON CONFLICT DO NOTHING;

-- Financeiro
INSERT INTO public.cargo_permissoes (cargo_id, permissao_id)
SELECT c.id, p.id
FROM public.cargos_admin c, public.permissoes p
WHERE c.chave = 'financeiro'
  AND p.chave IN (
    'dashboard.view','financeiro.view','financeiro.pay','financeiro.view_bank_data',
    'faturamento.view','faturamento.manage','contratos.view','inquilinos.view'
  )
ON CONFLICT DO NOTHING;

-- Vendedor
INSERT INTO public.cargo_permissoes (cargo_id, permissao_id)
SELECT c.id, p.id
FROM public.cargos_admin c, public.permissoes p
WHERE c.chave = 'vendedor'
  AND p.chave IN (
    'dashboard.view','corretores.view','corretores.manage','imobiliarias.view','imobiliarias.manage',
    'leads.view','leads.manage','consultas.view','contratos.view'
  )
ON CONFLICT DO NOTHING;

-- Marketing
INSERT INTO public.cargo_permissoes (cargo_id, permissao_id)
SELECT c.id, p.id
FROM public.cargos_admin c, public.permissoes p
WHERE c.chave = 'marketing'
  AND p.chave IN ('dashboard.view','leads.view','leads.manage')
ON CONFLICT DO NOTHING;

-- Advogado
INSERT INTO public.cargo_permissoes (cargo_id, permissao_id)
SELECT c.id, p.id
FROM public.cargos_admin c, public.permissoes p
WHERE c.chave = 'advogado'
  AND p.chave IN (
    'dashboard.view','sinistros.view','sinistros.manage','contratos.view','inquilinos.view'
  )
ON CONFLICT DO NOTHING;

-- Suporte
INSERT INTO public.cargo_permissoes (cargo_id, permissao_id)
SELECT c.id, p.id
FROM public.cargos_admin c, public.permissoes p
WHERE c.chave = 'suporte'
  AND p.chave IN (
    'dashboard.view','consultas.view','contratos.view','corretores.view','imobiliarias.view',
    'proprietarios.view','inquilinos.view','leads.view'
  )
ON CONFLICT DO NOTHING;
