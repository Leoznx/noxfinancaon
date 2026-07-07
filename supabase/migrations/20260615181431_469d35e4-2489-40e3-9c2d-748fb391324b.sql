
-- 1. Documentos do contrato
CREATE TABLE IF NOT EXISTS public.documentos_contrato (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  apolice_id uuid NOT NULL REFERENCES public.apolices(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('contrato','vistoria','apolice')),
  file_name text,
  file_url text,
  storage_path text,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('disponivel','pendente','nao_enviado')),
  uploaded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (apolice_id, tipo)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.documentos_contrato TO authenticated;
GRANT ALL ON public.documentos_contrato TO service_role;
GRANT SELECT ON public.documentos_contrato TO anon;

ALTER TABLE public.documentos_contrato ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vinculados à apolice podem ver documentos"
ON public.documentos_contrato FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.apolices a
    WHERE a.id = documentos_contrato.apolice_id
      AND (
        a.corretor_profile_id = auth.uid()
        OR a.imobiliaria_profile_id = auth.uid()
        OR a.proprietario_profile_id = auth.uid()
        OR public.is_admin(auth.uid())
      )
  )
);

CREATE POLICY "Admins gerenciam documentos"
ON public.documentos_contrato FOR ALL
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

CREATE TRIGGER trg_documentos_contrato_updated
BEFORE UPDATE ON public.documentos_contrato
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Faturas (campos extras em mensalidades)
ALTER TABLE public.mensalidades
  ADD COLUMN IF NOT EXISTS numero_parcela int,
  ADD COLUMN IF NOT EXISTS boleto_url text,
  ADD COLUMN IF NOT EXISTS linha_digitavel text,
  ADD COLUMN IF NOT EXISTS codigo_barras text,
  ADD COLUMN IF NOT EXISTS comprovante_url text;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mensalidades TO authenticated;
GRANT ALL ON public.mensalidades TO service_role;

-- Política antiga era "USING (true)" — substituímos por escopo correto
DROP POLICY IF EXISTS "Users view relevant mensalidades" ON public.mensalidades;

CREATE POLICY "Vinculados à apolice veem faturas"
ON public.mensalidades FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.apolices a
    WHERE a.id = mensalidades.apolice_id
      AND (
        a.corretor_profile_id = auth.uid()
        OR a.imobiliaria_profile_id = auth.uid()
        OR a.proprietario_profile_id = auth.uid()
        OR public.is_admin(auth.uid())
      )
  )
);

CREATE POLICY "Admins gerenciam faturas"
ON public.mensalidades FOR ALL
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));
