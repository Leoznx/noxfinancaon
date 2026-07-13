-- =============================================================================
-- imobiliarias tinha SOMENTE a policy "Admins possess full access on
-- imobiliarias" (FOR ALL USING role = 'admin') — nenhuma policy permitia a
-- própria imobiliária ler ou editar o seu próprio registro. Diferente de
-- corretores/inquilinos (que têm "App reads ... USING (true)", aberto demais
-- mas pelo menos funcional) e de proprietarios (que já tem uma policy própria
-- "Owners can view their own record"), imobiliarias ficou sem nenhum caminho
-- de acesso pro papel 'imobiliaria' de verdade.
--
-- Efeito prático confirmado: como corretores-admin.lazy.tsx resolve a
-- imobiliária do usuário logado via
-- `imobiliarias.contato_email = profiles.email`, a query voltava vazia pra
-- QUALQUER imobiliária real — "Complete os dados da sua empresa..." sempre
-- aparecia, e o clique em "OK, vincular corretor" sempre falhava com "Não foi
-- possível identificar sua imobiliária", mesmo com o corretor buscado
-- corretamente (a busca em si usa a função find_corretor, SECURITY DEFINER,
-- que não é afetada por este gap).
--
-- Reaproveita o mesmo padrão de match por e-mail já usado em
-- eh_dono_ou_imobiliaria_da_consulta() (ver
-- 20260709170000_consultas_credito_rls_hardening.sql) — imobiliarias não tem
-- profile_id, só contato_email.
-- =============================================================================

CREATE POLICY "Imobiliaria vê e edita a própria empresa"
ON public.imobiliarias FOR SELECT
USING (
  lower(contato_email) = lower((SELECT email FROM public.profiles WHERE id = auth.uid()))
);

CREATE POLICY "Imobiliaria atualiza a própria empresa"
ON public.imobiliarias FOR UPDATE
USING (
  lower(contato_email) = lower((SELECT email FROM public.profiles WHERE id = auth.uid()))
)
WITH CHECK (
  lower(contato_email) = lower((SELECT email FROM public.profiles WHERE id = auth.uid()))
);
