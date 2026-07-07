
-- Função SECURITY DEFINER para checar admin sem recursão
CREATE OR REPLACE FUNCTION public.is_admin(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _uid AND role = 'admin'::user_role)
$$;

-- Remove políticas recursivas
DROP POLICY IF EXISTS "Admins possess full access on profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;

-- Recria com função não-recursiva
CREATE POLICY "Admins full access profiles"
  ON public.profiles FOR ALL
  USING (public.is_admin(auth.uid()) OR auth.uid() = id)
  WITH CHECK (public.is_admin(auth.uid()) OR auth.uid() = id);
