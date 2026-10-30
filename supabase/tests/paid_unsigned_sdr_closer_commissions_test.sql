BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(12);

SELECT has_function(
  'public',
  'seller_client_commission_events_for',
  ARRAY['uuid'],
  'helper financeiro de comissoes existe'
);

SELECT matches(
  pg_get_functiondef('public.seller_client_commission_events_for(uuid)'::regprocedure),
  'payment_state',
  'helper reconhece pagamento confirmado na consulta'
);

SELECT matches(
  pg_get_functiondef('public.seller_client_commission_events_for(uuid)'::regprocedure),
  'faturas_inquilino',
  'helper reconhece primeira fatura paga'
);

SELECT ok(
  pg_get_functiondef('public.seller_client_commission_events_for(uuid)'::regprocedure)
    !~ 'signature_status|contract_accepted',
  'helper financeiro nao depende de assinatura ou aceite'
);

SELECT matches(
  pg_get_functiondef('public.seller_client_contract_events_for(uuid)'::regprocedure),
  '''ativa''.*''active''',
  'helper comercial continua restrito a contratos ativos'
);

SELECT matches(
  pg_get_functiondef('public.sync_seller_client_commission_rows(integer,integer)'::regprocedure),
  'seller_client_commission_events_for',
  'sincronizacao da folha usa o helper financeiro'
);

SELECT matches(
  pg_get_functiondef('public.refresh_seller_commission_for_policy(uuid)'::regprocedure),
  'seller_client_commission_events_for',
  'refresh por apolice usa o helper financeiro'
);

SELECT matches(
  pg_get_functiondef('public.refresh_seller_commissions_after_credit()'::regprocedure),
  'seller_client_commission_events_for',
  'atribuicao tardia reprocessa pagamento sem assinatura'
);

SELECT has_trigger(
  'public',
  'consultas_credito',
  'trg_refresh_seller_commission_consultation_payment',
  'marcar consulta como paga dispara a comissao'
);

SELECT has_trigger(
  'public',
  'apolices',
  'trg_refresh_seller_commission_policy',
  'apolice criada depois do pagamento reprocessa a comissao'
);

SELECT is(
  (
    SELECT string_agg(attribute.attname, ',' ORDER BY key_position.position)
    FROM pg_class AS index_relation
    JOIN pg_index AS index_definition ON index_definition.indexrelid = index_relation.oid
    CROSS JOIN LATERAL unnest(index_definition.indkey) WITH ORDINALITY AS key_position(attnum, position)
    JOIN pg_attribute AS attribute
      ON attribute.attrelid = index_definition.indrelid
     AND attribute.attnum = key_position.attnum
    WHERE index_relation.relname = 'seller_commissions_unique_contract'
  ),
  'seller_id,contract_id',
  'unicidade da comissao e global por vendedor e contrato'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.seller_commissions
    WHERE contract_id IS NOT NULL
    GROUP BY seller_id, contract_id
    HAVING count(*) > 1
    LIMIT 1
  ),
  NULL::integer,
  'nao existem comissoes duplicadas por vendedor e contrato'
);

SELECT * FROM finish();
ROLLBACK;
