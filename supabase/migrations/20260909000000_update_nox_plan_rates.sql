-- Mantem o catalogo compartilhado em paridade com as taxas usadas pelos
-- seletores web/mobile. Os valores ja gravados em contratos existentes nao
-- sao recalculados; novas selecoes persistem o premio com estas taxas.
UPDATE public.planos
SET taxa_premio = CASE nome
  WHEN 'NOX Fit' THEN 9.00
  WHEN 'NOX Fit+' THEN 10.50
  WHEN 'NOX Smart' THEN 10.50
  WHEN 'NOX Smart+' THEN 12.00
  WHEN 'NOX Up' THEN 14.00
  ELSE taxa_premio
END
WHERE nome IN ('NOX Fit', 'NOX Fit+', 'NOX Smart', 'NOX Smart+', 'NOX Up');
