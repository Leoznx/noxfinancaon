-- Primeiro, removemos todos os planos atuais para garantir a unificação solicitada
DELETE FROM public.planos;

-- Inserimos os 4 planos universais
INSERT INTO public.planos (nome, percentual_premio, cobertura_max, descricao)
VALUES 
('NOX Essencial', 8.0, 30, 'Cobertura de 30x o aluguel, custo de saída 3x.'),
('NOX Plus', 10.0, 35, 'Cobertura de 35x o aluguel, custo de saída 3x. Recomendado.'),
('NOX Premium', 12.0, 35, 'Cobertura de 35x o aluguel, custo de saída 5x.'),
('NOX Top', 15.0, 40, 'Cobertura de 40x o aluguel, custo de saída 5x.');