-- =============================================================================
-- Nova aba "Aprovações de Documentos" no admin: quem se cadastra e envia os 3
-- arquivos de verificação de identidade (frente/verso/segurando o documento,
-- ver src/components/configuracoes/VerificacaoDocumento.tsx) precisa aparecer
-- numa fila de revisão pro staff aprovar/reprovar.
--
-- A tabela verificacoes_documento já tinha RLS liberando SELECT/UPDATE pra
-- quem `is_admin()` (profiles.role = 'admin'), mas o resto do painel admin
-- (ex.: Aprovações de consultas em admin.aprovacoes.tsx) também libera pra
-- analista/juridico/admin_master. Cria um predicado dedicado (mais estrito
-- que eh_staff_interno_consultas(), que libera QUALQUER cargo interno ativo
-- incluindo vendedor/marketing/suporte — não queremos esses papéis vendo foto
-- de documento de identidade de terceiros) e reaplica as policies de SELECT/
-- UPDATE na tabela e a policy de SELECT no bucket de storage.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.pode_revisar_verificacao_documento()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
    OR public.has_internal_role(auth.uid(), 'juridico'::public.internal_role)
    OR (SELECT role FROM public.profiles WHERE id = auth.uid())::text = 'analista';
$$;

DROP POLICY IF EXISTS "Users select own verificacao" ON public.verificacoes_documento;
CREATE POLICY "Users select own verificacao"
  ON public.verificacoes_documento FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.pode_revisar_verificacao_documento());

DROP POLICY IF EXISTS "Users update own verificacao" ON public.verificacoes_documento;
CREATE POLICY "Users update own verificacao"
  ON public.verificacoes_documento FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id OR public.pode_revisar_verificacao_documento())
  WITH CHECK (auth.uid() = user_id OR public.pode_revisar_verificacao_documento());

DROP POLICY IF EXISTS "Users read own docs verificacao" ON storage.objects;
CREATE POLICY "Users read own docs verificacao"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'documentos-verificacao'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR public.pode_revisar_verificacao_documento()
    )
  );
