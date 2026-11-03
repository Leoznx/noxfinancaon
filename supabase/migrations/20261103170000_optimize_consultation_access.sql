-- Consulta lists are read on nearly every authenticated surface.  The previous
-- policies invoked SECURITY DEFINER helpers once per consultas_credito row,
-- including profile and agency lookups.  On the production data set that made a
-- 37-row broker list scan the whole table and execute the same authorization
-- work hundreds of times, eventually reaching Postgres' statement timeout once
-- related records were embedded by PostgREST.

CREATE INDEX IF NOT EXISTS imobiliarias_contato_email_lower_idx
  ON public.imobiliarias (lower(contato_email))
  WHERE contato_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS corretores_imobiliaria_profile_idx
  ON public.corretores (imobiliaria_id, profile_id)
  WHERE imobiliaria_id IS NOT NULL AND profile_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.current_authenticated_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_catalog, pg_temp
AS $$
  SELECT COALESCE(
    NULLIF(auth.jwt() ->> 'email', ''),
    (
      SELECT profile.email
      FROM public.profiles AS profile
      WHERE profile.id = auth.uid()
    )
  );
$$;

REVOKE ALL ON FUNCTION public.current_authenticated_email()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_authenticated_email()
  TO authenticated, service_role;

COMMENT ON FUNCTION public.current_authenticated_email() IS
  'Returns the authenticated email from JWT, with a profile fallback for server-side and test sessions.';

CREATE OR REPLACE FUNCTION public.current_agency_broker_profile_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_catalog, pg_temp
AS $$
  SELECT broker.profile_id
  FROM public.corretores AS broker
  WHERE broker.imobiliaria_id = public.current_imobiliaria_id()
    AND broker.profile_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.current_agency_broker_profile_ids()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_agency_broker_profile_ids()
  TO authenticated, service_role;

COMMENT ON FUNCTION public.current_agency_broker_profile_ids() IS
  'Returns broker profile ids linked to the currently authenticated agency.';

DROP POLICY IF EXISTS "Consultas: select dono, imobiliária, inquilino ou staff"
  ON public.consultas_credito;
DROP POLICY IF EXISTS "Consultas: insert em nome de si mesmo ou staff"
  ON public.consultas_credito;
DROP POLICY IF EXISTS "Consultas: update dono, imobiliária ou staff"
  ON public.consultas_credito;

CREATE POLICY "Consultas: select dono, imobiliária, inquilino ou staff"
ON public.consultas_credito
FOR SELECT
TO authenticated
USING (
  profile_id_solicitante = (SELECT auth.uid())
  OR profile_id_solicitante IN (
    SELECT public.current_agency_broker_profile_ids()
  )
  OR tenant_user_id = (SELECT auth.uid())
  OR tenant_email = (SELECT public.current_authenticated_email())
  OR (SELECT public.eh_staff_interno_consultas())
);

CREATE POLICY "Consultas: insert em nome de si mesmo ou staff"
ON public.consultas_credito
FOR INSERT
TO authenticated
WITH CHECK (
  profile_id_solicitante = (SELECT auth.uid())
  OR (SELECT public.eh_staff_interno_consultas())
);

CREATE POLICY "Consultas: update dono, imobiliária ou staff"
ON public.consultas_credito
FOR UPDATE
TO authenticated
USING (
  profile_id_solicitante = (SELECT auth.uid())
  OR profile_id_solicitante IN (
    SELECT public.current_agency_broker_profile_ids()
  )
  OR (SELECT public.eh_staff_interno_consultas())
)
WITH CHECK (
  profile_id_solicitante = (SELECT auth.uid())
  OR profile_id_solicitante IN (
    SELECT public.current_agency_broker_profile_ids()
  )
  OR (SELECT public.eh_staff_interno_consultas())
);
