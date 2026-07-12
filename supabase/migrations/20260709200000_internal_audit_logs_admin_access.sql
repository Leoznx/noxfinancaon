-- internal_audit_logs só liberava INSERT/SELECT pra admin_master
-- (has_internal_role(auth.uid(),'admin_master')) — mas /admin/equipe-permissoes,
-- de onde toda ação auditável parte, também é acessível por role='admin' puro
-- (que nunca tem linha em internal_users, então is_internal()/has_internal_role()
-- sempre dá falso pra ele). Resultado: um admin comum bloqueando um colaborador
-- ou editando uma permissão teria o INSERT de auditoria silenciosamente
-- rejeitado, e a aba Auditoria ficaria sempre vazia pra ele. Alinha com o
-- princípio já usado no resto do projeto: admin = acesso total.

DROP POLICY IF EXISTS "audit insert internal" ON public.internal_audit_logs;
CREATE POLICY "audit insert internal"
  ON public.internal_audit_logs FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()) OR public.is_internal(auth.uid()));

DROP POLICY IF EXISTS "audit read admin_master" ON public.internal_audit_logs;
CREATE POLICY "audit read admin_master"
  ON public.internal_audit_logs FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_internal_role(auth.uid(), 'admin_master'::internal_role));
