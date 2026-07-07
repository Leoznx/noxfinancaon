
-- Helper: get the imobiliaria.id linked to the current authenticated user (by email match)
CREATE OR REPLACE FUNCTION public.current_imobiliaria_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id
  FROM public.imobiliarias i
  JOIN public.profiles p ON lower(p.email) = lower(i.contato_email)
  WHERE p.id = auth.uid() AND p.role = 'imobiliaria'::user_role
  LIMIT 1;
$$;

-- Allow imobiliaria to view corretores linked to her (already covered by "App reads corretores" USING(true), but make explicit)
-- Allow imobiliaria to link/unlink a corretor: UPDATE the corretores row to set/unset imobiliaria_id
DROP POLICY IF EXISTS "Imobiliaria can link corretores" ON public.corretores;
CREATE POLICY "Imobiliaria can link corretores"
ON public.corretores
FOR UPDATE
TO authenticated
USING (
  imobiliaria_id IS NULL
  OR imobiliaria_id = public.current_imobiliaria_id()
)
WITH CHECK (
  imobiliaria_id IS NULL
  OR imobiliaria_id = public.current_imobiliaria_id()
);
