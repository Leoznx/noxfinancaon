-- A valid HTTP 200 can be billed even when QUOD introduces an unknown score
-- label. Keep the consultation in manual verification, but record the known
-- provider debit instead of treating its cost as unknown.

CREATE OR REPLACE FUNCTION public.fail_official_credit_simulation(
  p_consultation_id uuid,
  p_worker_id text,
  p_execution_version bigint,
  p_error_code text,
  p_user_message text,
  p_ambiguous_charge boolean,
  p_provider_http_status integer,
  p_charge_confirmed boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_failed boolean;
  v_cost integer;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  v_failed := public.fail_official_credit_simulation(
    p_consultation_id,
    p_worker_id,
    p_execution_version,
    p_error_code,
    p_user_message,
    p_ambiguous_charge,
    p_provider_http_status
  );

  IF v_failed AND p_charge_confirmed THEN
    SELECT unit_cost_cents INTO v_cost
    FROM public.credit_api_provider_config
    WHERE provider_key = 'directd-quod';

    UPDATE public.directd_credit_requests
    SET billed_cents = coalesce(v_cost, 198),
        updated_at = clock_timestamp()
    WHERE consultation_id = p_consultation_id;
  END IF;

  RETURN v_failed;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_official_credit_simulation(
  uuid, text, bigint, text, text, boolean, integer, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_official_credit_simulation(
  uuid, text, bigint, text, text, boolean, integer, boolean
) TO service_role;
