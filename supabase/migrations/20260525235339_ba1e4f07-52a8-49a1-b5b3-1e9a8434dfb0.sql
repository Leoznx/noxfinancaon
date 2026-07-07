-- Correção do search_path para a função de trigger
ALTER FUNCTION public.handle_updated_at() SET search_path = public;

-- Políticas de RLS para as tabelas (Acesso completo para Admin)
DO $$ 
DECLARE 
    t text;
BEGIN
    FOR t IN (SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') 
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "Admin full access" ON public.%I', t);
        EXECUTE format('CREATE POLICY "Admin full access" ON public.%I FOR ALL TO authenticated USING (auth.jwt() ->> ''role'' = ''admin'')', t);
    END LOOP;
END $$;

-- Políticas específicas para usuários verem seus próprios dados
CREATE POLICY "Users view own profiles" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users update own profiles" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Corretores veem seus dados
CREATE POLICY "Corretores view own data" ON public.corretores FOR SELECT TO authenticated USING (profile_id = auth.uid());

-- Inquilinos veem seus dados
CREATE POLICY "Inquilinos view own data" ON public.inquilinos FOR SELECT TO authenticated USING (profile_id = auth.uid());

-- Permitir que usuários autenticados vejam os planos
CREATE POLICY "Anyone authenticated can view planos" ON public.planos FOR SELECT TO authenticated USING (true);
