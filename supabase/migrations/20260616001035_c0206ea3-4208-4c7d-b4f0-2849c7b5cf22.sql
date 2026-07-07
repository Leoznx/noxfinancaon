
-- =========================
-- JOB OPENINGS
-- =========================
CREATE TABLE public.job_openings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  area text NOT NULL,
  description text NOT NULL,
  requirements text,
  benefits text,
  contract_type text,
  work_model text NOT NULL CHECK (work_model IN ('presencial','hibrido','remoto')),
  city text,
  state text,
  status text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','pausada','encerrada')),
  published_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.job_openings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_openings TO authenticated;
GRANT ALL ON public.job_openings TO service_role;

ALTER TABLE public.job_openings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view open jobs"
  ON public.job_openings FOR SELECT
  USING (status = 'aberta');

CREATE POLICY "Admins can view all jobs"
  ON public.job_openings FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can manage jobs"
  ON public.job_openings FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE TRIGGER trg_job_openings_updated
  BEFORE UPDATE ON public.job_openings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_job_openings_status ON public.job_openings(status);

-- =========================
-- JOB APPLICATIONS
-- =========================
CREATE TABLE public.job_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.job_openings(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  city text,
  state text,
  area_interest text,
  linkedin_url text,
  message text,
  resume_file_path text NOT NULL,
  resume_file_name text NOT NULL,
  status text NOT NULL DEFAULT 'novo' CHECK (status IN ('novo','em_analise','selecionado','recusado','contratado','arquivado')),
  source text NOT NULL DEFAULT 'trabalhe_conosco' CHECK (source IN ('trabalhe_conosco','candidatura_espontanea','vaga_especifica')),
  internal_notes text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT INSERT ON public.job_applications TO anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.job_applications TO authenticated;
GRANT ALL ON public.job_applications TO service_role;

ALTER TABLE public.job_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit application"
  ON public.job_applications FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins can view applications"
  ON public.job_applications FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update applications"
  ON public.job_applications FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete applications"
  ON public.job_applications FOR DELETE
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE TRIGGER trg_job_applications_updated
  BEFORE UPDATE ON public.job_applications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_job_applications_job ON public.job_applications(job_id);
CREATE INDEX idx_job_applications_status ON public.job_applications(status);

-- =========================
-- AFFILIATE APPLICATIONS
-- =========================
CREATE TABLE public.affiliate_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  partner_type text NOT NULL CHECK (partner_type IN ('corretor','imobiliaria','proprietario','influenciador','consultor','outro')),
  city text,
  state text,
  works_with_rental boolean,
  message text,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','recusado','bloqueado')),
  referral_code text,
  referral_link text,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  rejected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rejected_at timestamptz,
  rejection_reason text,
  internal_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT INSERT ON public.affiliate_applications TO anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.affiliate_applications TO authenticated;
GRANT ALL ON public.affiliate_applications TO service_role;

ALTER TABLE public.affiliate_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit affiliate application"
  ON public.affiliate_applications FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can view their own affiliate application"
  ON public.affiliate_applications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

CREATE POLICY "Admins can update affiliate applications"
  ON public.affiliate_applications FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete affiliate applications"
  ON public.affiliate_applications FOR DELETE
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE TRIGGER trg_affiliate_applications_updated
  BEFORE UPDATE ON public.affiliate_applications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_affiliate_applications_status ON public.affiliate_applications(status);
CREATE INDEX idx_affiliate_applications_email ON public.affiliate_applications(email);

-- =========================
-- STORAGE POLICIES: curriculos bucket
-- =========================
CREATE POLICY "Anyone can upload resume"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'curriculos');

CREATE POLICY "Admins can read resumes"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'curriculos' AND public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete resumes"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'curriculos' AND public.is_admin(auth.uid()));
