-- O detalhe de uma apólice já usa `can_view_policy` como autorização
-- canônica. O faturamento precisa seguir exatamente o mesmo escopo: antes,
-- um usuário podia abrir o contrato e ainda receber zero linhas financeiras
-- porque as policies de faturas/Asaas reconheciam um conjunto menor de
-- participantes.

CREATE INDEX IF NOT EXISTS apolices_consulta_id_idx
  ON public.apolices (consulta_id);

DROP POLICY IF EXISTS "Policy viewers read contract invoices"
  ON public.faturas_inquilino;
CREATE POLICY "Policy viewers read contract invoices"
  ON public.faturas_inquilino
  FOR SELECT
  TO authenticated
  USING (
    (
      apolice_id IS NOT NULL
      AND public.can_view_policy(auth.uid(), apolice_id)
    )
    OR EXISTS (
      SELECT 1
      FROM public.apolices AS policy
      WHERE policy.consulta_id = faturas_inquilino.consulta_id
        AND public.can_view_policy(auth.uid(), policy.id)
    )
  );

DROP POLICY IF EXISTS "Policy viewers read contract Asaas payments"
  ON public.asaas_payments;
CREATE POLICY "Policy viewers read contract Asaas payments"
  ON public.asaas_payments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.apolices AS policy
      WHERE policy.consulta_id = asaas_payments.consultation_id
        AND public.can_view_policy(auth.uid(), policy.id)
    )
  );

GRANT SELECT ON TABLE public.faturas_inquilino, public.asaas_payments
  TO authenticated;
