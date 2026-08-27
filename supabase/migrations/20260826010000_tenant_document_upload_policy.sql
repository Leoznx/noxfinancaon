-- O atalho "Enviar documento" do painel do inquilino grava somente na consulta
-- vinculada ao próprio usuário. A policy anterior cobria o solicitante/corretor,
-- mas não o inquilino quando a consulta foi criada por uma imobiliária.

DROP POLICY IF EXISTS "Tenant inserts own proposal documents" ON public.documentos_proposta;
CREATE POLICY "Tenant inserts own proposal documents"
  ON public.documentos_proposta FOR INSERT TO authenticated
  WITH CHECK (
    tenant_user_id = auth.uid()
    AND uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.consultas_credito consulta
      WHERE consulta.id = documentos_proposta.consulta_id
        AND consulta.tenant_user_id = auth.uid()
    )
  );
