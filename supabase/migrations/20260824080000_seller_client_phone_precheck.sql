-- Pre-atendimento de clientes por telefone no portal do vendedor.
--
-- A reserva e atomica: a unicidade do telefone normalizado impede que dois
-- vendedores iniciem o atendimento ao mesmo tempo. A tabela completa so pode
-- ser lida pelo proprio vendedor; os demais recebem apenas o nome do vendedor
-- responsavel quando consultam exatamente o mesmo numero pela RPC.

CREATE OR REPLACE FUNCTION public.normalize_br_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
BEGIN
  IF length(v_digits) IN (12, 13) AND left(v_digits, 2) = '55' THEN
    v_digits := substring(v_digits FROM 3);
  END IF;

  IF length(v_digits) NOT IN (10, 11) OR left(v_digits, 1) = '0' THEN
    RAISE EXCEPTION 'Informe um telefone brasileiro valido com DDD.';
  END IF;

  RETURN v_digits;
END;
$$;

CREATE TABLE IF NOT EXISTS public.seller_client_phone_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_normalized text NOT NULL UNIQUE,
  phone_display text NOT NULL,
  seller_id uuid NOT NULL REFERENCES public.internal_users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'em_atendimento'
    CHECK (status IN ('em_atendimento', 'cadastrado')),
  partnership_id uuid REFERENCES public.seller_client_partnerships(id) ON DELETE SET NULL,
  client_email text,
  partner_type text CHECK (partner_type IS NULL OR partner_type IN ('corretor', 'imobiliaria')),
  agency_name text,
  broker_name text,
  city text,
  first_contact_at timestamptz NOT NULL DEFAULT now(),
  last_contact_at timestamptz NOT NULL DEFAULT now(),
  registered_at timestamptz,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seller_client_phone_contacts_registered_check CHECK (
    status <> 'cadastrado' OR partnership_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS seller_client_phone_contacts_seller_history_idx
  ON public.seller_client_phone_contacts (seller_id, last_contact_at DESC);

ALTER TABLE public.seller_client_phone_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_client_phone_contacts REPLICA IDENTITY FULL;

REVOKE ALL ON public.seller_client_phone_contacts FROM anon, authenticated;
GRANT SELECT ON public.seller_client_phone_contacts TO authenticated;
GRANT ALL ON public.seller_client_phone_contacts TO service_role;

DROP POLICY IF EXISTS "Vendedor visualiza seus pre-atendimentos" ON public.seller_client_phone_contacts;
CREATE POLICY "Vendedor visualiza seus pre-atendimentos"
  ON public.seller_client_phone_contacts FOR SELECT TO authenticated
  USING (
    seller_id IN (
      SELECT internal_user.id
      FROM public.internal_users AS internal_user
      WHERE internal_user.auth_user_id = auth.uid()
        AND internal_user.role = 'vendedor'
        AND internal_user.status = 'ativo'
    )
  );

ALTER TABLE public.seller_client_partnerships
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS contact_phone_normalized text,
  ADD COLUMN IF NOT EXISTS declared_agency_name text,
  ADD COLUMN IF NOT EXISTS declared_broker_name text,
  ADD COLUMN IF NOT EXISTS declared_city text;

CREATE UNIQUE INDEX IF NOT EXISTS seller_client_partnerships_contact_phone_key
  ON public.seller_client_partnerships (contact_phone_normalized)
  WHERE contact_phone_normalized IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_my_seller_client_phone(p_phone text)
RETURNS TABLE (
  contact_id uuid,
  outcome text,
  phone_display text,
  seller_name text,
  first_contact_at timestamptz,
  last_contact_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_id uuid;
  v_seller_name text;
  v_digits text := public.normalize_br_phone(p_phone);
  v_display text;
  v_inserted_id uuid;
  v_contact public.seller_client_phone_contacts%ROWTYPE;
BEGIN
  SELECT internal_user.id, internal_user.full_name
  INTO v_seller_id, v_seller_name
  FROM public.internal_users AS internal_user
  WHERE internal_user.auth_user_id = auth.uid()
    AND internal_user.role = 'vendedor'
    AND internal_user.status = 'ativo'
  LIMIT 1;

  IF v_seller_id IS NULL THEN
    RAISE EXCEPTION 'Somente vendedores ativos podem iniciar atendimentos.';
  END IF;

  v_display := CASE
    WHEN length(v_digits) = 11
      THEN '(' || substring(v_digits FROM 1 FOR 2) || ') '
        || substring(v_digits FROM 3 FOR 5) || '-' || substring(v_digits FROM 8 FOR 4)
    ELSE '(' || substring(v_digits FROM 1 FOR 2) || ') '
      || substring(v_digits FROM 3 FOR 4) || '-' || substring(v_digits FROM 7 FOR 4)
  END;

  INSERT INTO public.seller_client_phone_contacts (
    phone_normalized,
    phone_display,
    seller_id,
    created_by
  ) VALUES (
    v_digits,
    v_display,
    v_seller_id,
    auth.uid()
  )
  ON CONFLICT (phone_normalized) DO NOTHING
  RETURNING id INTO v_inserted_id;

  SELECT contact.*
  INTO v_contact
  FROM public.seller_client_phone_contacts AS contact
  WHERE contact.phone_normalized = v_digits;

  IF v_contact.seller_id = v_seller_id AND v_inserted_id IS NULL THEN
    UPDATE public.seller_client_phone_contacts AS contact
    SET
      last_contact_at = now(),
      updated_at = now()
    WHERE contact.id = v_contact.id
    RETURNING contact.* INTO v_contact;
  END IF;

  RETURN QUERY
  SELECT
    v_contact.id,
    CASE
      WHEN v_contact.seller_id <> v_seller_id THEN 'in_use'
      WHEN v_inserted_id IS NOT NULL THEN 'available'
      ELSE 'owned_by_me'
    END,
    v_contact.phone_display,
    CASE
      WHEN v_contact.seller_id <> v_seller_id THEN owner.full_name
      ELSE v_seller_name
    END,
    v_contact.first_contact_at,
    v_contact.last_contact_at
  FROM public.internal_users AS owner
  WHERE owner.id = v_contact.seller_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_seller_client_phone_history()
RETURNS TABLE (
  contact_id uuid,
  phone_display text,
  status text,
  client_email text,
  partner_type text,
  agency_name text,
  broker_name text,
  city text,
  first_contact_at timestamptz,
  last_contact_at timestamptz,
  registered_at timestamptz,
  partnership_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH seller AS (
    SELECT internal_user.id
    FROM public.internal_users AS internal_user
    WHERE internal_user.auth_user_id = auth.uid()
      AND internal_user.role = 'vendedor'
      AND internal_user.status = 'ativo'
    LIMIT 1
  )
  SELECT
    contact.id,
    contact.phone_display,
    contact.status,
    contact.client_email,
    contact.partner_type,
    contact.agency_name,
    contact.broker_name,
    contact.city,
    contact.first_contact_at,
    contact.last_contact_at,
    contact.registered_at,
    contact.partnership_id
  FROM public.seller_client_phone_contacts AS contact
  JOIN seller ON seller.id = contact.seller_id
  ORDER BY contact.last_contact_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.register_my_seller_client_details(
  p_email text,
  p_phone text,
  p_partner_type text,
  p_agency_name text,
  p_broker_name text,
  p_city text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_id uuid;
  v_digits text := public.normalize_br_phone(p_phone);
  v_email text := lower(trim(coalesce(p_email, '')));
  v_partner_type text := lower(trim(coalesce(p_partner_type, '')));
  v_agency_name text := nullif(trim(coalesce(p_agency_name, '')), '');
  v_broker_name text := nullif(trim(coalesce(p_broker_name, '')), '');
  v_city text := nullif(trim(coalesce(p_city, '')), '');
  v_contact public.seller_client_phone_contacts%ROWTYPE;
  v_partnership_id uuid;
  v_actual_partner_type text;
  v_existing_phone text;
BEGIN
  SELECT internal_user.id
  INTO v_seller_id
  FROM public.internal_users AS internal_user
  WHERE internal_user.auth_user_id = auth.uid()
    AND internal_user.role = 'vendedor'
    AND internal_user.status = 'ativo'
  LIMIT 1;

  IF v_seller_id IS NULL THEN
    RAISE EXCEPTION 'Somente vendedores ativos podem cadastrar clientes.';
  END IF;

  IF v_email = '' OR position('@' IN v_email) <= 1 THEN
    RAISE EXCEPTION 'Informe um e-mail valido.';
  END IF;

  IF v_partner_type NOT IN ('corretor', 'imobiliaria') THEN
    RAISE EXCEPTION 'Selecione Corretor ou Imobiliaria.';
  END IF;

  IF v_broker_name IS NULL THEN
    RAISE EXCEPTION 'Informe o nome do corretor ou responsavel.';
  END IF;

  IF v_partner_type = 'imobiliaria' AND v_agency_name IS NULL THEN
    RAISE EXCEPTION 'Informe o nome da imobiliaria.';
  END IF;

  IF v_city IS NULL THEN
    RAISE EXCEPTION 'Informe a cidade do cliente.';
  END IF;

  SELECT contact.*
  INTO v_contact
  FROM public.seller_client_phone_contacts AS contact
  WHERE contact.phone_normalized = v_digits
  FOR UPDATE;

  IF v_contact.id IS NULL THEN
    RAISE EXCEPTION 'Confirme a disponibilidade do telefone antes de cadastrar o cliente.';
  END IF;

  IF v_contact.seller_id <> v_seller_id THEN
    RAISE EXCEPTION 'Este telefone ja esta em atendimento por outro vendedor.';
  END IF;

  v_partnership_id := public.register_my_seller_client(v_email);

  SELECT partnership.partner_type, partnership.contact_phone_normalized
  INTO v_actual_partner_type, v_existing_phone
  FROM public.seller_client_partnerships AS partnership
  WHERE partnership.id = v_partnership_id
    AND partnership.seller_id = v_seller_id;

  IF v_partnership_id IS NULL OR v_actual_partner_type IS NULL THEN
    RAISE EXCEPTION 'Nao foi possivel localizar o cliente vinculado.';
  END IF;

  IF (v_partner_type = 'corretor' AND v_actual_partner_type <> 'corretor_autonomo')
    OR (v_partner_type = 'imobiliaria' AND v_actual_partner_type <> 'imobiliaria') THEN
    RAISE EXCEPTION 'O tipo selecionado nao corresponde ao cadastro NOX deste e-mail.';
  END IF;

  IF v_existing_phone IS NOT NULL AND v_existing_phone <> v_digits THEN
    RAISE EXCEPTION 'Este cliente ja foi cadastrado com outro telefone.';
  END IF;

  UPDATE public.seller_client_partnerships AS partnership
  SET
    contact_phone = v_contact.phone_display,
    contact_phone_normalized = v_digits,
    declared_agency_name = v_agency_name,
    declared_broker_name = v_broker_name,
    declared_city = v_city
  WHERE partnership.id = v_partnership_id;

  UPDATE public.seller_client_phone_contacts AS contact
  SET
    status = 'cadastrado',
    partnership_id = v_partnership_id,
    client_email = v_email,
    partner_type = v_partner_type,
    agency_name = v_agency_name,
    broker_name = v_broker_name,
    city = v_city,
    registered_at = coalesce(contact.registered_at, now()),
    last_contact_at = now(),
    updated_at = now()
  WHERE contact.id = v_contact.id;

  RETURN v_partnership_id;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_br_phone(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_my_seller_client_phone(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_seller_client_phone_history() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.register_my_seller_client_details(text, text, text, text, text, text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.claim_my_seller_client_phone(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_seller_client_phone_history() TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_my_seller_client_details(text, text, text, text, text, text)
  TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'seller_client_phone_contacts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.seller_client_phone_contacts;
  END IF;
END;
$$;

COMMENT ON TABLE public.seller_client_phone_contacts IS
  'Reserva unica de telefone e historico de pre-atendimento dos vendedores.';
COMMENT ON FUNCTION public.claim_my_seller_client_phone(text) IS
  'Consulta e reserva atomicamente um telefone; em conflito retorna somente o vendedor responsavel.';
COMMENT ON FUNCTION public.register_my_seller_client_details(text, text, text, text, text, text) IS
  'Conclui o cadastro detalhado usando uma reserva de telefone pertencente ao vendedor autenticado.';
