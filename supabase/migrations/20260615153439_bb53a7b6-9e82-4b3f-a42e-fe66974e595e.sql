
-- 1. Colunas de vínculo do solicitante
ALTER TABLE public.consultas_credito
  ADD COLUMN IF NOT EXISTS profile_id_solicitante uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS role_solicitante text;

CREATE INDEX IF NOT EXISTS idx_consultas_profile_solicitante
  ON public.consultas_credito (profile_id_solicitante, created_at DESC);

-- 2. Backfill demonstrativo: liga consultas órfãs ao corretor demo
UPDATE public.consultas_credito c
SET profile_id_solicitante = p.id,
    role_solicitante = 'corretor'
FROM public.profiles p
WHERE p.email = 'corretor@nox.com'
  AND c.profile_id_solicitante IS NULL;

-- 3. Grants — Data API
GRANT SELECT, INSERT, UPDATE ON public.consultas_credito TO anon, authenticated;
GRANT ALL ON public.consultas_credito TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.inquilinos TO anon, authenticated;
GRANT ALL ON public.inquilinos TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.imoveis TO anon, authenticated;
GRANT ALL ON public.imoveis TO service_role;
GRANT SELECT ON public.planos TO anon, authenticated;
GRANT ALL ON public.planos TO service_role;
GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT ALL ON public.profiles TO service_role;
GRANT SELECT ON public.corretores TO anon, authenticated;
GRANT ALL ON public.corretores TO service_role;

-- 4. Políticas permissivas para o fluxo demo (filtragem por usuário no app)
DROP POLICY IF EXISTS "App reads consultas" ON public.consultas_credito;
CREATE POLICY "App reads consultas" ON public.consultas_credito FOR SELECT USING (true);
DROP POLICY IF EXISTS "App inserts consultas" ON public.consultas_credito;
CREATE POLICY "App inserts consultas" ON public.consultas_credito FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "App updates consultas" ON public.consultas_credito;
CREATE POLICY "App updates consultas" ON public.consultas_credito FOR UPDATE USING (true);

DROP POLICY IF EXISTS "App reads inquilinos" ON public.inquilinos;
CREATE POLICY "App reads inquilinos" ON public.inquilinos FOR SELECT USING (true);
DROP POLICY IF EXISTS "App inserts inquilinos" ON public.inquilinos;
CREATE POLICY "App inserts inquilinos" ON public.inquilinos FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "App reads imoveis" ON public.imoveis;
CREATE POLICY "App reads imoveis" ON public.imoveis FOR SELECT USING (true);
DROP POLICY IF EXISTS "App inserts imoveis" ON public.imoveis;
CREATE POLICY "App inserts imoveis" ON public.imoveis FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "App reads planos" ON public.planos;
CREATE POLICY "App reads planos" ON public.planos FOR SELECT USING (true);

DROP POLICY IF EXISTS "App reads profiles" ON public.profiles;
CREATE POLICY "App reads profiles" ON public.profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "App reads corretores" ON public.corretores;
CREATE POLICY "App reads corretores" ON public.corretores FOR SELECT USING (true);
