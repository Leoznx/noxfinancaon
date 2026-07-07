
-- 1) Table
CREATE TABLE IF NOT EXISTS public.verificacoes_documento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  document_type TEXT NOT NULL CHECK (document_type IN ('cnh','rg')),
  document_front_url TEXT,
  document_back_url TEXT,
  selfie_url TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (verification_status IN ('pendente','enviado','em_analise','aprovado','recusado')),
  rejection_reason TEXT,
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.verificacoes_documento TO authenticated;
GRANT ALL ON public.verificacoes_documento TO service_role;

ALTER TABLE public.verificacoes_documento ENABLE ROW LEVEL SECURITY;

-- Own row
CREATE POLICY "Users select own verificacao"
  ON public.verificacoes_documento FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

CREATE POLICY "Users insert own verificacao"
  ON public.verificacoes_documento FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own verificacao"
  ON public.verificacoes_documento FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()))
  WITH CHECK (auth.uid() = user_id OR public.is_admin(auth.uid()));

CREATE POLICY "Users delete own verificacao"
  ON public.verificacoes_documento FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_verificacoes_documento_updated_at ON public.verificacoes_documento;
CREATE TRIGGER trg_verificacoes_documento_updated_at
  BEFORE UPDATE ON public.verificacoes_documento
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Storage policies on documentos-verificacao bucket
-- Files must be stored under: <user_id>/<filename>
CREATE POLICY "Users read own docs verificacao"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'documentos-verificacao'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR public.is_admin(auth.uid())
    )
  );

CREATE POLICY "Users upload own docs verificacao"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'documentos-verificacao'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users update own docs verificacao"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'documentos-verificacao'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users delete own docs verificacao"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'documentos-verificacao'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
