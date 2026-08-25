-- Separa a consulta de telefone do cadastro definitivo e limita a reserva
-- temporaria a uma hora. A validade sempre usa o relogio do banco.

ALTER TABLE public.seller_client_phone_contacts
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

UPDATE public.seller_client_phone_contacts
SET expires_at = last_contact_at + interval '1 hour'
WHERE status = 'em_atendimento'
  AND expires_at IS NULL;

UPDATE public.seller_client_phone_contacts
SET expires_at = NULL
WHERE status = 'cadastrado'
  AND expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS seller_client_phone_contacts_active_expiration_idx
  ON public.seller_client_phone_contacts (expires_at)
  WHERE status = 'em_atendimento';

DROP FUNCTION IF EXISTS public.claim_my_seller_client_phone(text);

CREATE FUNCTION public.claim_my_seller_client_phone(p_phone text)
RETURNS TABLE (
  contact_id uuid,
  outcome text,
  phone_display text,
  seller_name text,
  contact_status text,
  first_contact_at timestamptz,
  last_contact_at timestamptz,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_id uuid;
  v_seller_name text;
  v_owner_name text;
  v_digits text := public.normalize_br_phone(p_phone);
  v_display text;
  v_inserted_id uuid;
  v_now timestamptz := clock_timestamp();
  v_outcome text;
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
    expires_at,
    created_by
  ) VALUES (
    v_digits,
    v_display,
    v_seller_id,
    v_now + interval '1 hour',
    auth.uid()
  )
  ON CONFLICT (phone_normalized) DO NOTHING
  RETURNING id INTO v_inserted_id;

  SELECT contact.*
  INTO v_contact
  FROM public.seller_client_phone_contacts AS contact
  WHERE contact.phone_normalized = v_digits
  FOR UPDATE;

  IF v_inserted_id IS NOT NULL THEN
    v_outcome := 'available';
  ELSIF v_contact.status = 'em_atendimento'
    AND coalesce(v_contact.expires_at, v_contact.last_contact_at + interval '1 hour') <= v_now THEN
    UPDATE public.seller_client_phone_contacts AS contact
    SET
      phone_display = v_display,
      seller_id = v_seller_id,
      status = 'em_atendimento',
      partnership_id = NULL,
      client_email = NULL,
      partner_type = NULL,
      agency_name = NULL,
      broker_name = NULL,
      city = NULL,
      first_contact_at = v_now,
      last_contact_at = v_now,
      registered_at = NULL,
      expires_at = v_now + interval '1 hour',
      created_by = auth.uid(),
      updated_at = v_now
    WHERE contact.id = v_contact.id
    RETURNING contact.* INTO v_contact;
    v_outcome := 'available';
  ELSIF v_contact.seller_id = v_seller_id THEN
    IF v_contact.status = 'em_atendimento' THEN
      UPDATE public.seller_client_phone_contacts AS contact
      SET
        last_contact_at = v_now,
        expires_at = v_now + interval '1 hour',
        updated_at = v_now
      WHERE contact.id = v_contact.id
      RETURNING contact.* INTO v_contact;
    END IF;
    v_outcome := 'owned_by_me';
  ELSE
    v_outcome := 'in_use';
  END IF;

  SELECT owner.full_name
  INTO v_owner_name
  FROM public.internal_users AS owner
  WHERE owner.id = v_contact.seller_id;

  RETURN QUERY SELECT
    v_contact.id,
    v_outcome,
    v_contact.phone_display,
    CASE WHEN v_outcome = 'in_use' THEN v_owner_name ELSE v_seller_name END,
    v_contact.status,
    v_contact.first_contact_at,
    v_contact.last_contact_at,
    v_contact.expires_at;
END;
$$;

DROP FUNCTION IF EXISTS public.get_my_seller_client_phone_history();

CREATE FUNCTION public.get_my_seller_client_phone_history()
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
  partnership_id uuid,
  expires_at timestamptz
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
    contact.partnership_id,
    contact.expires_at
  FROM public.seller_client_phone_contacts AS contact
  JOIN seller ON seller.id = contact.seller_id
  WHERE contact.status = 'em_atendimento'
    AND coalesce(contact.expires_at, contact.last_contact_at + interval '1 hour') > clock_timestamp()
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
  v_owner_name text;
  v_digits text := public.normalize_br_phone(p_phone);
  v_display text;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_partner_type text := lower(trim(coalesce(p_partner_type, '')));
  v_agency_name text := nullif(trim(coalesce(p_agency_name, '')), '');
  v_broker_name text := nullif(trim(coalesce(p_broker_name, '')), '');
  v_city text := nullif(trim(coalesce(p_city, '')), '');
  v_now timestamptz := clock_timestamp();
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
    RAISE EXCEPTION 'Informe um e-mail válido.';
  END IF;
  IF v_partner_type NOT IN ('corretor', 'imobiliaria') THEN
    RAISE EXCEPTION 'Selecione Corretor ou Imobiliária.';
  END IF;
  IF v_broker_name IS NULL THEN
    RAISE EXCEPTION 'Informe o nome do corretor ou responsável.';
  END IF;
  IF v_partner_type = 'imobiliaria' AND v_agency_name IS NULL THEN
    RAISE EXCEPTION 'Informe o nome da imobiliária.';
  END IF;
  IF v_city IS NULL THEN
    RAISE EXCEPTION 'Informe a cidade do cliente.';
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
    expires_at,
    created_by
  ) VALUES (
    v_digits,
    v_display,
    v_seller_id,
    v_now + interval '1 hour',
    auth.uid()
  )
  ON CONFLICT (phone_normalized) DO NOTHING;

  SELECT contact.*
  INTO v_contact
  FROM public.seller_client_phone_contacts AS contact
  WHERE contact.phone_normalized = v_digits
  FOR UPDATE;

  IF v_contact.status = 'em_atendimento'
    AND coalesce(v_contact.expires_at, v_contact.last_contact_at + interval '1 hour') <= v_now THEN
    UPDATE public.seller_client_phone_contacts AS contact
    SET
      phone_display = v_display,
      seller_id = v_seller_id,
      status = 'em_atendimento',
      partnership_id = NULL,
      client_email = NULL,
      partner_type = NULL,
      agency_name = NULL,
      broker_name = NULL,
      city = NULL,
      first_contact_at = v_now,
      last_contact_at = v_now,
      registered_at = NULL,
      expires_at = v_now + interval '1 hour',
      created_by = auth.uid(),
      updated_at = v_now
    WHERE contact.id = v_contact.id
    RETURNING contact.* INTO v_contact;
  END IF;

  IF v_contact.seller_id <> v_seller_id THEN
    SELECT owner.full_name INTO v_owner_name
    FROM public.internal_users AS owner
    WHERE owner.id = v_contact.seller_id;
    RAISE EXCEPTION 'Esse número já está em atendimento através do vendedor %.', coalesce(v_owner_name, 'responsável');
  END IF;

  IF v_contact.status = 'cadastrado'
    AND lower(coalesce(v_contact.client_email, '')) <> v_email THEN
    RAISE EXCEPTION 'Esse telefone já está vinculado a outro cliente cadastrado.';
  END IF;

  v_partnership_id := public.register_my_seller_client(v_email);

  SELECT partnership.partner_type, partnership.contact_phone_normalized
  INTO v_actual_partner_type, v_existing_phone
  FROM public.seller_client_partnerships AS partnership
  WHERE partnership.id = v_partnership_id
    AND partnership.seller_id = v_seller_id;

  IF v_partnership_id IS NULL OR v_actual_partner_type IS NULL THEN
    RAISE EXCEPTION 'Não foi possível localizar o cliente vinculado.';
  END IF;
  IF (v_partner_type = 'corretor' AND v_actual_partner_type <> 'corretor_autonomo')
    OR (v_partner_type = 'imobiliaria' AND v_actual_partner_type <> 'imobiliaria') THEN
    RAISE EXCEPTION 'O tipo selecionado não corresponde ao cadastro NOX deste e-mail.';
  END IF;
  IF v_existing_phone IS NOT NULL AND v_existing_phone <> v_digits THEN
    RAISE EXCEPTION 'Este cliente já foi cadastrado com outro telefone.';
  END IF;

  UPDATE public.seller_client_partnerships AS partnership
  SET
    contact_phone = v_display,
    contact_phone_normalized = v_digits,
    declared_agency_name = v_agency_name,
    declared_broker_name = v_broker_name,
    declared_city = v_city
  WHERE partnership.id = v_partnership_id;

  UPDATE public.seller_client_phone_contacts AS contact
  SET
    phone_display = v_display,
    status = 'cadastrado',
    partnership_id = v_partnership_id,
    client_email = v_email,
    partner_type = v_partner_type,
    agency_name = v_agency_name,
    broker_name = v_broker_name,
    city = v_city,
    registered_at = coalesce(contact.registered_at, v_now),
    last_contact_at = v_now,
    expires_at = NULL,
    updated_at = v_now
  WHERE contact.id = v_contact.id;

  RETURN v_partnership_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_my_seller_client_phone(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_seller_client_phone_history() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.register_my_seller_client_details(text, text, text, text, text, text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.claim_my_seller_client_phone(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_seller_client_phone_history() TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_my_seller_client_details(text, text, text, text, text, text)
  TO authenticated;

COMMENT ON COLUMN public.seller_client_phone_contacts.expires_at IS
  'Fim da reserva temporaria; nulo apenas depois do cadastro definitivo.';
COMMENT ON FUNCTION public.claim_my_seller_client_phone(text) IS
  'Consulta e reserva atomicamente um telefone por uma hora, liberando reservas vencidas.';
COMMENT ON FUNCTION public.get_my_seller_client_phone_history() IS
  'Lista somente os pre-atendimentos ativos e ainda dentro da reserva de uma hora.';
COMMENT ON FUNCTION public.register_my_seller_client_details(text, text, text, text, text, text) IS
  'Cadastra o cliente independentemente da consulta e assume atomicamente um telefone livre ou vencido.';
