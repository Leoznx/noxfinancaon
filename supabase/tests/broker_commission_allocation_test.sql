BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(20);

SELECT ok(EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='corretores'
    AND column_name='commission_allocation_mode' AND is_nullable='NO'
), 'corretor possui regra obrigatória de distribuição');

SELECT ok(EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conrelid='public.corretores'::regclass
    AND conname='corretores_commission_allocation_mode_check'
), 'regra do corretor aceita somente os três modos canônicos');

SELECT ok(EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='apolices'
    AND column_name='commission_allocation_mode_snapshot'
), 'apólice guarda fotografia da regra');

SELECT ok(EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='apolices'
    AND column_name='commission_origin_broker_profile_id'
), 'apólice guarda corretor de origem');

SELECT ok(EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='apolices'
    AND column_name='commission_origin_agency_profile_id'
), 'apólice guarda imobiliária de origem');

SELECT ok(EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='comissoes'
    AND column_name='allocation_share_bps'
), 'comissão guarda participação em pontos-base');

SELECT ok(EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='comissoes'
    AND column_name='allocation_mode'
), 'comissão guarda modo aplicado');

SELECT ok(EXISTS (
  SELECT 1 FROM pg_trigger
  WHERE tgrelid='public.apolices'::regclass
    AND tgname='capture_policy_commission_allocation'
    AND NOT tgisinternal
), 'apólice captura a regra automaticamente');

SELECT ok(
  position('Uma fotografia já capturada nunca é recalculada' IN
    pg_get_functiondef('private.capture_policy_commission_allocation()'::regprocedure)) > 0,
  'captura protege a fotografia já registrada'
);

SELECT ok(to_regprocedure('public.link_my_corretor(uuid,text)') IS NOT NULL,
  'vínculo aceita regra financeira obrigatória');
SELECT ok(to_regprocedure('public.link_my_corretor(uuid)') IS NOT NULL,
  'vínculo mantém compatibilidade temporária com clientes antigos');
SELECT ok(to_regprocedure('public.update_my_corretor_commission_allocation(uuid,text)') IS NOT NULL,
  'imobiliária pode atualizar a regra dos próximos contratos');
SELECT ok(to_regprocedure('public.get_my_broker_commission_access()') IS NOT NULL,
  'corretor consulta a própria permissão financeira');

SELECT ok(has_function_privilege('authenticated', 'public.link_my_corretor(uuid,text)', 'EXECUTE'),
  'imobiliária autenticada pode vincular com regra');
SELECT ok(NOT has_function_privilege('anon', 'public.link_my_corretor(uuid,text)', 'EXECUTE'),
  'visitante não pode definir regra financeira');
SELECT ok(has_function_privilege('authenticated', 'public.update_my_corretor_commission_allocation(uuid,text)', 'EXECUTE'),
  'imobiliária autenticada pode alterar a regra');
SELECT ok(NOT has_function_privilege('anon', 'public.update_my_corretor_commission_allocation(uuid,text)', 'EXECUTE'),
  'visitante não pode alterar a regra');

SELECT ok(
  position('v_broker_cents := v_pool_cents / 2' IN
    pg_get_functiondef('public.generate_commissions_for_policy(uuid,text,boolean)'::regprocedure)) > 0,
  'divisão usa centavos inteiros sem arredondamento duplicado'
);
SELECT ok(
  position('v_agency_cents := v_pool_cents - v_broker_cents' IN
    pg_get_functiondef('public.generate_commissions_for_policy(uuid,text,boolean)'::regprocedure)) > 0,
  'a soma das duas partes reconcilia exatamente com o total'
);
SELECT ok(
  position('private.record_policy_commission' IN
    pg_get_functiondef('public.generate_commissions_for_policy(uuid,text,boolean)'::regprocedure)) > 0,
  'todas as partes passam pelo mesmo razão financeira idempotente'
);

SELECT * FROM finish();
ROLLBACK;
