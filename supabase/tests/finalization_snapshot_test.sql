BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(7);

SELECT has_function(
  'public',
  'get_consultation_finalization_snapshot',
  ARRAY['uuid']::text[],
  'a finalizacao possui um snapshot compartilhado'
);

SELECT function_returns(
  'public',
  'get_consultation_finalization_snapshot',
  ARRAY['uuid']::text[],
  'jsonb',
  'o snapshot possui um contrato JSON unico para site e app'
);

SELECT ok(
  position(
    'public.eh_dono_ou_imobiliaria_da_consulta' IN
    pg_get_functiondef('public.get_consultation_finalization_snapshot(uuid)'::regprocedure)
  ) > 0,
  'o snapshot preserva o acesso da imobiliaria e do solicitante'
);

SELECT ok(
  position(
    'public.eh_staff_interno_consultas' IN
    pg_get_functiondef('public.get_consultation_finalization_snapshot(uuid)'::regprocedure)
  ) > 0,
  'o snapshot preserva o acesso da equipe interna'
);

SELECT ok(
  position(
    'raw_response' IN
    pg_get_functiondef('public.get_consultation_finalization_snapshot(uuid)'::regprocedure)
  ) = 0,
  'respostas tecnicas grandes nao fazem parte da finalizacao'
);

SELECT has_index(
  'public',
  'documentos_proposta',
  'documentos_proposta_consulta_created_idx',
  'documentos da proposta usam indice por consulta'
);

SELECT has_index(
  'public',
  'faturas_inquilino',
  'faturas_inquilino_consulta_created_idx',
  'progresso financeiro usa indice por consulta'
);

SELECT * FROM finish();
ROLLBACK;
