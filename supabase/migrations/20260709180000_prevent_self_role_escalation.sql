-- =============================================================================
-- A policy de UPDATE em profiles é USING/WITH CHECK (is_admin(auth.uid()) OR
-- auth.uid() = id) — como RLS não enxerga coluna, isso permitia qualquer
-- usuário autenticado chamar supabase.from('profiles').update({role:'admin'})
-- na própria linha (auth.uid() = id sempre bate) e virar admin sozinho, sem
-- passar pela UI. Trigger fecha isso: só quem já é admin/admin_master pode
-- mudar a coluna role de qualquer linha (inclusive a própria).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.prevent_self_role_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NOT (
      public.is_admin(auth.uid())
      OR public.has_internal_role(auth.uid(), 'admin_master'::internal_role)
    ) THEN
      RAISE EXCEPTION 'Apenas admin/admin_master pode alterar o role de um usuário';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_role_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_self_role_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_self_role_escalation();
