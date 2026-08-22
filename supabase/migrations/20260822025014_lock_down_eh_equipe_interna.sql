-- A função eh_equipe_interna (criada na migração anterior) ficou exposta como
-- RPC pública (`/rest/v1/rpc/eh_equipe_interna`) para os papéis `anon` e
-- `authenticated` — o Advisor de segurança do Supabase aponta isso porque é
-- SECURITY DEFINER. A função em si só devolve um boolean sobre o próprio
-- auth.uid(), mas o padrão já usado neste projeto para as funções auxiliares
-- de RLS (ex.: can_manage_withdrawals, can_audit_withdrawals) é destravar o
-- acesso apenas para quem precisa: `authenticated` (as políticas de RLS que a
-- usam já são `TO authenticated`) e `service_role`.
REVOKE ALL ON FUNCTION public.eh_equipe_interna(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eh_equipe_interna(uuid) TO authenticated, service_role;
