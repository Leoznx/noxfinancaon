-- Ate aqui, nada no codigo escrevia em faturas_inquilino (so um fixture de
-- teste SQL) mesmo essa sendo a tabela que "Minhas Faturas" do inquilino
-- (inquilino.faturas.tsx) ja le. Esta migracao prepara a tabela pra receber
-- de verdade as 12 mensalidades geradas na contratacao (payment_responsible=
-- tenant + boleto), e endurece a RLS que hoje libera SELECT pra qualquer
-- autenticado (e ate anon).
ALTER TABLE public.faturas_inquilino
  ADD COLUMN IF NOT EXISTS installment_total int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS payment_responsible text CHECK (payment_responsible IN ('tenant', 'agency')),
  ADD COLUMN IF NOT EXISTS recipient_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS asaas_payment_id uuid REFERENCES public.asaas_payments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS consolidated_item_id uuid;

-- Impede gerar a mesma parcela duas vezes pro mesmo contrato (protege contra
-- clique duplo/retry na criacao das 12 cobrancas).
ALTER TABLE public.faturas_inquilino
  DROP CONSTRAINT IF EXISTS uq_fatura_parcela;
ALTER TABLE public.faturas_inquilino
  ADD CONSTRAINT uq_fatura_parcela UNIQUE (consulta_id, numero_parcela);

CREATE INDEX IF NOT EXISTS idx_faturas_inquilino_recipient_user ON public.faturas_inquilino(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_faturas_inquilino_asaas_payment ON public.faturas_inquilino(asaas_payment_id);

-- RLS: remove a policy publica (USING(true), inclusive pra anon) e a policy
-- morta baseada em consultas_credito.corretor_id (sempre NULL em producao,
-- ja documentado em 20260709170000_consultas_credito_rls_hardening.sql).
-- Substitui por: dono/imobiliaria da consulta (mesma funcao ja usada la),
-- inquilino dono da fatura, destinatario quando for a imobiliaria quem
-- recebe (recipient_user_id), e admin.
DROP POLICY IF EXISTS "App reads faturas inquilino" ON public.faturas_inquilino;
REVOKE SELECT ON public.faturas_inquilino FROM anon;

DROP POLICY IF EXISTS "Consulta owner view faturas" ON public.faturas_inquilino;
DROP POLICY IF EXISTS "Tenant view own faturas" ON public.faturas_inquilino;
DROP POLICY IF EXISTS "Admins manage all faturas" ON public.faturas_inquilino;

CREATE POLICY "Admins manage all faturas"
  ON public.faturas_inquilino FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Tenant view own faturas"
  ON public.faturas_inquilino FOR SELECT TO authenticated
  USING (tenant_user_id = auth.uid());

CREATE POLICY "Consulta owner or agency recipient view faturas"
  ON public.faturas_inquilino FOR SELECT TO authenticated
  USING (
    recipient_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.consultas_credito c
      WHERE c.id = faturas_inquilino.consulta_id
        AND public.eh_dono_ou_imobiliaria_da_consulta(c.profile_id_solicitante)
    )
  );

-- Escrita (criacao/atualizacao das 12 parcelas, reconciliacao pelo webhook)
-- so acontece via service role nas Edge Functions (asaas-create-installment-
-- plan, asaas-webhook) — nao ha necessidade de INSERT/UPDATE liberado pro
-- cliente autenticado normal.
