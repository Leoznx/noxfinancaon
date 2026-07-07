GRANT SELECT, INSERT, UPDATE ON public.corretores TO authenticated;
GRANT ALL ON public.corretores TO service_role;

DROP POLICY IF EXISTS "Corretores insert own data" ON public.corretores;
CREATE POLICY "Corretores insert own data"
  ON public.corretores FOR INSERT
  TO authenticated
  WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "Corretores update own data" ON public.corretores;
CREATE POLICY "Corretores update own data"
  ON public.corretores FOR UPDATE
  TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());