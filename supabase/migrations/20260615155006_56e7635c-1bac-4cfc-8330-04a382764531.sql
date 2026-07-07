
ALTER TABLE public.consultas_credito
  ADD COLUMN IF NOT EXISTS tenant_name text,
  ADD COLUMN IF NOT EXISTS tenant_document text,
  ADD COLUMN IF NOT EXISTS tenant_type text,
  ADD COLUMN IF NOT EXISTS property_address text,
  ADD COLUMN IF NOT EXISTS rent_value numeric(15,2),
  ADD COLUMN IF NOT EXISTS selected_exit_cost int,
  ADD COLUMN IF NOT EXISTS commission_enabled boolean;

-- Backfill from inquilinos/imoveis
UPDATE public.consultas_credito c
SET
  tenant_name = COALESCE(c.tenant_name, i.nome),
  tenant_document = COALESCE(c.tenant_document, regexp_replace(COALESCE(i.cpf, i.cnpj, ''), '\D', '', 'g')),
  tenant_type = COALESCE(c.tenant_type, i.tipo)
FROM public.inquilinos i
WHERE c.inquilino_id = i.id
  AND (c.tenant_name IS NULL OR c.tenant_document IS NULL);

UPDATE public.consultas_credito c
SET
  property_address = COALESCE(c.property_address, NULLIF(trim(both ', ' from concat_ws(', ',
    NULLIF(im.logradouro, ''),
    NULLIF(im.numero, ''),
    NULLIF(im.bairro, ''),
    NULLIF(im.cidade, ''),
    NULLIF(im.estado, '')
  )), '')),
  rent_value = COALESCE(c.rent_value, im.valor_aluguel)
FROM public.imoveis im
WHERE c.imovel_id = im.id
  AND (c.property_address IS NULL OR c.rent_value IS NULL);

-- Unique constraint: same user can't have same CPF/CNPJ twice
CREATE UNIQUE INDEX IF NOT EXISTS uniq_consulta_user_document
  ON public.consultas_credito (profile_id_solicitante, tenant_document)
  WHERE profile_id_solicitante IS NOT NULL AND tenant_document IS NOT NULL AND tenant_document <> '';

CREATE INDEX IF NOT EXISTS idx_consulta_tenant_document
  ON public.consultas_credito (tenant_document);
