GRANT SELECT ON public.niveis_perfil TO anon, authenticated;
GRANT ALL ON public.niveis_perfil TO service_role;
ALTER TABLE public.niveis_perfil ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Leitura pública dos níveis" ON public.niveis_perfil;
CREATE POLICY "Leitura pública dos níveis" ON public.niveis_perfil FOR SELECT USING (true);