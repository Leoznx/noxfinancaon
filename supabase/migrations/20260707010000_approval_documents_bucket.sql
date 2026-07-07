-- ============================================================================
-- Bucket de Storage para os documentos do "Formulário complementar" (CNH,
-- comprovante de renda) enviados quando uma consulta fica "em_analise". O
-- bucket "approval-documents" referenciado no código nunca foi criado (só
-- existiam policies para um bucket "anexos" que também nunca chegou a ser
-- criado) — por isso o upload falhava com "Bucket not found".
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'approval-documents',
  'approval-documents',
  false,
  10485760, -- 10MB
  ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Upload: o usuário autenticado só pode enviar para o próprio prefixo
-- ("<uid>/<consulta_id>/..."), mesmo padrão já usado no bucket "anexos".
DROP POLICY IF EXISTS "approval_documents_insert_own" ON storage.objects;
CREATE POLICY "approval_documents_insert_own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'approval-documents'
    AND name LIKE auth.uid()::text || '/%'
  );

-- upsert: true no upload também precisa de permissão de UPDATE no mesmo prefixo.
DROP POLICY IF EXISTS "approval_documents_update_own" ON storage.objects;
CREATE POLICY "approval_documents_update_own"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'approval-documents'
    AND name LIKE auth.uid()::text || '/%'
  );

-- Leitura: o próprio corretor que enviou os documentos consegue ver os seus.
DROP POLICY IF EXISTS "approval_documents_select_own" ON storage.objects;
CREATE POLICY "approval_documents_select_own"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'approval-documents'
    AND name LIKE auth.uid()::text || '/%'
  );

-- Leitura: Jurídico/Analista/Admin (os dois sistemas de papel do projeto — ver
-- ProtectedRoute.tsx, que aceita profiles.role OU internal_users.role) veem
-- TODOS os documentos do bucket, necessário pra aba Aprovações gerar signed URL
-- de arquivos enviados por qualquer corretor.
DROP POLICY IF EXISTS "approval_documents_select_internal" ON storage.objects;
CREATE POLICY "approval_documents_select_internal"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'approval-documents'
    AND (
      public.has_internal_role(auth.uid(), 'juridico'::internal_role)
      OR public.has_internal_role(auth.uid(), 'admin_master'::internal_role)
      OR EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role IN ('admin'::user_role, 'analista'::user_role)
      )
    )
  );

-- ============================================================================
-- documentos_proposta: a policy existente "Admins manage all docs proposta" só
-- cobre profiles.role = 'admin' (via is_admin()). A aba Aprovações também é
-- acessada por Jurídico/Analista/Admin-master, que sem esta policy só
-- enxergavam documentos das consultas onde eles próprios são o corretor —
-- ou seja, o modal "olho" aparecia vazio para documentos de outros corretores.
-- ============================================================================
DROP POLICY IF EXISTS "Internal roles view all docs proposta" ON public.documentos_proposta;
CREATE POLICY "Internal roles view all docs proposta"
  ON public.documentos_proposta FOR SELECT TO authenticated
  USING (
    public.has_internal_role(auth.uid(), 'juridico'::internal_role)
    OR public.has_internal_role(auth.uid(), 'admin_master'::internal_role)
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin'::user_role, 'analista'::user_role)
    )
  );
