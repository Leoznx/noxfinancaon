ALTER TABLE public.consultas_credito
  ADD COLUMN IF NOT EXISTS insurance_coverages jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS insurance_assistance text,
  ADD COLUMN IF NOT EXISTS insurance_commission_pct numeric DEFAULT 10,
  ADD COLUMN IF NOT EXISTS insurance_payment_method text,
  ADD COLUMN IF NOT EXISTS insurance_payment_method_label text,
  ADD COLUMN IF NOT EXISTS property_not_wood_confirmed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS terms_accepted boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS insurance_restriction_warning_acknowledged boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS proposta_enviada_em timestamptz,
  ADD COLUMN IF NOT EXISTS link_ativacao_enviado_em timestamptz,
  ADD COLUMN IF NOT EXISTS substatus text;

CREATE TABLE IF NOT EXISTS public.proposta_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consulta_id uuid NOT NULL REFERENCES public.consultas_credito(id) ON DELETE CASCADE,
  tipo_evento text NOT NULL,
  descricao text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.proposta_historico TO authenticated;
GRANT ALL ON public.proposta_historico TO service_role;

ALTER TABLE public.proposta_historico ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins veem todo histórico"
  ON public.proposta_historico FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Donos da consulta veem histórico"
  ON public.proposta_historico FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.consultas_credito c
      WHERE c.id = consulta_id
        AND (c.corretor_id = auth.uid() OR c.tenant_user_id = auth.uid())
    )
  );

CREATE POLICY "Inserção autenticada de histórico"
  ON public.proposta_historico FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_proposta_historico_consulta ON public.proposta_historico(consulta_id, created_at DESC);