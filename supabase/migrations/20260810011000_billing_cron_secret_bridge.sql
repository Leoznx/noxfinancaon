-- Ponte temporaria para alinhar o segredo do pg_cron com a Edge Function.
-- A funcao aceita chamadas somente da service_role e sera removida assim que
-- a configuracao operacional for concluida.
CREATE OR REPLACE FUNCTION public.configure_billing_cron_secret(p_secret text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, auth, pg_catalog
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SERVICE_ROLE_REQUIRED';
  END IF;
  IF length(coalesce(p_secret, '')) < 32 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_CRON_SECRET';
  END IF;
  DELETE FROM vault.secrets WHERE name = 'cron_notifications_secret';
  PERFORM vault.create_secret(
    p_secret,
    'cron_notifications_secret',
    'Autenticacao do cron da automacao financeira NOX'
  );
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.configure_billing_cron_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_billing_cron_secret(text) TO service_role;
