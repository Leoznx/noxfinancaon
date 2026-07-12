-- Marketing Growth Center: listas semanais, leads de consulta e base para Ads.

CREATE TABLE IF NOT EXISTS public.marketing_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audience text NOT NULL CHECK (audience IN ('leads', 'inquilinos', 'corretores', 'imobiliarias', 'leads_consulta')),
  first_name text NOT NULL,
  full_name text,
  email text,
  phone text,
  document text,
  city text,
  rent_range text,
  rent_value numeric(15,2),
  source_table text,
  source_id uuid,
  source_status text,
  source_origin text,
  weekly_message_enabled boolean NOT NULL DEFAULT true,
  opted_in boolean NOT NULL DEFAULT true,
  closed_at timestamptz,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_contacts_source_uidx
  ON public.marketing_contacts(audience, source_table, source_id)
  WHERE source_table IS NOT NULL AND source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS marketing_contacts_audience_idx
  ON public.marketing_contacts(audience, created_at DESC);
CREATE INDEX IF NOT EXISTS marketing_contacts_email_idx
  ON public.marketing_contacts(email)
  WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS marketing_contacts_phone_idx
  ON public.marketing_contacts(phone)
  WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.marketing_ad_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('meta', 'google')),
  account_name text NOT NULL,
  account_id text NOT NULL,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'ativo', 'pausado', 'erro')),
  token_secret_name text,
  pixel_id text,
  conversion_action_id text,
  customer_id text,
  manager_customer_id text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at timestamptz,
  last_error text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, account_id)
);

CREATE TABLE IF NOT EXISTS public.marketing_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid REFERENCES public.marketing_ad_integrations(id) ON DELETE SET NULL,
  provider text NOT NULL CHECK (provider IN ('meta', 'google')),
  external_campaign_id text,
  name text NOT NULL,
  objective text NOT NULL DEFAULT 'lead_generation',
  audience text NOT NULL DEFAULT 'leads' CHECK (audience IN ('leads', 'inquilinos', 'corretores', 'imobiliarias', 'leads_consulta')),
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'ativo', 'pausado', 'encerrado')),
  budget_daily numeric(12,2),
  landing_page_url text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  starts_at date,
  ends_at date,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.marketing_campaign_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  metric_date date NOT NULL,
  impressions integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  leads integer NOT NULL DEFAULT 0,
  conversions integer NOT NULL DEFAULT 0,
  spend numeric(12,2) NOT NULL DEFAULT 0,
  revenue numeric(12,2) NOT NULL DEFAULT 0,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, metric_date)
);

CREATE TABLE IF NOT EXISTS public.marketing_conversion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES public.marketing_contacts(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES public.marketing_campaigns(id) ON DELETE SET NULL,
  provider text CHECK (provider IN ('meta', 'google')),
  event_name text NOT NULL,
  event_time timestamptz NOT NULL DEFAULT now(),
  value numeric(12,2),
  currency text NOT NULL DEFAULT 'BRL',
  source_table text,
  source_id uuid,
  external_event_id text,
  sync_status text NOT NULL DEFAULT 'pendente' CHECK (sync_status IN ('pendente', 'enviado', 'erro', 'ignorado')),
  last_error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_conversion_events_source_uidx
  ON public.marketing_conversion_events(event_name, source_table, source_id)
  WHERE source_table IS NOT NULL AND source_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_contacts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_ad_integrations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_campaigns TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_campaign_metrics TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_conversion_events TO authenticated;
GRANT ALL ON public.marketing_contacts TO service_role;
GRANT ALL ON public.marketing_ad_integrations TO service_role;
GRANT ALL ON public.marketing_campaigns TO service_role;
GRANT ALL ON public.marketing_campaign_metrics TO service_role;
GRANT ALL ON public.marketing_conversion_events TO service_role;

ALTER TABLE public.marketing_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_ad_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_campaign_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_conversion_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_manage_marketing(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_internal_role(_uid, 'admin_master')
    OR public.has_internal_role(_uid, 'marketing')
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = _uid
        AND p.role IN ('admin', 'analista', 'admin_master', 'marketing')
    );
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'marketing_contacts',
    'marketing_ad_integrations',
    'marketing_campaigns',
    'marketing_campaign_metrics',
    'marketing_conversion_events'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_manage', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.can_manage_marketing(auth.uid())) WITH CHECK (public.can_manage_marketing(auth.uid()))',
      table_name || '_manage',
      table_name
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.marketing_first_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(NULLIF(split_part(trim(COALESCE(p_name, '')), ' ', 1), ''), 'Contato');
$$;

CREATE OR REPLACE FUNCTION public.marketing_rent_range(p_value numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    WHEN p_value < 1500 THEN 'Ate R$ 1.500'
    WHEN p_value < 3000 THEN 'R$ 1.500 a R$ 3.000'
    WHEN p_value < 5000 THEN 'R$ 3.000 a R$ 5.000'
    WHEN p_value < 8000 THEN 'R$ 5.000 a R$ 8.000'
    ELSE 'Acima de R$ 8.000'
  END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_marketing_contact(
  p_audience text,
  p_full_name text,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_document text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_rent_value numeric DEFAULT NULL,
  p_source_table text DEFAULT NULL,
  p_source_id uuid DEFAULT NULL,
  p_source_status text DEFAULT NULL,
  p_source_origin text DEFAULT NULL,
  p_closed_at timestamptz DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.marketing_contacts (
    audience, first_name, full_name, email, phone, document, city, rent_range,
    rent_value, source_table, source_id, source_status, source_origin, closed_at,
    last_synced_at, metadata
  )
  VALUES (
    p_audience,
    public.marketing_first_name(p_full_name),
    NULLIF(trim(COALESCE(p_full_name, '')), ''),
    NULLIF(lower(trim(COALESCE(p_email, ''))), ''),
    NULLIF(trim(COALESCE(p_phone, '')), ''),
    NULLIF(trim(COALESCE(p_document, '')), ''),
    NULLIF(trim(COALESCE(p_city, '')), ''),
    public.marketing_rent_range(p_rent_value),
    p_rent_value,
    p_source_table,
    p_source_id,
    p_source_status,
    p_source_origin,
    p_closed_at,
    now(),
    COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (audience, source_table, source_id) WHERE source_table IS NOT NULL AND source_id IS NOT NULL
  DO UPDATE SET
    first_name = EXCLUDED.first_name,
    full_name = COALESCE(EXCLUDED.full_name, marketing_contacts.full_name),
    email = COALESCE(EXCLUDED.email, marketing_contacts.email),
    phone = COALESCE(EXCLUDED.phone, marketing_contacts.phone),
    document = COALESCE(EXCLUDED.document, marketing_contacts.document),
    city = COALESCE(EXCLUDED.city, marketing_contacts.city),
    rent_range = COALESCE(EXCLUDED.rent_range, marketing_contacts.rent_range),
    rent_value = COALESCE(EXCLUDED.rent_value, marketing_contacts.rent_value),
    source_status = EXCLUDED.source_status,
    source_origin = COALESCE(EXCLUDED.source_origin, marketing_contacts.source_origin),
    closed_at = COALESCE(EXCLUDED.closed_at, marketing_contacts.closed_at),
    last_synced_at = now(),
    metadata = marketing_contacts.metadata || EXCLUDED.metadata,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_marketing_from_sales_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_id uuid;
BEGIN
  IF NEW.status IN ('convertido', 'fechado', 'ganho', 'atendido') THEN
    v_contact_id := public.upsert_marketing_contact(
      'leads',
      NEW.full_name,
      NEW.email,
      NEW.phone,
      NULL,
      NEW.city,
      NULL,
      'sales_leads',
      NEW.id,
      NEW.status,
      NEW.origin,
      COALESCE(NEW.last_interaction_at, now()),
      jsonb_build_object('interest', NEW.interest, 'canal', NEW.canal, 'type', NEW.type)
    );

    INSERT INTO public.marketing_conversion_events (
      contact_id, event_name, event_time, source_table, source_id, payload
    )
    SELECT
      v_contact_id,
      'lead_fechado',
      COALESCE(NEW.last_interaction_at, now()),
      'sales_leads',
      NEW.id,
      jsonb_build_object('status', NEW.status, 'origin', NEW.origin, 'canal', NEW.canal)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.marketing_conversion_events e
      WHERE e.source_table = 'sales_leads'
        AND e.source_id = NEW.id
        AND e.event_name = 'lead_fechado'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_marketing_sales_lead ON public.sales_leads;
CREATE TRIGGER trg_sync_marketing_sales_lead
AFTER INSERT OR UPDATE OF status, full_name, email, phone, city, origin, interest, canal, notes ON public.sales_leads
FOR EACH ROW EXECUTE FUNCTION public.sync_marketing_from_sales_lead();

CREATE OR REPLACE FUNCTION public.sync_marketing_from_leads_contato()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_audience text;
BEGIN
  v_audience := CASE NEW.perfil
    WHEN 'inquilino' THEN 'inquilinos'
    WHEN 'corretor' THEN 'corretores'
    WHEN 'imobiliaria' THEN 'imobiliarias'
    ELSE 'leads'
  END;

  PERFORM public.upsert_marketing_contact(
    v_audience,
    NEW.nome,
    NEW.email,
    NEW.telefone,
    NULL,
    concat_ws('/', NULLIF(NEW.cidade, ''), NULLIF(NEW.uf, '')),
    NULL,
    'leads_contato',
    NEW.id,
    NEW.status,
    NEW.origem,
    CASE WHEN NEW.status = 'convertido' THEN COALESCE(NEW.convertido_em, now()) ELSE NULL END,
    jsonb_build_object('perfil', NEW.perfil, 'mensagem', NEW.mensagem, 'area_interesse', NEW.area_interesse)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_marketing_leads_contato ON public.leads_contato;
CREATE TRIGGER trg_sync_marketing_leads_contato
AFTER INSERT OR UPDATE OF nome, email, telefone, cidade, uf, perfil, status, origem, mensagem ON public.leads_contato
FOR EACH ROW EXECUTE FUNCTION public.sync_marketing_from_leads_contato();

CREATE OR REPLACE FUNCTION public.sync_marketing_from_consulta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inq record;
  v_imovel record;
  v_name text;
  v_document text;
  v_city text;
  v_rent numeric;
BEGIN
  SELECT i.nome, i.cpf
  INTO v_inq
  FROM public.inquilinos i
  WHERE i.id = NEW.inquilino_id;

  SELECT im.cidade, im.valor_aluguel
  INTO v_imovel
  FROM public.imoveis im
  WHERE im.id = NEW.imovel_id;

  v_name := COALESCE(NULLIF(NEW.tenant_name, ''), v_inq.nome);
  v_document := COALESCE(NULLIF(NEW.tenant_document, ''), NULLIF(NEW.documento, ''), v_inq.cpf);
  v_city := COALESCE(NULLIF(NEW.imovel_cidade, ''), NULLIF(NEW.property_address, ''), v_imovel.cidade);
  v_rent := COALESCE(NEW.rent_value, NEW.valor_aluguel, v_imovel.valor_aluguel);

  PERFORM public.upsert_marketing_contact(
    'leads_consulta',
    v_name,
    NEW.tenant_email,
    NEW.tenant_telefone,
    v_document,
    v_city,
    v_rent,
    'consultas_credito',
    NEW.id,
    NEW.status,
    NEW.origem,
    NULL,
    jsonb_build_object('tenant_type', NEW.tenant_type, 'role_solicitante', NEW.role_solicitante, 'score', NEW.score_interno)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_marketing_consulta ON public.consultas_credito;
CREATE TRIGGER trg_sync_marketing_consulta
AFTER INSERT OR UPDATE OF tenant_name, tenant_document, tenant_email, tenant_telefone, imovel_cidade, property_address, rent_value, valor_aluguel, status, origem ON public.consultas_credito
FOR EACH ROW EXECUTE FUNCTION public.sync_marketing_from_consulta();

CREATE OR REPLACE FUNCTION public.sync_marketing_from_consulta_row(p_consulta_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.consultas_credito%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.consultas_credito WHERE id = p_consulta_id;
  IF FOUND THEN
    PERFORM public.sync_marketing_from_consulta_direct(r);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_marketing_from_consulta_direct(p_row public.consultas_credito)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inq record;
  v_imovel record;
BEGIN
  SELECT i.nome, i.cpf INTO v_inq FROM public.inquilinos i WHERE i.id = p_row.inquilino_id;
  SELECT im.cidade, im.valor_aluguel INTO v_imovel FROM public.imoveis im WHERE im.id = p_row.imovel_id;

  PERFORM public.upsert_marketing_contact(
    'leads_consulta',
    COALESCE(NULLIF(p_row.tenant_name, ''), v_inq.nome),
    p_row.tenant_email,
    p_row.tenant_telefone,
    COALESCE(NULLIF(p_row.tenant_document, ''), NULLIF(p_row.documento, ''), v_inq.cpf),
    COALESCE(NULLIF(p_row.imovel_cidade, ''), NULLIF(p_row.property_address, ''), v_imovel.cidade),
    COALESCE(p_row.rent_value, p_row.valor_aluguel, v_imovel.valor_aluguel),
    'consultas_credito',
    p_row.id,
    p_row.status,
    p_row.origem,
    NULL,
    jsonb_build_object('tenant_type', p_row.tenant_type, 'role_solicitante', p_row.role_solicitante, 'score', p_row.score_interno)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_marketing_audiences()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM public.sales_leads WHERE status IN ('convertido', 'fechado', 'ganho', 'atendido') LOOP
    PERFORM public.upsert_marketing_contact(
      'leads', r.full_name, r.email, r.phone, NULL, r.city, NULL,
      'sales_leads', r.id, r.status, r.origin, COALESCE(r.last_interaction_at, r.updated_at),
      jsonb_build_object('interest', r.interest, 'canal', r.canal, 'type', r.type)
    );
  END LOOP;

  FOR r IN SELECT * FROM public.leads_contato LOOP
    PERFORM public.upsert_marketing_contact(
      CASE r.perfil WHEN 'inquilino' THEN 'inquilinos' WHEN 'corretor' THEN 'corretores' WHEN 'imobiliaria' THEN 'imobiliarias' ELSE 'leads' END,
      r.nome, r.email, r.telefone, NULL, concat_ws('/', NULLIF(r.cidade, ''), NULLIF(r.uf, '')), NULL,
      'leads_contato', r.id, r.status, r.origem,
      CASE WHEN r.status = 'convertido' THEN COALESCE(r.convertido_em, now()) ELSE NULL END,
      jsonb_build_object('perfil', r.perfil, 'mensagem', r.mensagem, 'area_interesse', r.area_interesse)
    );
  END LOOP;

  FOR r IN SELECT * FROM public.profiles WHERE role IN ('inquilino', 'corretor', 'imobiliaria') LOOP
    PERFORM public.upsert_marketing_contact(
      CASE r.role::text WHEN 'inquilino' THEN 'inquilinos' WHEN 'corretor' THEN 'corretores' ELSE 'imobiliarias' END,
      r.nome, r.email, r.telefone, NULL, NULL, NULL,
      'profiles', r.id, r.role::text, 'cadastro', NULL, '{}'::jsonb
    );
  END LOOP;

  FOR r IN SELECT * FROM public.imobiliarias LOOP
    PERFORM public.upsert_marketing_contact(
      'imobiliarias', COALESCE(r.contato_nome, r.nome_fantasia, r.razao_social), r.contato_email, r.contato_telefone,
      r.cnpj, COALESCE(r.cidade, r.estado), NULL,
      'imobiliarias', r.id, NULL, 'cadastro_imobiliaria', NULL,
      jsonb_build_object('razao_social', r.razao_social, 'creci', r.creci)
    );
  END LOOP;

  FOR r IN
    SELECT i.*, p.email AS profile_email, p.telefone AS profile_phone
    FROM public.inquilinos i
    LEFT JOIN public.profiles p ON p.id = i.profile_id
  LOOP
    PERFORM public.upsert_marketing_contact(
      'inquilinos', r.nome, r.profile_email, r.profile_phone, COALESCE(r.cpf, r.cnpj), NULL, NULL,
      'inquilinos', r.id, NULL, 'cadastro_inquilino', NULL,
      jsonb_build_object('tipo', r.tipo)
    );
  END LOOP;

  FOR r IN
    SELECT c.id, p.nome, p.email, p.telefone, c.susep, c.creci
    FROM public.corretores c
    JOIN public.profiles p ON p.id = c.profile_id
  LOOP
    PERFORM public.upsert_marketing_contact(
      'corretores', r.nome, r.email, r.telefone, NULL, NULL, NULL,
      'corretores', r.id, NULL, 'cadastro_corretor', NULL,
      jsonb_build_object('susep', r.susep, 'creci', r.creci)
    );
  END LOOP;

  FOR r IN SELECT id FROM public.consultas_credito LOOP
    PERFORM public.sync_marketing_from_consulta_row(r.id);
  END LOOP;
END;
$$;

SELECT public.refresh_marketing_audiences();

INSERT INTO public.marketing_ad_integrations (provider, account_name, account_id, status, token_secret_name, config)
VALUES
  ('meta', 'Meta Ads NOX', 'configure_account_id', 'rascunho', 'META_MARKETING_ACCESS_TOKEN', '{"api":"marketing-api","mode":"insights"}'::jsonb),
  ('google', 'Google Ads NOX', 'configure_customer_id', 'rascunho', 'GOOGLE_ADS_REFRESH_TOKEN', '{"api":"google-ads-api","mode":"gaql"}'::jsonb)
ON CONFLICT (provider, account_id) DO NOTHING;

INSERT INTO public.role_permissions (role, module, can_view, can_create, can_edit, can_delete, can_approve)
VALUES
  ('marketing', 'leads', true, true, true, true, false),
  ('marketing', 'marketing_ads', true, true, true, false, false)
ON CONFLICT (role, module) DO UPDATE
SET can_view = EXCLUDED.can_view,
    can_create = EXCLUDED.can_create,
    can_edit = EXCLUDED.can_edit,
    can_delete = EXCLUDED.can_delete,
    updated_at = now();

DROP TRIGGER IF EXISTS trg_marketing_contacts_upd ON public.marketing_contacts;
CREATE TRIGGER trg_marketing_contacts_upd
BEFORE UPDATE ON public.marketing_contacts
FOR EACH ROW EXECUTE FUNCTION public.sync_updated_at();

DROP TRIGGER IF EXISTS trg_marketing_ad_integrations_upd ON public.marketing_ad_integrations;
CREATE TRIGGER trg_marketing_ad_integrations_upd
BEFORE UPDATE ON public.marketing_ad_integrations
FOR EACH ROW EXECUTE FUNCTION public.sync_updated_at();

DROP TRIGGER IF EXISTS trg_marketing_campaigns_upd ON public.marketing_campaigns;
CREATE TRIGGER trg_marketing_campaigns_upd
BEFORE UPDATE ON public.marketing_campaigns
FOR EACH ROW EXECUTE FUNCTION public.sync_updated_at();

DROP TRIGGER IF EXISTS trg_marketing_campaign_metrics_upd ON public.marketing_campaign_metrics;
CREATE TRIGGER trg_marketing_campaign_metrics_upd
BEFORE UPDATE ON public.marketing_campaign_metrics
FOR EACH ROW EXECUTE FUNCTION public.sync_updated_at();
