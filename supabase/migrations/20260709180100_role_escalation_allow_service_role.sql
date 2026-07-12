-- Trigger anterior bloqueava também chamadas legítimas de backend/service role
-- (auth.uid() é NULL nesse contexto, então nem is_admin nem has_internal_role
-- passavam) — qualquer futura server function usando supabaseAdmin pra mudar
-- role de alguém seria bloqueada por engano. Libera explicitamente quando o
-- JWT é do service role.

CREATE OR REPLACE FUNCTION public.prevent_self_role_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NOT (
      auth.role() = 'service_role'
      OR public.is_admin(auth.uid())
      OR public.has_internal_role(auth.uid(), 'admin_master'::internal_role)
    ) THEN
      RAISE EXCEPTION 'Apenas admin/admin_master pode alterar o role de um usuário';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
