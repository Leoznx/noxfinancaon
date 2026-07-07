-- 1. Ativando RLS em tabelas que faltavam
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imobiliarias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corretores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imoveis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inquilinos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proprietarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.niveis_comissao ENABLE ROW LEVEL SECURITY;

-- 2. Políticas de Admin (Acesso Total)
CREATE POLICY "Admins possess full access on profiles" ON public.profiles FOR ALL USING (auth.uid() = id OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');
CREATE POLICY "Admins possess full access on imobiliarias" ON public.imobiliarias FOR ALL USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');
CREATE POLICY "Admins possess full access on corretores" ON public.corretores FOR ALL USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');
CREATE POLICY "Admins possess full access on imoveis" ON public.imoveis FOR ALL USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');
CREATE POLICY "Admins possess full access on inquilinos" ON public.inquilinos FOR ALL USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');
CREATE POLICY "Admins possess full access on proprietarios" ON public.proprietarios FOR ALL USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');
CREATE POLICY "Admins possess full access on comissoes" ON public.comissoes FOR ALL USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');
CREATE POLICY "Admins possess full access on consultas_credito" ON public.consultas_credito FOR ALL USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');
CREATE POLICY "Admins possess full access on apolices" ON public.apolices FOR ALL USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

-- 3. Políticas para Outros Perfis (Acesso público leitura para niveis de comissão por exemplo)
CREATE POLICY "Public read for niveis_comissao" ON public.niveis_comissao FOR SELECT USING (true);

-- 4. Corrigindo search_path da função
ALTER FUNCTION public.get_nivel_corretor_info(uuid) SET search_path = public;
