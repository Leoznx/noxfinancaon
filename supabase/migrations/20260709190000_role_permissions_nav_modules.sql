-- =============================================================================
-- role_permissions já existia e já tinha 38 linhas reais seedadas, mas nada no
-- app checava essa tabela pra decidir o que aparece no menu ou o que uma rota
-- libera — a UI de "Cargos e Permissões" só controlava uma matriz de ações
-- (ver/criar/editar/excluir/aprovar) sem nenhum efeito prático em Sidebar ou
-- ProtectedRoute. Esta migration:
--   1) adiciona can_export (a UI já tentava usar essa coluna, que não existia)
--   2) adiciona os módulos de NAVEGAÇÃO (um por item de sidebar do lado admin)
--      que faltavam, e semeia can_view=true só pro que cada cargo já
--      enxerga HOJE nos arrays estáticos de DashboardLayout.tsx — ou seja,
--      zero mudança de comportamento neste deploy; o banco vira fonte de
--      verdade só quando um admin mexer em algo pela UI.
-- =============================================================================

ALTER TABLE public.role_permissions
  ADD COLUMN IF NOT EXISTS can_export boolean NOT NULL DEFAULT false;

-- Preserva exatamente o que já está visível hoje pra cada cargo interno
-- (ver DashboardLayout.tsx: juridicoItems/financeiroItems/marketingItems/
-- suporteItems/vendedorItems) que ainda não tinha uma linha correspondente:
INSERT INTO public.role_permissions (role, module, can_view)
VALUES
  ('financeiro'::internal_role, 'faturas', true),
  ('marketing'::internal_role, 'afiliados', true),
  ('vendedor'::internal_role, 'agenda', true),
  ('vendedor'::internal_role, 'ranking', true)
ON CONFLICT (role, module) DO UPDATE SET can_view = true;
