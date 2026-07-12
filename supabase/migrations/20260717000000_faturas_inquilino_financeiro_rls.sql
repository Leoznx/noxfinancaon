-- A pagina /admin/faturamento (ProtectedRoute roles={"admin","analista","financeiro"})
-- sempre mostrou zero pra quem tem profiles.role='financeiro' porque nenhuma
-- policy de faturas_inquilino cobria esse papel - so existiam "Tenant view own
-- faturas", "Consulta owner or agency recipient view faturas" e "Admins manage
-- all faturas" (is_admin() == so profiles.role='admin', nao inclui financeiro/
-- analista). Resultado: a query rodava, mas o RLS filtrava tudo antes de
-- chegar no frontend - mesma classe de bug do "App reads X USING(true)" ao
-- contrario (aqui faltava liberar, nao sobrava liberado).
--
-- So SELECT (nunca INSERT/UPDATE/DELETE) - o status da fatura continua tendo
-- como fonte oficial o webhook do Asaas / asaas-get-payment, nunca uma edicao
-- manual pelo financeiro.
DROP POLICY IF EXISTS "Financeiro e analista veem todas as faturas" ON public.faturas_inquilino;
CREATE POLICY "Financeiro e analista veem todas as faturas"
ON public.faturas_inquilino FOR SELECT
USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'analista'
  OR public.has_internal_role(auth.uid(), 'financeiro'::internal_role)
);
