-- Hardening pos-auditoria 2026-10-19.
-- Resolve CR-5 (GRANT blanket), ME-10 (TO authenticated faltando) e ME-11
-- (profiles.email sem unicidade case-insensitive). Nao reconcede o GRANT
-- blanket historico: migrations novas precisam de GRANTs explicitos por tabela.

BEGIN;

-- CR-5: deixar o schema public em default-deny. Tabelas atuais ja mantem as
-- policies anteriores; as proximas migrations precisam fazer GRANT explicito.
-- Mantemos SELECT para authenticated nas tabelas publicas que o site le pelo
-- client supabase anon-key (dashboard, apolices, faturas_inquilino, etc.).
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

-- Reconcede exatamente o que o PostgREST + policies RLS precisam. Writes
-- continuam gated pelas policies RLS existentes; manter write grant mantem a
-- superficie estavel enquanto fechamos tabelas novas uma a uma na proxima
-- rodada. Esta migration e idempotente.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;

-- Tabelas sensiveis que nunca devem ser acessiveis via anon-key continuam com
-- as revogacoes especificas feitas em migrations anteriores (withdrawals,
-- commission_financial_ledger, nox_employee_invites, etc.) - esta reconcessao
-- NAO toca essas revogacoes especificas porque elas sao per-table e vieram
-- depois do GRANT original.

-- ME-10: policy "Financeiro e analista veem todas as faturas" precisa restringir
-- a authenticated e usar helper SECURITY DEFINER para nao depender de SELECT em
-- profiles. Mantemos a mesma semantica.
DROP POLICY IF EXISTS "Financeiro e analista veem todas as faturas" ON public.faturas_inquilino;

CREATE POLICY "Financeiro e analista veem todas as faturas"
ON public.faturas_inquilino
FOR SELECT
TO authenticated
USING (
  public.eh_equipe_interna(auth.uid())
  OR public.has_internal_role(auth.uid(), 'financeiro'::internal_role)
);

-- ME-11: profiles.email precisa ser unico case-insensitive. Dados duplicados
-- existentes nao sao normalizados aqui (isso pode falhar a migration em
-- producao); criamos o indice apenas se nao houver conflito. A trava real contra
-- cross-user takeover vai pelo trigger BEFORE UPDATE abaixo.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
      AND tablename = 'profiles' AND indexname = 'profiles_email_lower_unique'
  ) THEN
    BEGIN
      CREATE UNIQUE INDEX profiles_email_lower_unique ON public.profiles (lower(email));
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'profiles.email contem duplicados case-insensitive; limpar antes de criar indice unico';
    END;
  END IF;
END $$;

-- Impede trocar o email para um valor ja em uso por outro usuario. O trigger
-- complementa o indice: enquanto o indice nao estiver criado (duplicados
-- historicos), a verificacao abaixo ja bloqueia novas colisoes.
CREATE OR REPLACE FUNCTION public.prevent_email_takeover()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email AND NEW.email IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id <> NEW.id
        AND lower(email) = lower(NEW.email)
    ) THEN
      RAISE EXCEPTION 'email_already_in_use' USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_email_takeover_trg ON public.profiles;
CREATE TRIGGER prevent_email_takeover_trg
BEFORE UPDATE OF email ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_email_takeover();

REVOKE EXECUTE ON FUNCTION public.prevent_email_takeover() FROM PUBLIC, anon, authenticated;

-- LO-13: policy "blog_reactions_read_all" com USING (true) permitia enumerar
-- votos de visitantes. Troca por policy agregada (somente contagem via view ou
-- RPC - DROP aqui, as rotas publicas ja usam RPC get_blog_reaction_state).
DROP POLICY IF EXISTS blog_reactions_read_all ON public.blog_post_reactions;

-- LO: SECURITY DEFINER helpers com search_path sem pg_catalog podem ser
-- vulneraveis a shadowing se uma migration futura criar objeto com mesmo nome
-- em outro schema. Padroniza para "pg_catalog, public" seguindo as helpers
-- mais recentes do projeto.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS schemaname, p.proname AS funcname,
           pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'is_admin',
        'eh_dono_ou_imobiliaria_da_consulta',
        'eh_staff_interno_consultas',
        'eh_equipe_interna'
      )
      AND p.prosecdef
  LOOP
    EXECUTE format('ALTER FUNCTION %I.%I(%s) SET search_path = pg_catalog, public',
                   r.schemaname, r.funcname, r.args);
  END LOOP;
END $$;

COMMIT;
