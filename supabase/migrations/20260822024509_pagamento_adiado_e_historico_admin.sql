-- "Pagar depois": marca a proposta cujo Pix/boleto foi gerado mas ainda não foi
-- pago. A cobrança continua aberta na aba de faturas do usuário e o contrato só
-- segue para assinatura depois que o Asaas confirmar o pagamento — o mesmo
-- gatilho do fluxo normal, nada é liberado antes.
ALTER TABLE public.consultas_credito
  ADD COLUMN IF NOT EXISTS payment_deferred boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_deferred_at timestamptz;

COMMENT ON COLUMN public.consultas_credito.payment_deferred IS
  'true quando o usuário escolheu "pagar depois" no Pix/boleto — a fatura fica aberta e a assinatura só é liberada após a confirmação do pagamento.';

-- O administrador e a equipe interna precisam ler o histórico completo da
-- proposta na aba Consultas ("Ver mais"), inclusive o de consultas que não são
-- deles. SECURITY DEFINER para não depender da RLS de `profiles` dentro da
-- política.
CREATE OR REPLACE FUNCTION public.eh_equipe_interna(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _uid
      AND role IN (
        'admin'::user_role,
        'admin_master'::user_role,
        'analista'::user_role,
        'juridico'::user_role,
        'financeiro'::user_role
      )
  )
$$;

DROP POLICY IF EXISTS "Equipe interna vê histórico de propostas" ON public.proposta_historico;
CREATE POLICY "Equipe interna vê histórico de propostas"
  ON public.proposta_historico FOR SELECT
  TO authenticated
  USING (public.eh_equipe_interna(auth.uid()));

-- O corretor/imobiliária que abriu a consulta também precisa do próprio
-- histórico: a política original só cobria `corretor_id`, e as consultas criadas
-- pelo site gravam o autor em `profile_id_solicitante`.
DROP POLICY IF EXISTS "Solicitante vê histórico da própria proposta" ON public.proposta_historico;
CREATE POLICY "Solicitante vê histórico da própria proposta"
  ON public.proposta_historico FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.consultas_credito c
      WHERE c.id = proposta_historico.consulta_id
        AND c.profile_id_solicitante = auth.uid()
    )
  );
