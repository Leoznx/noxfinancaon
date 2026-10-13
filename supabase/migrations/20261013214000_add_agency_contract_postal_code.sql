-- O contrato D4Sign precisa do CEP da administradora. A tabela ja guardava
-- endereco, cidade e estado, mas nao havia coluna para o CEP.
ALTER TABLE public.imobiliarias
  ADD COLUMN IF NOT EXISTS cep text;

COMMENT ON COLUMN public.imobiliarias.cep IS
  'CEP da administradora usado nos contratos e apolices.';

-- Completa o cadastro publico da Magistral solicitado para esta contratacao.
UPDATE public.imobiliarias
SET endereco = coalesce(
      nullif(btrim(endereco), ''),
      'Avenida Brasil, 3965, Loja 01 Bl Ap L1, Regiao do Lago'
    ),
    cep = coalesce(nullif(regexp_replace(cep, '[^0-9]', '', 'g'), ''), '85812500'),
    cidade = coalesce(nullif(btrim(cidade), ''), 'Cascavel'),
    estado = coalesce(nullif(btrim(estado), ''), 'PR'),
    updated_at = now()
WHERE regexp_replace(cnpj, '[^0-9]', '', 'g') = '47872216000100';
