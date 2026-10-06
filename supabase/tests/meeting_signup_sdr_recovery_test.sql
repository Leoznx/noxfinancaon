BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(18);

SELECT has_function(
  'public',
  'resolve_seller_meeting_source_sdr',
  ARRAY['uuid', 'uuid', 'uuid'],
  'resolvedor compartilhado da origem SDR existe'
);
SELECT matches(
  pg_get_functiondef('public.resolve_seller_meeting_source_sdr(uuid,uuid,uuid)'::regprocedure),
  'seller_contact_leads',
  'resolvedor consulta Leads do Dia'
);
SELECT matches(
  pg_get_functiondef('public.resolve_seller_meeting_source_sdr(uuid,uuid,uuid)'::regprocedure),
  'lead.phone_normalized = v_meeting_phone',
  'telefone da reuniao tem prioridade na recuperacao'
);
SELECT matches(
  pg_get_functiondef('public.resolve_seller_meeting_source_sdr(uuid,uuid,uuid)'::regprocedure),
  'lead.phone_normalized = v_profile_phone',
  'telefone do perfil continua como fallback'
);
SELECT matches(
  pg_get_functiondef('public.resolve_seller_meeting_source_sdr(uuid,uuid,uuid)'::regprocedure),
  'translate\(',
  'texto legado e comparado sem diferenca de acentos'
);
SELECT matches(
  pg_get_functiondef('public.resolve_seller_meeting_source_sdr(uuid,uuid,uuid)'::regprocedure),
  'count\(DISTINCT id\) = 1',
  'nome em texto so vale quando aponta para um unico SDR'
);
SELECT matches(
  pg_get_functiondef('public.resolve_seller_meeting_source_sdr(uuid,uuid,uuid)'::regprocedure),
  'p_preferred_sdr_id',
  'Closer pode confirmar a origem quando a inferencia nao basta'
);
SELECT matches(
  pg_get_functiondef('public.resolve_seller_meeting_source_sdr(uuid,uuid,uuid)'::regprocedure),
  'sdr_id = v_resolved_sdr_id',
  'origem recuperada fica persistida na reuniao'
);
SELECT matches(
  pg_get_functiondef('public.resolve_seller_meeting_source_sdr(uuid,uuid,uuid)'::regprocedure),
  'source_sdr_id = v_resolved_sdr_id',
  'eventos da reuniao passam a carregar o SDR'
);
SELECT has_function(
  'public',
  'get_meeting_signup_links',
  ARRAY['uuid', 'uuid'],
  'RPC contextual aceita confirmacao opcional da origem'
);
SELECT matches(
  pg_get_functiondef('public.get_meeting_signup_links(uuid,uuid)'::regprocedure),
  'resolve_seller_meeting_source_sdr',
  'preparacao do link tenta estruturar a origem automaticamente'
);
SELECT has_function(
  'public',
  'get_meeting_source_sdr_options',
  ARRAY['uuid'],
  'fallback lista SDRs somente no contexto da reuniao'
);
SELECT matches(
  pg_get_functiondef('public.claim_seller_signup_link_for_meeting(uuid,text,uuid,text,text,text)'::regprocedure),
  'resolve_seller_meeting_source_sdr',
  'cadastro repete a resolucao no backend antes de atribuir'
);
SELECT matches(
  pg_get_functiondef('public.claim_seller_signup_link_for_meeting(uuid,text,uuid,text,text,text)'::regprocedure),
  'registered_profile_id, seller_id, seller_type',
  'credito SDR permanece idempotente por cliente e vendedor'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.resolve_seller_meeting_source_sdr(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'service_role pode resolver a origem transacionalmente'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.resolve_seller_meeting_source_sdr(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'cliente nao chama o resolvedor privilegiado diretamente'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.get_meeting_signup_links(uuid,uuid)',
    'EXECUTE'
  ),
  'Closer autenticado prepara o link contextual'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.claim_seller_signup_link_for_meeting(uuid,text,uuid,text,text,text)',
    'EXECUTE'
  ),
  'service_role executa a atribuicao do cadastro'
);

SELECT * FROM finish();
ROLLBACK;
