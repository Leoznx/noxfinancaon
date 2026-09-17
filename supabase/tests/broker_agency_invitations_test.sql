BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(20);

SELECT has_table('public', 'broker_agency_invitations', 'tabela de convites existe');
SELECT has_column('public', 'broker_agency_invitations', 'token_hash', 'token é armazenado somente como hash');
SELECT has_column('public', 'broker_agency_invitations', 'status', 'convite guarda status');
SELECT has_column('public', 'broker_agency_invitations', 'expires_at', 'convite possui validade');
SELECT has_column('public', 'broker_agency_invitations', 'accepted_at', 'convite guarda aceite');

SELECT ok(EXISTS (
  SELECT 1 FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'broker_agency_invitations'
    AND indexname = 'broker_agency_one_pending_per_broker_idx'
), 'há somente um convite pendente por corretor');

SELECT ok(to_regprocedure('public.create_my_broker_agency_invitation(uuid,text,uuid)') IS NOT NULL,
  'serviço pode criar convite');
SELECT ok(to_regprocedure('public.inspect_broker_agency_invitation(text)') IS NOT NULL,
  'serviço pode inspecionar convite');
SELECT ok(to_regprocedure('public.accept_broker_agency_invitation(text)') IS NOT NULL,
  'serviço pode aceitar convite');
SELECT ok(to_regprocedure('public.list_my_broker_agency_members()') IS NOT NULL,
  'imobiliária pode listar pendentes e ativos');

SELECT ok(NOT has_function_privilege('authenticated', 'public.create_my_broker_agency_invitation(uuid,text,uuid)', 'EXECUTE'),
  'cliente não consegue obter token diretamente');
SELECT ok(has_function_privilege('service_role', 'public.create_my_broker_agency_invitation(uuid,text,uuid)', 'EXECUTE'),
  'somente serviço cria convite');
SELECT ok(NOT has_function_privilege('authenticated', 'public.accept_broker_agency_invitation(text)', 'EXECUTE'),
  'cliente não pula confirmação chamando o aceite direto');
SELECT ok(has_function_privilege('service_role', 'public.accept_broker_agency_invitation(text)', 'EXECUTE'),
  'serviço aceita convite');
SELECT ok(has_function_privilege('authenticated', 'public.list_my_broker_agency_members()', 'EXECUTE'),
  'imobiliária autenticada lista sua equipe');

SELECT ok(NOT has_function_privilege('authenticated', 'public.link_my_corretor(uuid,text)', 'EXECUTE'),
  'vínculo direto não pode contornar convite');
SELECT ok(NOT has_function_privilege('authenticated', 'public.link_my_corretor(uuid)', 'EXECUTE'),
  'wrapper legado também está protegido');

SELECT ok(
  position('status = ''accepted''' IN pg_get_functiondef('public.accept_broker_agency_invitation(text)'::regprocedure)) > 0,
  'aceite muda o convite para ativo'
);
SELECT ok(
  position('commission_allocation_mode = v_inv.commission_allocation_mode' IN pg_get_functiondef('public.accept_broker_agency_invitation(text)'::regprocedure)) > 0,
  'regra financeira só é aplicada no aceite'
);
SELECT ok(
  position('contracts_count' IN pg_get_function_result('public.list_my_broker_agency_members()'::regprocedure)) > 0,
  'painel recebe quantidade de contratos'
);

SELECT * FROM finish();
ROLLBACK;
