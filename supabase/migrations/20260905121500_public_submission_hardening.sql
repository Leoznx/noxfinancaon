-- Public forms intentionally accept anonymous traffic. Keep that functionality,
-- but prevent mass assignment, oversized payloads and unbounded repeat submissions.

CREATE INDEX IF NOT EXISTS leads_contato_email_created_idx
  ON public.leads_contato (lower(trim(email)), created_at DESC);
CREATE INDEX IF NOT EXISTS affiliate_applications_email_created_idx
  ON public.affiliate_applications (lower(trim(email)), created_at DESC);
CREATE INDEX IF NOT EXISTS job_applications_email_created_idx
  ON public.job_applications (lower(trim(email)), created_at DESC);
CREATE INDEX IF NOT EXISTS sales_leads_created_at_idx
  ON public.sales_leads (created_at DESC);

CREATE OR REPLACE FUNCTION public.enforce_public_submission_safety()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_payload jsonb := to_jsonb(NEW);
  v_email text := lower(trim(coalesce(to_jsonb(NEW) ->> 'email', '')));
  v_name text := trim(coalesce(to_jsonb(NEW) ->> 'nome', to_jsonb(NEW) ->> 'full_name', ''));
  v_phone text := trim(coalesce(to_jsonb(NEW) ->> 'telefone', to_jsonb(NEW) ->> 'phone', ''));
  v_recent_count integer;
  v_global_count integer;
  v_is_internal boolean := false;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public'
     OR TG_TABLE_NAME NOT IN ('leads_contato', 'affiliate_applications', 'job_applications') THEN
    RAISE EXCEPTION 'Origem de formulário inválida.' USING ERRCODE = '22023';
  END IF;

  IF coalesce(auth.jwt() ->> 'role', '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    v_is_internal := coalesce(public.is_internal(auth.uid()), false);
  END IF;
  IF v_is_internal THEN
    RETURN NEW;
  END IF;

  IF char_length(v_name) NOT BETWEEN 2 AND 160
     OR char_length(v_email) NOT BETWEEN 5 AND 254
     OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
     OR char_length(v_phone) > 32
     OR (v_phone <> '' AND char_length(regexp_replace(v_phone, '[^0-9]', '', 'g')) NOT BETWEEN 8 AND 15)
     OR char_length(coalesce(v_payload ->> 'city', v_payload ->> 'cidade', '')) > 160
     OR char_length(coalesce(v_payload ->> 'state', v_payload ->> 'uf', '')) > 8
     OR char_length(coalesce(v_payload ->> 'message', v_payload ->> 'mensagem', '')) > 4000 THEN
    RAISE EXCEPTION 'Dados do formulário inválidos.' USING ERRCODE = '22023';
  END IF;

  EXECUTE format(
    'SELECT count(*) FROM %I.%I WHERE created_at >= clock_timestamp() - interval ''1 hour'' AND lower(trim(email)) = $1',
    TG_TABLE_SCHEMA,
    TG_TABLE_NAME
  ) INTO v_recent_count USING v_email;

  EXECUTE format(
    'SELECT count(*) FROM %I.%I WHERE created_at >= clock_timestamp() - interval ''1 hour''',
    TG_TABLE_SCHEMA,
    TG_TABLE_NAME
  ) INTO v_global_count;

  IF v_recent_count >= 5 OR v_global_count >= 120 THEN
    RAISE EXCEPTION 'Muitas tentativas. Tente novamente mais tarde.' USING ERRCODE = 'P0001';
  END IF;

  IF TG_TABLE_NAME = 'leads_contato' THEN
    IF (v_payload ->> 'status') IS DISTINCT FROM 'novo'
       OR v_payload ->> 'responsavel_id' IS NOT NULL
       OR v_payload ->> 'observacoes_internas' IS NOT NULL
       OR v_payload ->> 'contatado_em' IS NOT NULL
       OR v_payload ->> 'convertido_em' IS NOT NULL
       OR char_length(coalesce(v_payload ->> 'origem', '')) > 80
       OR coalesce(v_payload ->> 'origem', '') NOT IN (
         'landing_page', 'blog_newsletter', 'seja_parceiro', 'trabalhe_conosco'
       )
       OR char_length(coalesce(v_payload ->> 'referral_code', '')) > 128
       OR char_length(coalesce(v_payload ->> 'area_interesse', '')) > 160 THEN
      RAISE EXCEPTION 'Campos protegidos do formulário não podem ser alterados.' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'affiliate_applications' THEN
    IF (v_payload ->> 'status') IS DISTINCT FROM 'pendente'
       OR v_payload ->> 'approved_by' IS NOT NULL
       OR v_payload ->> 'approved_at' IS NOT NULL
       OR v_payload ->> 'rejected_by' IS NOT NULL
       OR v_payload ->> 'rejected_at' IS NOT NULL
       OR v_payload ->> 'rejection_reason' IS NOT NULL
       OR v_payload ->> 'internal_notes' IS NOT NULL
       OR v_payload ->> 'referral_code' IS NOT NULL
       OR v_payload ->> 'referral_link' IS NOT NULL
       OR (
         v_payload ->> 'user_id' IS NOT NULL
         AND (auth.uid() IS NULL OR v_payload ->> 'user_id' <> auth.uid()::text)
       ) THEN
      RAISE EXCEPTION 'Campos protegidos do formulário não podem ser alterados.' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF (v_payload ->> 'status') IS DISTINCT FROM 'novo'
       OR v_payload ->> 'internal_notes' IS NOT NULL
       OR v_payload ->> 'reviewed_by' IS NOT NULL
       OR v_payload ->> 'reviewed_at' IS NOT NULL
       OR char_length(coalesce(v_payload ->> 'area_interest', '')) > 160
       OR char_length(coalesce(v_payload ->> 'linkedin_url', '')) > 500
       OR (
         v_payload ->> 'linkedin_url' IS NOT NULL
         AND v_payload ->> 'linkedin_url' !~* '^https://'
       )
       OR char_length(coalesce(v_payload ->> 'resume_file_path', '')) > 240
       OR lower(coalesce(v_payload ->> 'resume_file_path', '')) !~
         '^[0-9]{4}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[a-z0-9._-]+[.]pdf$'
       OR char_length(coalesce(v_payload ->> 'resume_file_name', '')) NOT BETWEEN 5 AND 180
       OR lower(coalesce(v_payload ->> 'resume_file_name', '')) !~ '[.]pdf$'
       OR (
         v_payload ->> 'job_id' IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.job_openings AS opening
           WHERE opening.id = (v_payload ->> 'job_id')::uuid
             AND opening.status = 'aberta'
         )
       ) THEN
      RAISE EXCEPTION 'Campos protegidos do formulário não podem ser alterados.' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_public_submission_safety() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_public_submission_safety ON public.leads_contato;
CREATE TRIGGER enforce_public_submission_safety
  BEFORE INSERT ON public.leads_contato
  FOR EACH ROW EXECUTE FUNCTION public.enforce_public_submission_safety();

DROP TRIGGER IF EXISTS enforce_public_submission_safety ON public.affiliate_applications;
CREATE TRIGGER enforce_public_submission_safety
  BEFORE INSERT ON public.affiliate_applications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_public_submission_safety();

DROP TRIGGER IF EXISTS enforce_public_submission_safety ON public.job_applications;
CREATE TRIGGER enforce_public_submission_safety
  BEFORE INSERT ON public.job_applications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_public_submission_safety();

DROP POLICY IF EXISTS "Public can insert leads" ON public.leads_contato;
CREATE POLICY "Public submits sanitized leads"
  ON public.leads_contato FOR INSERT TO anon, authenticated
  WITH CHECK (
    status = 'novo'
    AND responsavel_id IS NULL
    AND observacoes_internas IS NULL
    AND contatado_em IS NULL
    AND convertido_em IS NULL
    AND origem IN ('landing_page', 'blog_newsletter', 'seja_parceiro', 'trabalhe_conosco')
  );

DROP POLICY IF EXISTS "Anyone can submit affiliate application" ON public.affiliate_applications;
CREATE POLICY "Public submits sanitized affiliate applications"
  ON public.affiliate_applications FOR INSERT TO anon, authenticated
  WITH CHECK (
    status = 'pendente'
    AND approved_by IS NULL
    AND approved_at IS NULL
    AND rejected_by IS NULL
    AND rejected_at IS NULL
    AND rejection_reason IS NULL
    AND internal_notes IS NULL
    AND referral_code IS NULL
    AND referral_link IS NULL
    AND (user_id IS NULL OR user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Anyone can submit application" ON public.job_applications;
CREATE POLICY "Public submits sanitized job applications"
  ON public.job_applications FOR INSERT TO anon, authenticated
  WITH CHECK (
    status = 'novo'
    AND internal_notes IS NULL
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
  );

DROP POLICY IF EXISTS "Public uploads constrained resumes" ON storage.objects;
CREATE POLICY "Public uploads constrained resumes"
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'curriculos'
    AND lower(storage.extension(name)) = 'pdf'
    AND length(name) BETWEEN 42 AND 240
    AND name ~ '^[0-9]{4}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[A-Za-z0-9._-]+[.]pdf$'
  );

CREATE OR REPLACE FUNCTION public.criar_lead_site_publico(
  p_full_name text,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_interest text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public.sales_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_name text := trim(coalesce(p_full_name, ''));
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_recent_count integer;
  v_global_count integer;
  v_result public.sales_leads;
BEGIN
  IF char_length(v_name) NOT BETWEEN 2 AND 160
     OR (v_email IS NULL AND v_phone IS NULL)
     OR (v_email IS NOT NULL AND (
       char_length(v_email) NOT BETWEEN 5 AND 254
       OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
     ))
     OR (v_phone IS NOT NULL AND (
       char_length(v_phone) > 32
       OR char_length(regexp_replace(v_phone, '[^0-9]', '', 'g')) NOT BETWEEN 8 AND 15
     ))
     OR char_length(coalesce(p_city, '')) > 180
     OR char_length(coalesce(p_interest, '')) > 160
     OR char_length(coalesce(p_notes, '')) > 4000 THEN
    RAISE EXCEPTION 'Dados do formulário inválidos.' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_recent_count
  FROM public.sales_leads AS lead
  WHERE lead.created_at >= clock_timestamp() - interval '1 hour'
    AND lead.origin = 'Formulario de contato do site'
    AND (
      (v_email IS NOT NULL AND lower(trim(lead.email)) = v_email)
      OR (
        v_phone IS NOT NULL
        AND regexp_replace(coalesce(lead.phone, ''), '[^0-9]', '', 'g') =
            regexp_replace(v_phone, '[^0-9]', '', 'g')
      )
    );

  SELECT count(*) INTO v_global_count
  FROM public.sales_leads AS lead
  WHERE lead.created_at >= clock_timestamp() - interval '1 hour'
    AND lead.origin = 'Formulario de contato do site';

  IF v_recent_count >= 5 OR v_global_count >= 120 THEN
    RAISE EXCEPTION 'Muitas tentativas. Tente novamente mais tarde.' USING ERRCODE = 'P0001';
  END IF;

  v_result := public._distribuir_sales_lead_core(
    v_name,
    v_phone,
    v_email,
    'Formulario de contato do site',
    nullif(trim(coalesce(p_city, '')), ''),
    'contato_site',
    nullif(trim(coalesce(p_interest, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    'organico',
    NULL
  );

  -- The public caller does not need to learn which employee received the lead.
  v_result.assigned_seller_id := NULL;
  v_result.next_action_at := NULL;
  v_result.notes := NULL;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.criar_lead_site_publico(text, text, text, text, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.criar_lead_site_publico(text, text, text, text, text, text)
  TO anon, authenticated;
