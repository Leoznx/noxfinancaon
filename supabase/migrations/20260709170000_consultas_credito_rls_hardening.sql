-- =============================================================================
-- consultas_credito estava com SELECT/INSERT/UPDATE liberados pra QUALQUER
-- usuário autenticado (USING/WITH CHECK (true)) — origem: uma tentativa antiga
-- de restringir por corretor_id (ver "Corretor vê só suas consultas"), coluna
-- que hoje está NULL em 100% das linhas reais, então alguém contornou o "0
-- resultados" liberando tudo em vez de trocar pra coluna certa
-- (profile_id_solicitante, que está preenchida em 100% das linhas reais).
-- Efeito prático: qualquer corretor logado conseguia ler/editar a consulta de
-- QUALQUER outro corretor por id direto (nome, CPF, valor de aluguel etc.) e,
-- em teoria, até auto-aprovar uma consulta chamando o Supabase client direto
-- pelo console do navegador.
--
-- Este fix mantém todo mundo que hoje legitimamente lê/escreve essa tabela
-- (mapeado consumo por consumo antes de escrever isso — ver conversa):
--   - corretor/proprietário: só a própria consulta (profile_id_solicitante = auth.uid())
--   - imobiliária: a própria + as dos corretores vinculados a ela (mesma regra
--     já usada em dashboard.tsx/consultas.index.lazy.tsx: imobiliarias.contato_email
--     -> corretores.imobiliaria_id -> corretores.profile_id)
--   - inquilino: a consulta em que ele é o tenant, via tenant_email (chave usada
--     de fato por inquilino.documentos.tsx/inquilino.faturas.tsx hoje —
--     tenant_user_id só está preenchido em 4 das 24 linhas reais, não dá pra
--     depender só dele) ou tenant_user_id quando já vinculado
--   - staff interno (admin/analista/financeiro/juridico/admin_master/...): tudo
-- Automações/edge functions (cakto-webhook, simulate-credpago, ativacao.functions,
-- proposta.functions, inquilino-signup.functions, credpagoWorker) usam
-- supabaseAdmin/service role e continuam ignorando RLS normalmente.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.eh_dono_ou_imobiliaria_da_consulta(p_profile_id_solicitante uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_profile_id_solicitante = auth.uid()
    OR p_profile_id_solicitante IN (
      SELECT c.profile_id
      FROM public.corretores c
      JOIN public.imobiliarias i ON i.id = c.imobiliaria_id
      WHERE i.contato_email = (SELECT email FROM public.profiles WHERE id = auth.uid())
    );
$$;

CREATE OR REPLACE FUNCTION public.eh_staff_interno_consultas()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin(auth.uid())
    OR public.is_internal(auth.uid())
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('analista', 'financeiro');
$$;

DROP POLICY IF EXISTS "App reads consultas" ON public.consultas_credito;
DROP POLICY IF EXISTS "App inserts consultas" ON public.consultas_credito;
DROP POLICY IF EXISTS "App updates consultas" ON public.consultas_credito;
DROP POLICY IF EXISTS "Corretor vê só suas consultas" ON public.consultas_credito;
DROP POLICY IF EXISTS "consultas juridico write" ON public.consultas_credito;
DROP POLICY IF EXISTS "Admins possess full access on consultas_credito" ON public.consultas_credito;

CREATE POLICY "Consultas: select dono, imobiliária, inquilino ou staff"
ON public.consultas_credito FOR SELECT
USING (
  public.eh_dono_ou_imobiliaria_da_consulta(profile_id_solicitante)
  OR tenant_user_id = auth.uid()
  OR tenant_email = (SELECT email FROM public.profiles WHERE id = auth.uid())
  OR public.eh_staff_interno_consultas()
);

CREATE POLICY "Consultas: insert em nome de si mesmo ou staff"
ON public.consultas_credito FOR INSERT
WITH CHECK (
  profile_id_solicitante = auth.uid()
  OR public.eh_staff_interno_consultas()
);

CREATE POLICY "Consultas: update dono, imobiliária ou staff"
ON public.consultas_credito FOR UPDATE
USING (
  public.eh_dono_ou_imobiliaria_da_consulta(profile_id_solicitante)
  OR public.eh_staff_interno_consultas()
)
WITH CHECK (
  public.eh_dono_ou_imobiliaria_da_consulta(profile_id_solicitante)
  OR public.eh_staff_interno_consultas()
);
