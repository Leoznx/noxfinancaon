-- Refactor planos table
ALTER TABLE public.planos RENAME COLUMN cobertura_max TO cobertura_multiplicador;
ALTER TABLE public.planos RENAME COLUMN percentual_premio TO taxa_premio;
ALTER TABLE public.planos DROP COLUMN IF EXISTS descricao;

ALTER TABLE public.planos ADD COLUMN IF NOT EXISTS custo_saida INT;
ALTER TABLE public.planos ADD COLUMN IF NOT EXISTS tem_comissao BOOLEAN DEFAULT false;
ALTER TABLE public.planos ADD COLUMN IF NOT EXISTS cobre_taxas_condominio BOOLEAN DEFAULT false;
ALTER TABLE public.planos ADD COLUMN IF NOT EXISTS comissao_meses INT;
ALTER TABLE public.planos ADD COLUMN IF NOT EXISTS destaque TEXT;
ALTER TABLE public.planos ADD COLUMN IF NOT EXISTS ordem INT;
ALTER TABLE public.planos ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT true;

-- Clean existing plans to avoid confusion with seeds
DELETE FROM public.planos;

-- Seed the 5 plans
INSERT INTO public.planos (nome, taxa_premio, custo_saida, cobertura_multiplicador, tem_comissao, cobre_taxas_condominio, comissao_meses, destaque, ordem) VALUES
('NOX Fit',         9.00,  3, 35, false, false, NULL, NULL,                  1),
('NOX Smart',       11.00, 3, 35, false, false, NULL, 'mais_aprovacoes',     2),
('NOX Fit+',        10.50, 5, 35, false, true,  NULL, NULL,                  3),
('NOX Smart+',      12.50, 5, 35, false, true,  NULL, 'cobre_taxas',         4),
('NOX Up',          15.00, 7, 40, true,  true,  12,   'maior_cobertura',     5);

-- Ensure RLS is enabled and policies exist
ALTER TABLE public.planos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to planos" ON public.planos
FOR SELECT USING (true);

GRANT SELECT ON public.planos TO anon, authenticated;
GRANT ALL ON public.planos TO service_role;
