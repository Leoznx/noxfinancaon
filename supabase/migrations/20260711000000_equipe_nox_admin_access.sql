-- Aba "Equipe NOX" (admin): define metas mensais e lança comissões manuais
-- por vendedor. Ambas as tabelas hoje só liberam escrita pra
-- has_internal_role(auth.uid(),'admin_master')/'financeiro' — um admin comum
-- (role='admin' em profiles, sem linha em internal_users) fica de fora.
-- Alinha com o mesmo princípio já usado no resto do projeto (admin = acesso total).
DROP POLICY IF EXISTS "seller_goals admin write" ON public.seller_goals;
CREATE POLICY "seller_goals admin write"
  ON public.seller_goals FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_internal_role(auth.uid(), 'admin_master'::internal_role))
  WITH CHECK (public.is_admin(auth.uid()) OR public.has_internal_role(auth.uid(), 'admin_master'::internal_role));

DROP POLICY IF EXISTS "seller_commissions fin/admin write" ON public.seller_commissions;
CREATE POLICY "seller_commissions fin/admin write"
  ON public.seller_commissions FOR ALL TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::internal_role)
    OR public.has_internal_role(auth.uid(), 'financeiro'::internal_role)
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::internal_role)
    OR public.has_internal_role(auth.uid(), 'financeiro'::internal_role)
  );

-- Reuniões de equipe criadas pelo admin (individual ou geral pra todos os
-- vendedores ativos) viram N linhas em seller_appointments (uma por
-- vendedor-alvo, já que a tabela é sempre escopada a um seller_id só).
-- meeting_group_id agrupa essas linhas pra listar/cancelar como um bloco só
-- na aba Agenda de Equipe NOX, sem afetar os compromissos que o próprio
-- vendedor cria pra si mesmo (ficam com meeting_group_id NULL).
ALTER TABLE public.seller_appointments ADD COLUMN IF NOT EXISTS meeting_group_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_seller_appointments_meeting_group ON public.seller_appointments(meeting_group_id) WHERE meeting_group_id IS NOT NULL;
