-- Security hardening: single-use employee invitations and shared abuse controls.

CREATE TABLE IF NOT EXISTS public.nox_employee_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_type text NOT NULL CHECK (account_type IN ('sdr', 'closer', 'financeiro', 'juridico', 'marketing')),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_by uuid REFERENCES auth.users(id),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nox_employee_invites_active_idx
  ON public.nox_employee_invites (token_hash, expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;

ALTER TABLE public.nox_employee_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nox_employee_invites FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.nox_employee_invites TO service_role;

CREATE OR REPLACE FUNCTION public.create_nox_employee_invite(
  p_account_type text,
  p_ttl_minutes integer DEFAULT 1440
)
RETURNS TABLE(invite_token text, expires_at timestamptz, invite_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_token text;
  v_expiry timestamptz;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin'::public.user_role, 'admin_master'::public.user_role)
        AND coalesce(status, 'ativo') NOT IN ('bloqueado', 'excluido')
    )
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  ) THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_account_type NOT IN ('sdr', 'closer', 'financeiro', 'juridico', 'marketing') THEN
    RAISE EXCEPTION 'Tipo de conta inválido.' USING ERRCODE = '22023';
  END IF;
  IF p_ttl_minutes < 10 OR p_ttl_minutes > 10080 THEN
    RAISE EXCEPTION 'Prazo de convite inválido.' USING ERRCODE = '22023';
  END IF;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expiry := clock_timestamp() + make_interval(mins => p_ttl_minutes);

  INSERT INTO public.nox_employee_invites(account_type, token_hash, created_by, expires_at)
  VALUES (
    p_account_type,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    auth.uid(),
    v_expiry
  )
  RETURNING id INTO v_id;

  INSERT INTO public.internal_audit_logs(
    actor_user_id, actor_role, action, table_name, record_id, after
  ) VALUES (
    auth.uid(), 'admin', 'criar_convite_equipe_nox', 'nox_employee_invites', v_id,
    jsonb_build_object('account_type', p_account_type, 'expires_at', v_expiry)
  );

  RETURN QUERY SELECT v_token, v_expiry, v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_nox_employee_invite(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_nox_employee_invite(text, integer) TO authenticated;

CREATE TABLE IF NOT EXISTS public.security_rate_limits (
  scope text NOT NULL,
  identifier_hash text NOT NULL CHECK (identifier_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (scope, identifier_hash)
);

ALTER TABLE public.security_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.security_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.consume_security_rate_limit(
  p_scope text,
  p_identifier text,
  p_limit integer,
  p_window_seconds integer,
  p_block_seconds integer DEFAULT 900
)
RETURNS TABLE(allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_hash text;
  v_row public.security_rate_limits%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF length(trim(coalesce(p_scope, ''))) < 2 OR length(p_scope) > 80
     OR length(coalesce(p_identifier, '')) < 1 OR length(p_identifier) > 512
     OR p_limit < 1 OR p_limit > 10000
     OR p_window_seconds < 1 OR p_window_seconds > 86400
     OR p_block_seconds < 1 OR p_block_seconds > 604800 THEN
    RAISE EXCEPTION 'Parâmetros inválidos.' USING ERRCODE = '22023';
  END IF;

  v_hash := encode(extensions.digest(lower(trim(p_identifier)), 'sha256'), 'hex');
  INSERT INTO public.security_rate_limits(scope, identifier_hash, request_count)
  VALUES (p_scope, v_hash, 0)
  ON CONFLICT (scope, identifier_hash) DO NOTHING;

  SELECT * INTO v_row
  FROM public.security_rate_limits
  WHERE scope = p_scope AND identifier_hash = v_hash
  FOR UPDATE;

  IF v_row.blocked_until IS NOT NULL AND v_row.blocked_until > v_now THEN
    RETURN QUERY SELECT false, greatest(1, ceil(extract(epoch FROM v_row.blocked_until - v_now))::integer);
    RETURN;
  END IF;

  IF v_row.window_started_at + make_interval(secs => p_window_seconds) <= v_now THEN
    v_row.window_started_at := v_now;
    v_row.request_count := 0;
    v_row.blocked_until := NULL;
  END IF;

  v_row.request_count := v_row.request_count + 1;
  IF v_row.request_count > p_limit THEN
    v_row.blocked_until := v_now + make_interval(secs => p_block_seconds);
  END IF;

  UPDATE public.security_rate_limits
  SET window_started_at = v_row.window_started_at,
      request_count = v_row.request_count,
      blocked_until = v_row.blocked_until,
      updated_at = v_now
  WHERE scope = p_scope AND identifier_hash = v_hash;

  RETURN QUERY SELECT
    v_row.blocked_until IS NULL,
    CASE WHEN v_row.blocked_until IS NULL THEN 0
         ELSE greatest(1, ceil(extract(epoch FROM v_row.blocked_until - v_now))::integer)
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_security_rate_limit(text, text, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_security_rate_limit(text, text, integer, integer, integer)
  TO service_role;

-- Constrain existing public-facing buckets at the storage layer as well as in clients.
UPDATE storage.buckets
SET file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
WHERE id IN ('avatars', 'avatares', 'documentos-verificacao', 'time-clock-photos', 'biometria-ativacao');

UPDATE storage.buckets
SET file_size_limit = 10485760,
    allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
WHERE id IN ('anexos', 'approval-documents');
