-- 0. Seed de Proprietários (Necessário para Imóveis)
INSERT INTO public.proprietarios (id, nome, cpf_cnpj, email)
SELECT 
  gen_random_uuid(), 
  'Proprietário ' || i, 
  LPAD(floor(random()*10000000000)::text, 11, '0'),
  'prop' || i || '@exemplo.com'
FROM generate_series(1, 2) AS i;

-- 1. Seed de Imobiliárias
INSERT INTO public.imobiliarias (id, razao_social, cnpj, creci, endereco, contato_email)
SELECT 
  gen_random_uuid(), 
  'Imobiliária ' || i || ' LTDA', 
  LPAD(floor(random()*100000000000000)::text, 14, '0'),
  'CRECI-J-' || LPAD(floor(random()*100000)::text, 5, '0'),
  'Av. Principal, ' || i * 100,
  'contato' || i || '@imob.com'
FROM generate_series(1, 5) AS i;

-- 2. Seed de Inquilinos
INSERT INTO public.inquilinos (id, nome, cpf, renda, score)
SELECT 
  gen_random_uuid(), 
  'Inquilino ' || i, 
  LPAD(floor(random()*10000000000)::text, 11, '0'),
  3000 + (random() * 10000),
  floor(random() * 1000)
FROM generate_series(1, 30) AS i;

-- 3. Seed de Imóveis (tipo Residencial)
INSERT INTO public.imoveis (id, endereco, valor_aluguel, imobiliaria_id, proprietario_id, tipo)
SELECT 
  gen_random_uuid(), 
  'Rua Exemplo, ' || i, 
  2000 + (random() * 5000),
  (SELECT id FROM public.imobiliarias ORDER BY random() LIMIT 1),
  (SELECT id FROM public.proprietarios ORDER BY random() LIMIT 1),
  'Residencial'
FROM generate_series(1, 20) AS i;

-- 4. Seed de Consultas de Crédito
INSERT INTO public.consultas_credito (id, inquilino_id, imovel_id, status, score_interno)
SELECT 
  gen_random_uuid(), 
  (SELECT id FROM public.inquilinos OFFSET i-1 LIMIT 1),
  (SELECT id FROM public.imoveis ORDER BY random() LIMIT 1),
  (ARRAY['pendente', 'em_analise', 'aprovada', 'reprovada'])[floor(random()*4)+1],
  floor(random() * 100)
FROM generate_series(1, 10) AS i;

-- 5. Seed de Apólices
INSERT INTO public.apolices (id, consulta_id, numero, status, vigencia_inicio, vigencia_fim, valor_premio)
SELECT 
  gen_random_uuid(), 
  (SELECT id FROM public.consultas_credito WHERE status = 'aprovada' OFFSET i-1 LIMIT 1),
  'AP-' || i || '-' || floor(random()*100000),
  'ativa',
  CURRENT_DATE,
  CURRENT_DATE + interval '1 year',
  150.00 + (random() * 500)
FROM generate_series(1, 5) AS i
WHERE (SELECT count(*) FROM public.consultas_credito WHERE status = 'aprovada') >= i;
