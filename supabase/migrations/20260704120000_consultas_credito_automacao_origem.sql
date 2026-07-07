-- Rastreia como o resultado de uma automação de crédito externa (ex.: CredPago) foi obtido.
-- Necessário porque o fluxo atual é "manual assistido" (corretor cola o resultado do
-- portal do parceiro) e futuramente poderá virar "api_oficial" quando houver acesso de
-- parceiro homologado — sem isso não dá pra distinguir os dois modos em relatórios.
alter table public.consultas_credito
  add column if not exists automacao_origem text;

alter table public.consultas_credito
  add constraint consultas_credito_automacao_origem_check
  check (automacao_origem is null or automacao_origem in ('manual_assistido', 'mock', 'api_oficial'));

comment on column public.consultas_credito.automacao_origem is
  'Origem do resultado de automação de crédito: manual_assistido (corretor colou o retorno do portal do parceiro), mock (dados de teste) ou api_oficial (integração oficial futura).';
