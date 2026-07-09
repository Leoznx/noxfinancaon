-- =============================================================================
-- A policy de INSERT em notificacoes só liberava role = 'admin' — mas
-- /admin/aprovacoes (onde essa notificação é disparada ao aprovar/reprovar
-- uma consulta) é acessível também por analista/juridico/admin_master
-- (ver ProtectedRoute roles=["admin","analista","juridico","admin_master"]
-- em src/routes/admin.aprovacoes.tsx). Sem isso, um jurídico aprovando uma
-- consulta teria o INSERT da notificação pro corretor bloqueado pelo RLS
-- silenciosamente (a policy "usuario_ve_proprias_notificacoes" só cobre
-- inserir pra si mesmo, não pra outro user_id).
-- =============================================================================

DROP POLICY IF EXISTS "Admins can create notifications" ON public.notificacoes;
CREATE POLICY "Admins can create notifications"
ON public.notificacoes
FOR INSERT
WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'analista', 'juridico', 'admin_master'));
