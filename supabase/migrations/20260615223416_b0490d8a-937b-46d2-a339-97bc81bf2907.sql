
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'inquilino';

ALTER TABLE public.consultas_credito
  ADD COLUMN IF NOT EXISTS imovel_cep TEXT,
  ADD COLUMN IF NOT EXISTS imovel_endereco TEXT,
  ADD COLUMN IF NOT EXISTS imovel_bairro TEXT,
  ADD COLUMN IF NOT EXISTS imovel_cidade TEXT,
  ADD COLUMN IF NOT EXISTS imovel_estado TEXT,
  ADD COLUMN IF NOT EXISTS imovel_numero TEXT,
  ADD COLUMN IF NOT EXISTS imovel_complemento TEXT,
  ADD COLUMN IF NOT EXISTS imovel_subtipo TEXT,
  ADD COLUMN IF NOT EXISTS tenant_user_id UUID,
  ADD COLUMN IF NOT EXISTS tenant_email TEXT,
  ADD COLUMN IF NOT EXISTS tenant_telefone TEXT,
  ADD COLUMN IF NOT EXISTS tenant_data_nascimento DATE,
  ADD COLUMN IF NOT EXISTS payment_type TEXT,
  ADD COLUMN IF NOT EXISTS billing_responsible_role TEXT,
  ADD COLUMN IF NOT EXISTS billing_responsible_user_id UUID,
  ADD COLUMN IF NOT EXISTS dados_complementares_em TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.documentos_proposta (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consulta_id UUID REFERENCES public.consultas_credito(id) ON DELETE CASCADE,
  apolice_id UUID REFERENCES public.apolices(id) ON DELETE SET NULL,
  tenant_user_id UUID,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT,
  document_type TEXT,
  uploaded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.documentos_proposta TO authenticated;
GRANT ALL ON public.documentos_proposta TO service_role;

ALTER TABLE public.documentos_proposta ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all docs proposta"
  ON public.documentos_proposta FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Tenant view own docs"
  ON public.documentos_proposta FOR SELECT TO authenticated
  USING (tenant_user_id = auth.uid());

CREATE POLICY "Owner of consulta view docs"
  ON public.documentos_proposta FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.consultas_credito c
    WHERE c.id = documentos_proposta.consulta_id
      AND (c.corretor_id = auth.uid() OR c.profile_id_solicitante = auth.uid())
  ));

CREATE POLICY "Owner of consulta insert docs"
  ON public.documentos_proposta FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.consultas_credito c
      WHERE c.id = documentos_proposta.consulta_id
        AND (c.corretor_id = auth.uid() OR c.profile_id_solicitante = auth.uid())
    )
  );

CREATE TRIGGER trg_docs_proposta_updated
  BEFORE UPDATE ON public.documentos_proposta
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.faturas_inquilino (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  apolice_id UUID REFERENCES public.apolices(id) ON DELETE CASCADE,
  consulta_id UUID REFERENCES public.consultas_credito(id) ON DELETE CASCADE,
  tenant_user_id UUID NOT NULL,
  numero_parcela INT NOT NULL,
  vencimento DATE NOT NULL,
  valor NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'a_vencer',
  boleto_url TEXT,
  linha_digitavel TEXT,
  pago_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.faturas_inquilino TO authenticated;
GRANT ALL ON public.faturas_inquilino TO service_role;

ALTER TABLE public.faturas_inquilino ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all faturas"
  ON public.faturas_inquilino FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Tenant view own faturas"
  ON public.faturas_inquilino FOR SELECT TO authenticated
  USING (tenant_user_id = auth.uid());

CREATE POLICY "Consulta owner view faturas"
  ON public.faturas_inquilino FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.consultas_credito c
    WHERE c.id = faturas_inquilino.consulta_id
      AND (c.corretor_id = auth.uid() OR c.profile_id_solicitante = auth.uid())
  ));

CREATE TRIGGER trg_faturas_inquilino_updated
  BEFORE UPDATE ON public.faturas_inquilino
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
