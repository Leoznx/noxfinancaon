
-- ===================================================
-- Storage RLS — bucket "anexos"
-- ===================================================

-- Leitura pública (signed/transformed access via app, mas autenticados podem ler tudo do bucket)
DROP POLICY IF EXISTS "anexos_select_authenticated" ON storage.objects;
CREATE POLICY "anexos_select_authenticated"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'anexos');

-- Insert: usuário envia para o próprio prefixo ("<uid>..." ou "avatares/<uid>...")
DROP POLICY IF EXISTS "anexos_insert_own" ON storage.objects;
CREATE POLICY "anexos_insert_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'anexos'
    AND (
      name LIKE auth.uid()::text || '%'
      OR name LIKE 'avatares/' || auth.uid()::text || '%'
      OR name LIKE auth.uid()::text || '/%'
    )
  );

-- Update (substituir avatar): mesmo escopo do insert
DROP POLICY IF EXISTS "anexos_update_own" ON storage.objects;
CREATE POLICY "anexos_update_own"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'anexos'
    AND (
      name LIKE auth.uid()::text || '%'
      OR name LIKE 'avatares/' || auth.uid()::text || '%'
      OR name LIKE auth.uid()::text || '/%'
    )
  );

-- Delete: mesmo escopo
DROP POLICY IF EXISTS "anexos_delete_own" ON storage.objects;
CREATE POLICY "anexos_delete_own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'anexos'
    AND (
      name LIKE auth.uid()::text || '%'
      OR name LIKE 'avatares/' || auth.uid()::text || '%'
      OR name LIKE auth.uid()::text || '/%'
    )
  );

-- ===================================================
-- Realtime — tabelas críticas dos painéis
-- ===================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notificacoes'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notificacoes';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'mensalidades'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.mensalidades';
  END IF;
END $$;

-- Garante REPLICA IDENTITY FULL para enviar payload completo nos eventos UPDATE/DELETE
ALTER TABLE public.notificacoes REPLICA IDENTITY FULL;
ALTER TABLE public.mensalidades REPLICA IDENTITY FULL;
