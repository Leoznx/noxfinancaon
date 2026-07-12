-- Painel Juridico: troca a aba "Usuarios" por "Sinistros" no menu lateral.
-- O menu do juridico e' inteiramente dirigido por role_permissions
-- (ver DashboardLayout.tsx/ADMIN_CATALOG) -- nao ha array separado por
-- cargo pra editar, entao a troca acontece via permissao mesmo.
UPDATE public.role_permissions
SET can_view = false, updated_at = now()
WHERE role = 'juridico' AND module = 'usuarios';

INSERT INTO public.role_permissions (role, module, can_view)
VALUES ('juridico', 'sinistros', true)
ON CONFLICT (role, module) DO UPDATE SET can_view = true, updated_at = now();

-- A RLS de sinistros so liberava leitura irrestrita pra admin/analista;
-- qualquer outro role cai na policy "profile_id = auth.uid()", que pra um
-- colaborador juridico da zero linhas (ele nao abre sinistro em nome
-- proprio). Sem isso, a aba nova ficaria sempre vazia pro juridico mesmo
-- com o menu liberado. Pedido foi so "ver" -- nao mexe em INSERT/UPDATE.
DROP POLICY IF EXISTS "Admins can view all sinistros" ON public.sinistros;
CREATE POLICY "Admins can view all sinistros" ON public.sinistros
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'analista'))
    OR public.has_internal_role(auth.uid(), 'juridico'::internal_role)
  );
