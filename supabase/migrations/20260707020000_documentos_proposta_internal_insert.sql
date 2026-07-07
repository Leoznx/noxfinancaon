-- A policy "Owner of consulta insert docs" só permite que o corretor dono da
-- consulta (corretor_id/profile_id_solicitante) envie documentos complementares.
-- Jurídico/Analista/Admin (os mesmos papéis que já enxergam tudo na aba
-- Aprovações, via a policy "Internal roles view all docs proposta") também
-- precisam poder enviar/reenviar documentos em nome do cliente quando
-- necessário — sem esta policy, o envio falhava com "new row violates
-- row-level security policy" pra qualquer consulta que não fosse deles.
DROP POLICY IF EXISTS "Internal roles insert docs proposta" ON public.documentos_proposta;
CREATE POLICY "Internal roles insert docs proposta"
  ON public.documentos_proposta FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND (
      public.has_internal_role(auth.uid(), 'juridico'::internal_role)
      OR public.has_internal_role(auth.uid(), 'admin_master'::internal_role)
      OR EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role IN ('admin'::user_role, 'analista'::user_role)
      )
    )
  );
