-- Several early policies were created for the generic "public" role with
-- unconditional predicates. In Postgres that includes anon and exposed payment,
-- document and personal-data rows through PostgREST. Replace them with explicit
-- authenticated ownership rules while keeping service-role integrations intact.

-- Track who created tenant/property rows. Existing application inserts omit this
-- field, so the auth.uid() default preserves compatibility.
ALTER TABLE public.imoveis
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
  DEFAULT auth.uid();
ALTER TABLE public.inquilinos
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
  DEFAULT auth.uid();

CREATE INDEX IF NOT EXISTS imoveis_created_by_idx ON public.imoveis(created_by);
CREATE INDEX IF NOT EXISTS inquilinos_created_by_idx ON public.inquilinos(created_by);

DROP POLICY IF EXISTS "App reads cakto_payments" ON public.cakto_payments;
DROP POLICY IF EXISTS "App inserts cakto_payments" ON public.cakto_payments;
DROP POLICY IF EXISTS "App updates cakto_payments" ON public.cakto_payments;

CREATE POLICY "Payment participants read cakto payments"
  ON public.cakto_payments FOR SELECT TO authenticated
  USING (
    (contract_id IS NOT NULL AND public.can_view_policy(auth.uid(), contract_id))
    OR EXISTS (
      SELECT 1
      FROM public.consultas_credito AS consultation
      WHERE consultation.id = cakto_payments.consultation_id
        AND (
          consultation.profile_id_solicitante = auth.uid()
          OR consultation.tenant_user_id = auth.uid()
          OR consultation.tenant_email = (
            SELECT profile.email FROM public.profiles AS profile WHERE profile.id = auth.uid()
          )
          OR public.eh_staff_interno_consultas()
        )
    )
  );

CREATE POLICY "Payment participants insert cakto payments"
  ON public.cakto_payments FOR INSERT TO authenticated
  WITH CHECK (
    (contract_id IS NOT NULL AND public.can_view_policy(auth.uid(), contract_id))
    OR EXISTS (
      SELECT 1
      FROM public.consultas_credito AS consultation
      WHERE consultation.id = cakto_payments.consultation_id
        AND (
          consultation.profile_id_solicitante = auth.uid()
          OR consultation.tenant_user_id = auth.uid()
          OR consultation.tenant_email = (
            SELECT profile.email FROM public.profiles AS profile WHERE profile.id = auth.uid()
          )
          OR public.eh_staff_interno_consultas()
        )
    )
  );

REVOKE ALL ON public.cakto_payments FROM anon;

DROP POLICY IF EXISTS "App inserts documentos_contrato" ON public.documentos_contrato;
DROP POLICY IF EXISTS "App reads documentos_contrato" ON public.documentos_contrato;
DROP POLICY IF EXISTS "App updates documentos_contrato" ON public.documentos_contrato;
DROP POLICY IF EXISTS "App reads documentos proposta" ON public.documentos_proposta;

REVOKE ALL ON public.documentos_contrato FROM anon;
REVOKE ALL ON public.documentos_proposta FROM anon;

DROP POLICY IF EXISTS "App reads corretores" ON public.corretores;
REVOKE ALL ON public.corretores FROM anon;

DROP POLICY IF EXISTS "App inserts imoveis" ON public.imoveis;
DROP POLICY IF EXISTS "App reads imoveis" ON public.imoveis;

CREATE POLICY "Authenticated users create owned properties"
  ON public.imoveis FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Property participants read properties"
  ON public.imoveis FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.consultas_credito AS consultation
      WHERE consultation.imovel_id = imoveis.id
        AND (
          consultation.profile_id_solicitante = auth.uid()
          OR consultation.tenant_user_id = auth.uid()
          OR consultation.tenant_email = (
            SELECT profile.email FROM public.profiles AS profile WHERE profile.id = auth.uid()
          )
          OR public.eh_staff_interno_consultas()
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.apolices AS policy
      JOIN public.consultas_credito AS consultation
        ON consultation.id = policy.consulta_id
      WHERE consultation.imovel_id = imoveis.id
        AND public.can_view_policy(auth.uid(), policy.id)
    )
  );

CREATE POLICY "Property participants update properties"
  ON public.imoveis FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.consultas_credito AS consultation
      WHERE consultation.imovel_id = imoveis.id
        AND (
          consultation.profile_id_solicitante = auth.uid()
          OR public.eh_staff_interno_consultas()
        )
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.consultas_credito AS consultation
      WHERE consultation.imovel_id = imoveis.id
        AND (
          consultation.profile_id_solicitante = auth.uid()
          OR public.eh_staff_interno_consultas()
        )
    )
  );

REVOKE ALL ON public.imoveis FROM anon;

DROP POLICY IF EXISTS "App inserts inquilinos" ON public.inquilinos;
DROP POLICY IF EXISTS "App reads inquilinos" ON public.inquilinos;

CREATE POLICY "Authenticated users create owned tenants"
  ON public.inquilinos FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Tenant participants read tenants"
  ON public.inquilinos FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR profile_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.consultas_credito AS consultation
      WHERE consultation.inquilino_id = inquilinos.id
        AND (
          consultation.profile_id_solicitante = auth.uid()
          OR consultation.tenant_user_id = auth.uid()
          OR consultation.tenant_email = (
            SELECT profile.email FROM public.profiles AS profile WHERE profile.id = auth.uid()
          )
          OR public.eh_staff_interno_consultas()
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.apolices AS policy
      JOIN public.consultas_credito AS consultation
        ON consultation.id = policy.consulta_id
      WHERE consultation.inquilino_id = inquilinos.id
        AND public.can_view_policy(auth.uid(), policy.id)
    )
  );

CREATE POLICY "Tenant participants update tenants"
  ON public.inquilinos FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR profile_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.consultas_credito AS consultation
      WHERE consultation.inquilino_id = inquilinos.id
        AND (
          consultation.profile_id_solicitante = auth.uid()
          OR public.eh_staff_interno_consultas()
        )
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    OR profile_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.consultas_credito AS consultation
      WHERE consultation.inquilino_id = inquilinos.id
        AND (
          consultation.profile_id_solicitante = auth.uid()
          OR public.eh_staff_interno_consultas()
        )
    )
  );

REVOKE ALL ON public.inquilinos FROM anon;

-- These legacy public ingestion policies are not used by the current site or app.
-- Removing them closes unauthenticated bulk-write endpoints without changing a
-- visible flow.
DROP POLICY IF EXISTS "Anyone can insert leads" ON public.leads;
DROP POLICY IF EXISTS "Anyone can insert funnel events" ON public.eventos_funil;
REVOKE INSERT ON public.leads FROM anon;
REVOKE INSERT ON public.eventos_funil FROM anon;

-- Enforce the same resume constraints at Storage, not only in the browser.
UPDATE storage.buckets
SET file_size_limit = 10485760,
    allowed_mime_types = ARRAY['application/pdf']::text[]
WHERE id = 'curriculos';

DROP POLICY IF EXISTS "Anyone can upload resume" ON storage.objects;
CREATE POLICY "Public uploads constrained resumes"
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'curriculos'
    AND lower(storage.extension(name)) = 'pdf'
    AND length(name) BETWEEN 6 AND 240
  );
