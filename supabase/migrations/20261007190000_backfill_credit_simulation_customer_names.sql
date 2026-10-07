-- Uma consulta pode ter sido criada apenas com CPF/CNPJ. Quando o inquilino
-- vinculado já tem nome válido, aproveita esse dado para que resultados aprovados
-- antigos também deixem de aparecer como "Cliente" ou somente com o documento.
UPDATE public.consultas_credito AS consulta
SET tenant_name = btrim(inquilino.nome)
FROM public.inquilinos AS inquilino
WHERE consulta.inquilino_id = inquilino.id
  AND nullif(btrim(inquilino.nome), '') IS NOT NULL
  AND btrim(inquilino.nome) !~ '[0-9]'
  AND btrim(inquilino.nome) !~* '\m(cpf|cnpj)\M'
  AND (
    nullif(btrim(consulta.tenant_name), '') IS NULL
    OR btrim(consulta.tenant_name) ~ '^[0-9./* -]+$'
  );
