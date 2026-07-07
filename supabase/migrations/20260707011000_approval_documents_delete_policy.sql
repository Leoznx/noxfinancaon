-- Faltava a policy de DELETE no bucket approval-documents (mesmo padrão do
-- bucket "anexos") — sem ela, upload.remove() no próprio prefixo falha
-- silenciosamente (a operação não retorna erro para o chamador, mas o
-- arquivo simplesmente não é removido).
DROP POLICY IF EXISTS "approval_documents_delete_own" ON storage.objects;
CREATE POLICY "approval_documents_delete_own"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'approval-documents'
    AND name LIKE auth.uid()::text || '/%'
  );
