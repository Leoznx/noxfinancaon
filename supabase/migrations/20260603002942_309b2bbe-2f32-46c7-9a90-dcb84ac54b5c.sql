-- Add simulation result fields to consultas_credito
ALTER TABLE public.consultas_credito ADD COLUMN IF NOT EXISTS valor_premio_mensal NUMERIC(10,2);
ALTER TABLE public.consultas_credito ADD COLUMN IF NOT EXISTS valor_anual NUMERIC(10,2);
ALTER TABLE public.consultas_credito ADD COLUMN IF NOT EXISTS base_calculo NUMERIC(10,2);

-- Add PJ support to inquilinos
ALTER TABLE public.inquilinos ADD COLUMN IF NOT EXISTS cnpj TEXT;
ALTER TABLE public.inquilinos ADD COLUMN IF NOT EXISTS razao_social TEXT;
ALTER TABLE public.inquilinos ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'PF';

-- Improve imoveis structure
ALTER TABLE public.imoveis ADD COLUMN IF NOT EXISTS logradouro TEXT;
ALTER TABLE public.imoveis ADD COLUMN IF NOT EXISTS numero TEXT;
ALTER TABLE public.imoveis ADD COLUMN IF NOT EXISTS complemento TEXT;
ALTER TABLE public.imoveis ADD COLUMN IF NOT EXISTS bairro TEXT;
ALTER TABLE public.imoveis ADD COLUMN IF NOT EXISTS cidade TEXT;
ALTER TABLE public.imoveis ADD COLUMN IF NOT EXISTS estado TEXT;
ALTER TABLE public.imoveis ADD COLUMN IF NOT EXISTS cep TEXT;
ALTER TABLE public.imoveis ADD COLUMN IF NOT EXISTS valor_condominio NUMERIC(10,2);
ALTER TABLE public.imoveis ADD COLUMN IF NOT EXISTS valor_taxas NUMERIC(10,2);
