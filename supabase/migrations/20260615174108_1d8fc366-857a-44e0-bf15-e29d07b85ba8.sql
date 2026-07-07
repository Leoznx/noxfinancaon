GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT ALL ON public.profiles TO service_role;

GRANT SELECT, INSERT, UPDATE ON public.consultas_credito TO anon, authenticated;
GRANT ALL ON public.consultas_credito TO service_role;

GRANT SELECT, INSERT, UPDATE ON public.inquilinos TO anon, authenticated;
GRANT ALL ON public.inquilinos TO service_role;

GRANT SELECT, INSERT, UPDATE ON public.imoveis TO anon, authenticated;
GRANT ALL ON public.imoveis TO service_role;

GRANT SELECT ON public.planos TO anon, authenticated;
GRANT ALL ON public.planos TO service_role;

GRANT SELECT ON public.imobiliarias TO anon, authenticated;
GRANT ALL ON public.imobiliarias TO service_role;

GRANT SELECT ON public.corretores TO anon, authenticated;
GRANT ALL ON public.corretores TO service_role;