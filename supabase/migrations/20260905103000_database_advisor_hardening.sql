-- Close direct API access to SECURITY DEFINER trigger and maintenance helpers.
-- Triggers continue to invoke their functions as the function owner; application
-- users do not need EXECUTE on these routines.
DO $revoke_trigger_execution$
DECLARE
  trigger_function regprocedure;
BEGIN
  FOR trigger_function IN
    SELECT p.oid::regprocedure
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.prorettype = 'trigger'::regtype
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      trigger_function
    );
  END LOOP;
END
$revoke_trigger_execution$;

REVOKE EXECUTE ON FUNCTION public._distribuir_sales_lead_core(text, text, text, text, text, text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.aplicar_clawback_vendedor()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.liberar_reservas_vendedor()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_marketing_from_consulta_direct(public.consultas_credito)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_marketing_from_consulta_row(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.upsert_marketing_contact(text, text, text, text, text, text, numeric, text, uuid, text, text, timestamptz, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validar_ativacao_token(text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._distribuir_sales_lead_core(text, text, text, text, text, text, text, text, text, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.aplicar_clawback_vendedor()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.liberar_reservas_vendedor()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_marketing_from_consulta_direct(public.consultas_credito)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_marketing_from_consulta_row(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_marketing_contact(text, text, text, text, text, text, numeric, text, uuid, text, text, timestamptz, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.validar_ativacao_token(text, text)
  TO service_role;

-- Pin the lookup path on the remaining utility and trigger functions identified
-- by the database security advisor. pg_catalog stays first so built-ins cannot
-- be shadowed by user-created objects.
ALTER FUNCTION public.calcular_bonus_vendedor(integer)
  SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.calcular_comissao_vendedor(integer)
  SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.handle_updated_at()
  SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.is_valid_cnpj(text)
  SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.is_valid_cpf(text)
  SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.is_valid_pix_key(text, text)
  SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.liberar_comissoes_apos_pagamento()
  SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.marketing_first_name(text)
  SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.marketing_rent_range(numeric)
  SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.mask_pix_key(text, text)
  SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.normalize_pix_key(text, text)
  SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.normalize_whitespace(text)
  SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.repair_visible_text_encoding(text)
  SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.sync_updated_at()
  SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION public.update_updated_at_column()
  SET search_path = pg_catalog, public, extensions, pg_temp;
