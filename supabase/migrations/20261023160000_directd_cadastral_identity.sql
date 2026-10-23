-- The QUOD score endpoint does not return the customer's name. Resolve the
-- identity with Direct Data's basic PF/PJ registration endpoint in the same
-- official simulation and keep a separate, idempotent billing trail.

INSERT INTO public.credit_api_provider_config(provider_key, enabled, unit_cost_cents)
VALUES ('directd-cadastro', true, 16)
ON CONFLICT (provider_key) DO UPDATE SET
  enabled = EXCLUDED.enabled,
  unit_cost_cents = EXCLUDED.unit_cost_cents,
  updated_at = clock_timestamp();

ALTER TABLE public.directd_credit_requests
  ADD COLUMN IF NOT EXISTS identity_status text,
  ADD COLUMN IF NOT EXISTS identity_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS identity_provider_http_status integer,
  ADD COLUMN IF NOT EXISTS identity_provider_consulta_uid text,
  ADD COLUMN IF NOT EXISTS identity_customer_name text,
  ADD COLUMN IF NOT EXISTS identity_birth_date date,
  ADD COLUMN IF NOT EXISTS identity_billed_cents integer,
  ADD COLUMN IF NOT EXISTS identity_error_code text,
  ADD COLUMN IF NOT EXISTS identity_response jsonb,
  ADD COLUMN IF NOT EXISTS identity_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS identity_completed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.directd_credit_requests'::regclass
      AND conname = 'directd_credit_requests_identity_status_check'
  ) THEN
    ALTER TABLE public.directd_credit_requests
      ADD CONSTRAINT directd_credit_requests_identity_status_check
      CHECK (
        identity_status IS NULL OR identity_status IN (
          'submitting', 'succeeded', 'failed_no_charge', 'requires_verification'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.directd_credit_requests'::regclass
      AND conname = 'directd_credit_requests_identity_attempt_count_check'
  ) THEN
    ALTER TABLE public.directd_credit_requests
      ADD CONSTRAINT directd_credit_requests_identity_attempt_count_check
      CHECK (identity_attempt_count BETWEEN 0 AND 20);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.directd_credit_requests'::regclass
      AND conname = 'directd_credit_requests_identity_billed_cents_check'
  ) THEN
    ALTER TABLE public.directd_credit_requests
      ADD CONSTRAINT directd_credit_requests_identity_billed_cents_check
      CHECK (identity_billed_cents IS NULL OR identity_billed_cents >= 0);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_official_credit_simulation(
  p_tenant_type text,
  p_tenant_name text,
  p_tenant_document text,
  p_property_type text,
  p_property_zip text,
  p_property_city text,
  p_property_state text,
  p_property_address text,
  p_rent_value numeric,
  p_condominium_value numeric,
  p_fee_value numeric,
  p_operational_zip text,
  p_correlation_id text,
  p_idempotency_key uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_id uuid;
  v_enabled boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT bool_and(enabled) INTO v_enabled
  FROM public.credit_api_provider_config
  WHERE provider_key IN ('directd-quod', 'directd-cadastro');

  IF coalesce(v_enabled, false) IS NOT TRUE OR (
    SELECT count(*) FROM public.credit_api_provider_config
    WHERE provider_key IN ('directd-quod', 'directd-cadastro')
  ) <> 2 THEN
    RAISE EXCEPTION 'Official credit provider is disabled' USING ERRCODE = 'P0001';
  END IF;

  -- p_tenant_name remains in the signature for rolling-client compatibility,
  -- but official identity always comes from the CPF/CNPJ API response.
  v_id := public.enqueue_credit_simulation(
    p_tenant_type, NULL, p_tenant_document, p_property_type,
    p_property_zip, p_property_city, p_property_state, p_property_address,
    p_rent_value, p_condominium_value, p_fee_value, p_operational_zip,
    p_correlation_id, p_idempotency_key
  );

  UPDATE public.consultas_credito
  SET
    provider_credential_key = 'directd-quod',
    external_provider = 'directd_quod',
    automacao_origem = 'api_oficial',
    max_attempts = 1,
    updated_at = clock_timestamp()
  WHERE id = v_id
    AND profile_id_solicitante = v_caller;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_official_credit_simulation(
  text, text, text, text, text, text, text, text, numeric, numeric, numeric, text, text, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_official_credit_simulation(
  text, text, text, text, text, text, text, text, numeric, numeric, numeric, text, text, uuid
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_official_credit_identity(
  p_consultation_id uuid,
  p_worker_id text,
  p_execution_version bigint,
  p_customer_name text,
  p_birth_date date,
  p_provider_external_id text,
  p_sanitized_response jsonb,
  p_provider_http_status integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_name text := public.normalize_official_credit_customer_name(p_customer_name);
  v_tenant_id uuid;
  v_tenant_type text;
  v_cost integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Invalid provider customer name' USING ERRCODE = '22023';
  END IF;

  SELECT unit_cost_cents INTO v_cost
  FROM public.credit_api_provider_config
  WHERE provider_key = 'directd-cadastro'
    AND enabled IS TRUE;
  IF v_cost IS NULL THEN
    RAISE EXCEPTION 'Identity provider is disabled' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.consultas_credito
  SET tenant_name = v_name,
      tenant_data_nascimento = CASE
        WHEN upper(coalesce(tipo_pessoa, tenant_type, '')) = 'PF' AND p_birth_date IS NOT NULL
          THEN p_birth_date
        ELSE tenant_data_nascimento
      END,
      automation_step = 'consultando_score',
      heartbeat_at = v_now,
      lease_expires_at = greatest(coalesce(lease_expires_at, v_now), v_now + interval '1 minute'),
      updated_at = v_now
  WHERE id = p_consultation_id
    AND provider_credential_key = 'directd-quod'
    AND worker_id = p_worker_id
    AND execution_version = p_execution_version
    AND technical_status = 'processing'
    AND provider_submission_state = 'submitting'
  RETURNING inquilino_id, upper(coalesce(tipo_pessoa, tenant_type, ''))
    INTO v_tenant_id, v_tenant_type;

  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.inquilinos
  SET nome = v_name,
      razao_social = CASE WHEN v_tenant_type = 'PJ' THEN v_name ELSE razao_social END,
      data_nascimento = CASE
        WHEN v_tenant_type = 'PF' AND p_birth_date IS NOT NULL THEN p_birth_date
        ELSE data_nascimento
      END,
      updated_at = v_now
  WHERE id = v_tenant_id;

  UPDATE public.directd_credit_requests
  SET identity_status = 'succeeded',
      identity_provider_http_status = p_provider_http_status,
      identity_provider_consulta_uid = nullif(btrim(p_provider_external_id), ''),
      identity_customer_name = v_name,
      identity_birth_date = CASE WHEN v_tenant_type = 'PF' THEN p_birth_date ELSE NULL END,
      identity_billed_cents = v_cost,
      identity_error_code = NULL,
      identity_response = coalesce(p_sanitized_response, '{}'::jsonb),
      identity_completed_at = v_now,
      updated_at = v_now
  WHERE consultation_id = p_consultation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Identity request ledger not found' USING ERRCODE = 'P0001';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.save_official_credit_identity(
  uuid, text, bigint, text, date, text, jsonb, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_official_credit_identity(
  uuid, text, bigint, text, date, text, jsonb, integer
) TO service_role;

COMMENT ON COLUMN public.directd_credit_requests.identity_billed_cents IS
  'Expected Direct Data cadastral lookup debit, separate from the QUOD score debit.';
COMMENT ON COLUMN public.directd_credit_requests.identity_response IS
  'Sanitized identity response containing only name and optional birth date.';
