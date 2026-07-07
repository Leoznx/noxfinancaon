-- Aba "Conta" (configuracoes) só salvava o CNPJ da imobiliária em localStorage,
-- nunca no banco — não persistia entre dispositivos/navegadores. Não existe
-- hoje nenhum vínculo entre profiles (role='imobiliaria') e a tabela
-- "imobiliarias" (que não tem profile_id/user_id), então o campo mais simples
-- e consistente com o resto de profiles é uma coluna direta aqui, no mesmo
-- padrão de "telefone"/"nome".
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cnpj TEXT;
