-- Limpa configurações antigas
DELETE FROM niveis_perfil;

-- Insere níveis unificados (mesmo plano para os 3 perfis)
INSERT INTO niveis_perfil (tipo_perfil, nome_nivel, min_contratos, max_contratos, percentual_comissao, bonus_renovacao, ordem, cor_hex, ativo) VALUES

-- CORRETOR
('corretor', 'BRONZE',   0,  10,   1.0, 0, 1, '#CD7F32', true),
('corretor', 'PRATA',    11, 20,   1.5, 0, 2, '#C0C0C0', true),
('corretor', 'OURO',     21, 30,   2.0, 0, 3, '#FFD60A', true),
('corretor', 'DIAMANTE', 31, NULL, 2.5, 0, 4, '#B9F2FF', true),

-- IMOBILIÁRIA
('imobiliaria', 'BRONZE',   0,  10,   1.0, 0, 1, '#CD7F32', true),
('imobiliaria', 'PRATA',    11, 20,   1.5, 0, 2, '#C0C0C0', true),
('imobiliaria', 'OURO',     21, 30,   2.0, 0, 3, '#FFD60A', true),
('imobiliaria', 'DIAMANTE', 31, NULL, 2.5, 0, 4, '#B9F2FF', true),

-- PROPRIETÁRIO
('proprietario', 'BRONZE',   0,  10,   1.0, 0, 1, '#CD7F32', true),
('proprietario', 'PRATA',    11, 20,   1.5, 0, 2, '#C0C0C0', true),
('proprietario', 'OURO',     21, 30,   2.0, 0, 3, '#FFD60A', true),
('proprietario', 'DIAMANTE', 31, NULL, 2.5, 0, 4, '#B9F2FF', true);
