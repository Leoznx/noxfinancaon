
CREATE POLICY "Auth users upload own folder documentos-proposta"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documentos-proposta'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Auth users read own folder documentos-proposta"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'documentos-proposta'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin(auth.uid())
    )
  );

CREATE POLICY "Auth users delete own folder documentos-proposta"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'documentos-proposta'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin(auth.uid())
    )
  );
