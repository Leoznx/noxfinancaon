-- HI-9: libera a reserva de troca de periodo quando o Edge Function falha no
-- meio do loop de cancelamentos Asaas. Sem isso, a reserva fica travada por 5
-- minutos (55P03) e o usuario nao consegue tentar um periodo diferente.

BEGIN;

CREATE OR REPLACE FUNCTION public.abort_contract_period_change(
  p_consultation_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.consultas_credito
  SET contract_period_change_pending_at = NULL,
      contract_period_change_pending_months = NULL
  WHERE id = p_consultation_id
    AND contract_period_change_pending_at IS NOT NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.abort_contract_period_change(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.abort_contract_period_change(uuid)
  TO service_role;

COMMIT;
