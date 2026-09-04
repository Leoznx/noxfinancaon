-- Fluxo comercial compartilhado entre SDR e Closer.
-- Mantemos profiles.role/internal_users.role = 'vendedor' para preservar todas
-- as politicas existentes e usamos seller_type para especializar a operacao.

ALTER TABLE public.internal_users
  ADD COLUMN IF NOT EXISTS seller_type text,
  ADD COLUMN IF NOT EXISTS exclude_from_commercial_metrics boolean NOT NULL DEFAULT false;

UPDATE public.internal_users
SET seller_type = 'sdr'
WHERE role = 'vendedor' AND seller_type IS NULL;

UPDATE public.internal_users
SET exclude_from_commercial_metrics = true
WHERE lower(email) = 'vendedornox@nox.com';

ALTER TABLE public.internal_users
  DROP CONSTRAINT IF EXISTS internal_users_seller_type_check;
ALTER TABLE public.internal_users
  ADD CONSTRAINT internal_users_seller_type_check
  CHECK (seller_type IS NULL OR seller_type IN ('sdr', 'closer'));

CREATE INDEX IF NOT EXISTS internal_users_active_seller_type_idx
  ON public.internal_users (seller_type, status)
  WHERE role = 'vendedor';

-- Um mesmo parceiro pode ter exatamente um SDR (prospeccao/qualificacao) e um
-- Closer (apresentacao/fechamento). Duplicidade continua bloqueada dentro da
-- mesma etapa comercial.
ALTER TABLE public.seller_client_partnerships
  ADD COLUMN IF NOT EXISTS seller_type text;

UPDATE public.seller_client_partnerships AS partnership
SET seller_type = coalesce(seller.seller_type, 'sdr')
FROM public.internal_users AS seller
WHERE seller.id = partnership.seller_id
  AND partnership.seller_type IS NULL;

ALTER TABLE public.seller_client_partnerships
  ALTER COLUMN seller_type SET DEFAULT 'sdr',
  ALTER COLUMN seller_type SET NOT NULL,
  DROP CONSTRAINT IF EXISTS seller_client_partnerships_seller_type_check;
ALTER TABLE public.seller_client_partnerships
  ADD CONSTRAINT seller_client_partnerships_seller_type_check
  CHECK (seller_type IN ('sdr', 'closer'));

DROP INDEX IF EXISTS public.seller_client_partnerships_imobiliaria_owner_key;
DROP INDEX IF EXISTS public.seller_client_partnerships_autonomous_owner_key;
CREATE UNIQUE INDEX IF NOT EXISTS seller_client_partnerships_imobiliaria_stage_key
  ON public.seller_client_partnerships (imobiliaria_id, seller_type)
  WHERE imobiliaria_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS seller_client_partnerships_autonomous_stage_key
  ON public.seller_client_partnerships (client_profile_id, seller_type)
  WHERE partner_type = 'corretor_autonomo';

-- A reserva de telefone tambem e independente por etapa: o SDR e o Closer
-- podem trabalhar o mesmo cliente, mas dois SDRs (ou dois Closers) nao.
ALTER TABLE public.seller_client_phone_contacts
  ADD COLUMN IF NOT EXISTS seller_type text;

UPDATE public.seller_client_phone_contacts AS contact
SET seller_type = coalesce(seller.seller_type, 'sdr')
FROM public.internal_users AS seller
WHERE seller.id = contact.seller_id
  AND contact.seller_type IS NULL;

ALTER TABLE public.seller_client_phone_contacts
  ALTER COLUMN seller_type SET DEFAULT 'sdr',
  ALTER COLUMN seller_type SET NOT NULL,
  DROP CONSTRAINT IF EXISTS seller_client_phone_contacts_seller_type_check,
  DROP CONSTRAINT IF EXISTS seller_client_phone_contacts_phone_normalized_key;
ALTER TABLE public.seller_client_phone_contacts
  ADD CONSTRAINT seller_client_phone_contacts_seller_type_check
  CHECK (seller_type IN ('sdr', 'closer'));

DROP INDEX IF EXISTS public.seller_client_phone_contacts_phone_normalized_key;
DROP INDEX IF EXISTS public.seller_client_partnerships_contact_phone_key;
CREATE UNIQUE INDEX IF NOT EXISTS seller_client_phone_contacts_phone_stage_key
  ON public.seller_client_phone_contacts (phone_normalized, seller_type);
CREATE UNIQUE INDEX IF NOT EXISTS seller_client_partnerships_contact_phone_stage_key
  ON public.seller_client_partnerships (contact_phone_normalized, seller_type)
  WHERE contact_phone_normalized IS NOT NULL;

CREATE OR REPLACE FUNCTION public.register_my_seller_client(p_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_id uuid;
  v_seller_type text;
  v_profile public.profiles%ROWTYPE;
  v_corretor public.corretores%ROWTYPE;
  v_imobiliaria public.imobiliarias%ROWTYPE;
  v_partner_type text;
  v_existing_id uuid;
  v_existing_name text;
  v_partnership_id uuid;
  v_email text := lower(trim(coalesce(p_email, '')));
BEGIN
  SELECT seller.id, coalesce(seller.seller_type, 'sdr')
  INTO v_seller_id, v_seller_type
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid()
    AND seller.role = 'vendedor'
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_seller_id IS NULL THEN
    RAISE EXCEPTION 'Somente vendedores ativos podem cadastrar clientes.';
  END IF;
  IF v_email = '' OR position('@' IN v_email) <= 1 THEN
    RAISE EXCEPTION 'Informe um e-mail valido.';
  END IF;

  SELECT profile.* INTO v_profile
  FROM public.profiles AS profile
  WHERE lower(profile.email) = v_email
    AND coalesce(profile.status, 'ativo') = 'ativo'
  LIMIT 1;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'Nenhum login ativo foi encontrado para este e-mail.';
  END IF;

  IF v_profile.role::text = 'corretor' THEN
    SELECT corretor.* INTO v_corretor
    FROM public.corretores AS corretor
    WHERE corretor.profile_id = v_profile.id
    LIMIT 1;
    IF v_corretor.id IS NULL THEN
      RAISE EXCEPTION 'O login informado ainda nao possui cadastro profissional de corretor.';
    END IF;
    IF v_corretor.imobiliaria_id IS NULL THEN
      v_partner_type := 'corretor_autonomo';
    ELSE
      v_partner_type := 'imobiliaria';
      SELECT imobiliaria.* INTO v_imobiliaria
      FROM public.imobiliarias AS imobiliaria
      WHERE imobiliaria.id = v_corretor.imobiliaria_id;
    END IF;
  ELSIF v_profile.role::text = 'imobiliaria' THEN
    v_partner_type := 'imobiliaria';
    SELECT imobiliaria.* INTO v_imobiliaria
    FROM public.imobiliarias AS imobiliaria
    WHERE lower(imobiliaria.contato_email) = v_email
    LIMIT 1;
    IF v_imobiliaria.id IS NULL THEN
      RAISE EXCEPTION 'O login informado ainda nao possui cadastro de imobiliaria.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Cadastre apenas logins de corretor ou imobiliaria.';
  END IF;

  SELECT partnership.id INTO v_existing_id
  FROM public.seller_client_partnerships AS partnership
  WHERE partnership.seller_id = v_seller_id
    AND (
      (v_partner_type = 'imobiliaria' AND partnership.imobiliaria_id = v_imobiliaria.id)
      OR (v_partner_type = 'corretor_autonomo' AND partnership.client_profile_id = v_profile.id)
    )
  LIMIT 1;
  IF v_existing_id IS NOT NULL THEN RETURN v_existing_id; END IF;

  SELECT owner.full_name INTO v_existing_name
  FROM public.seller_client_partnerships AS partnership
  JOIN public.internal_users AS owner ON owner.id = partnership.seller_id
  WHERE partnership.seller_type = v_seller_type
    AND (
      (v_partner_type = 'imobiliaria' AND partnership.imobiliaria_id = v_imobiliaria.id)
      OR (v_partner_type = 'corretor_autonomo' AND partnership.client_profile_id = v_profile.id)
    )
  LIMIT 1;

  IF v_existing_name IS NOT NULL THEN
    RAISE EXCEPTION 'Este cliente ja esta vinculado a outro %: %.', upper(v_seller_type), v_existing_name;
  END IF;

  INSERT INTO public.seller_client_partnerships (
    seller_id, seller_type, client_profile_id, imobiliaria_id,
    partner_type, registered_email, created_by
  ) VALUES (
    v_seller_id, v_seller_type, v_profile.id,
    CASE WHEN v_partner_type = 'imobiliaria' THEN v_imobiliaria.id ELSE NULL END,
    v_partner_type, v_email, auth.uid()
  )
  RETURNING id INTO v_partnership_id;

  RETURN v_partnership_id;
END;
$$;

DROP FUNCTION IF EXISTS public.claim_my_seller_client_phone(text);
CREATE FUNCTION public.claim_my_seller_client_phone(p_phone text)
RETURNS TABLE (
  contact_id uuid, outcome text, phone_display text, seller_name text,
  contact_status text, first_contact_at timestamptz, last_contact_at timestamptz,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_id uuid;
  v_seller_name text;
  v_seller_type text;
  v_owner_name text;
  v_digits text := public.normalize_br_phone(p_phone);
  v_display text;
  v_inserted_id uuid;
  v_now timestamptz := clock_timestamp();
  v_outcome text;
  v_contact public.seller_client_phone_contacts%ROWTYPE;
BEGIN
  SELECT seller.id, seller.full_name, coalesce(seller.seller_type, 'sdr')
  INTO v_seller_id, v_seller_name, v_seller_type
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid() AND seller.role = 'vendedor' AND seller.status = 'ativo'
  LIMIT 1;
  IF v_seller_id IS NULL THEN RAISE EXCEPTION 'Somente vendedores ativos podem iniciar atendimentos.'; END IF;

  v_display := CASE WHEN length(v_digits) = 11
    THEN '(' || substring(v_digits FROM 1 FOR 2) || ') ' || substring(v_digits FROM 3 FOR 5) || '-' || substring(v_digits FROM 8 FOR 4)
    ELSE '(' || substring(v_digits FROM 1 FOR 2) || ') ' || substring(v_digits FROM 3 FOR 4) || '-' || substring(v_digits FROM 7 FOR 4)
  END;

  INSERT INTO public.seller_client_phone_contacts (
    phone_normalized, phone_display, seller_id, seller_type, expires_at, created_by
  ) VALUES (v_digits, v_display, v_seller_id, v_seller_type, v_now + interval '3 hours', auth.uid())
  ON CONFLICT (phone_normalized, seller_type) DO NOTHING
  RETURNING id INTO v_inserted_id;

  SELECT contact.* INTO v_contact
  FROM public.seller_client_phone_contacts AS contact
  WHERE contact.phone_normalized = v_digits AND contact.seller_type = v_seller_type
  FOR UPDATE;

  IF v_inserted_id IS NOT NULL THEN
    v_outcome := 'available';
  ELSIF v_contact.status = 'em_atendimento'
    AND coalesce(v_contact.expires_at, v_contact.last_contact_at + interval '3 hours') <= v_now THEN
    UPDATE public.seller_client_phone_contacts AS contact
    SET phone_display = v_display, seller_id = v_seller_id, status = 'em_atendimento',
        partnership_id = NULL, client_email = NULL, partner_type = NULL,
        agency_name = NULL, broker_name = NULL, city = NULL,
        first_contact_at = v_now, last_contact_at = v_now, registered_at = NULL,
        expires_at = v_now + interval '3 hours', created_by = auth.uid(), updated_at = v_now
    WHERE contact.id = v_contact.id RETURNING contact.* INTO v_contact;
    v_outcome := 'available';
  ELSIF v_contact.seller_id = v_seller_id THEN
    IF v_contact.status = 'em_atendimento' THEN
      UPDATE public.seller_client_phone_contacts AS contact
      SET last_contact_at = v_now, expires_at = v_now + interval '3 hours', updated_at = v_now
      WHERE contact.id = v_contact.id RETURNING contact.* INTO v_contact;
    END IF;
    v_outcome := 'owned_by_me';
  ELSE
    v_outcome := 'in_use';
  END IF;

  SELECT owner.full_name INTO v_owner_name FROM public.internal_users AS owner WHERE owner.id = v_contact.seller_id;
  RETURN QUERY SELECT v_contact.id, v_outcome, v_contact.phone_display,
    CASE WHEN v_outcome = 'in_use' THEN v_owner_name ELSE v_seller_name END,
    v_contact.status, v_contact.first_contact_at, v_contact.last_contact_at, v_contact.expires_at;
END;
$$;

DROP FUNCTION IF EXISTS public.get_my_seller_client_phone_history();
CREATE FUNCTION public.get_my_seller_client_phone_history()
RETURNS TABLE (
  contact_id uuid, phone_display text, status text, client_email text,
  partner_type text, agency_name text, broker_name text, city text,
  first_contact_at timestamptz, last_contact_at timestamptz,
  registered_at timestamptz, partnership_id uuid, expires_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT contact.id, contact.phone_display, contact.status, contact.client_email,
    contact.partner_type, contact.agency_name, contact.broker_name, contact.city,
    contact.first_contact_at, contact.last_contact_at, contact.registered_at,
    contact.partnership_id, contact.expires_at
  FROM public.seller_client_phone_contacts AS contact
  JOIN public.internal_users AS seller ON seller.id = contact.seller_id
  WHERE seller.auth_user_id = auth.uid()
    AND contact.status = 'em_atendimento'
    AND coalesce(contact.expires_at, contact.last_contact_at + interval '3 hours') > clock_timestamp()
  ORDER BY contact.last_contact_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.register_my_seller_client_details(
  p_email text, p_phone text, p_partner_type text, p_agency_name text,
  p_broker_name text, p_city text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_id uuid;
  v_seller_type text;
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
  SELECT seller.id, coalesce(seller.seller_type, 'sdr')
  INTO v_seller_id, v_seller_type
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid() AND seller.role = 'vendedor' AND seller.status = 'ativo'
  LIMIT 1;
  IF v_seller_id IS NULL THEN RAISE EXCEPTION 'Somente vendedores ativos podem cadastrar clientes.'; END IF;
  IF v_email = '' OR position('@' IN v_email) <= 1 THEN RAISE EXCEPTION 'Informe um e-mail valido.'; END IF;
  IF v_partner_type NOT IN ('corretor', 'imobiliaria') THEN RAISE EXCEPTION 'Selecione Corretor ou Imobiliaria.'; END IF;
  IF v_broker_name IS NULL THEN RAISE EXCEPTION 'Informe o nome do corretor ou responsavel.'; END IF;
  IF v_partner_type = 'imobiliaria' AND v_agency_name IS NULL THEN RAISE EXCEPTION 'Informe o nome da imobiliaria.'; END IF;
  IF v_city IS NULL THEN RAISE EXCEPTION 'Informe a cidade do cliente.'; END IF;

  v_display := CASE WHEN length(v_digits) = 11
    THEN '(' || substring(v_digits FROM 1 FOR 2) || ') ' || substring(v_digits FROM 3 FOR 5) || '-' || substring(v_digits FROM 8 FOR 4)
    ELSE '(' || substring(v_digits FROM 1 FOR 2) || ') ' || substring(v_digits FROM 3 FOR 4) || '-' || substring(v_digits FROM 7 FOR 4)
  END;

  INSERT INTO public.seller_client_phone_contacts (
    phone_normalized, phone_display, seller_id, seller_type, expires_at, created_by
  ) VALUES (v_digits, v_display, v_seller_id, v_seller_type, v_now + interval '3 hours', auth.uid())
  ON CONFLICT (phone_normalized, seller_type) DO NOTHING;

  SELECT contact.* INTO v_contact
  FROM public.seller_client_phone_contacts AS contact
  WHERE contact.phone_normalized = v_digits AND contact.seller_type = v_seller_type
  FOR UPDATE;

  IF v_contact.status = 'em_atendimento'
    AND coalesce(v_contact.expires_at, v_contact.last_contact_at + interval '3 hours') <= v_now THEN
    UPDATE public.seller_client_phone_contacts AS contact
    SET phone_display = v_display, seller_id = v_seller_id, status = 'em_atendimento',
        partnership_id = NULL, client_email = NULL, partner_type = NULL,
        agency_name = NULL, broker_name = NULL, city = NULL,
        first_contact_at = v_now, last_contact_at = v_now, registered_at = NULL,
        expires_at = v_now + interval '3 hours', created_by = auth.uid(), updated_at = v_now
    WHERE contact.id = v_contact.id RETURNING contact.* INTO v_contact;
  END IF;

  IF v_contact.seller_id <> v_seller_id THEN
    SELECT owner.full_name INTO v_owner_name FROM public.internal_users AS owner WHERE owner.id = v_contact.seller_id;
    RAISE EXCEPTION 'Esse numero ja esta em atendimento por outro %: %.', upper(v_seller_type), coalesce(v_owner_name, 'responsavel');
  END IF;
  IF v_contact.status = 'cadastrado' AND lower(coalesce(v_contact.client_email, '')) <> v_email THEN
    RAISE EXCEPTION 'Esse telefone ja esta vinculado a outro cliente cadastrado nesta etapa.';
  END IF;

  v_partnership_id := public.register_my_seller_client(v_email);
  SELECT partnership.partner_type, partnership.contact_phone_normalized
  INTO v_actual_partner_type, v_existing_phone
  FROM public.seller_client_partnerships AS partnership
  WHERE partnership.id = v_partnership_id AND partnership.seller_id = v_seller_id;

  IF v_partnership_id IS NULL OR v_actual_partner_type IS NULL THEN RAISE EXCEPTION 'Nao foi possivel localizar o cliente vinculado.'; END IF;
  IF (v_partner_type = 'corretor' AND v_actual_partner_type <> 'corretor_autonomo')
    OR (v_partner_type = 'imobiliaria' AND v_actual_partner_type <> 'imobiliaria') THEN
    RAISE EXCEPTION 'O tipo selecionado nao corresponde ao cadastro NOX deste e-mail.';
  END IF;
  IF v_existing_phone IS NOT NULL AND v_existing_phone <> v_digits THEN
    RAISE EXCEPTION 'Este cliente ja foi cadastrado com outro telefone nesta etapa.';
  END IF;

  UPDATE public.seller_client_partnerships
  SET contact_phone = v_display, contact_phone_normalized = v_digits,
      declared_agency_name = v_agency_name, declared_broker_name = v_broker_name,
      declared_city = v_city
  WHERE id = v_partnership_id;

  UPDATE public.seller_client_phone_contacts
  SET phone_display = v_display, status = 'cadastrado', partnership_id = v_partnership_id,
      client_email = v_email, partner_type = v_partner_type, agency_name = v_agency_name,
      broker_name = v_broker_name, city = v_city, registered_at = coalesce(registered_at, v_now),
      last_contact_at = v_now, expires_at = NULL, updated_at = v_now
  WHERE id = v_contact.id;
  RETURN v_partnership_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_my_seller_client_phone(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_seller_client_phone_history() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.register_my_seller_client_details(text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_my_seller_client_phone(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_seller_client_phone_history() TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_my_seller_client_details(text, text, text, text, text, text) TO authenticated;

-- Agenda compartilhada: o compromisso pertence operacionalmente ao Closer e
-- continua visivel ao SDR que o originou.
ALTER TABLE public.seller_appointments
  ADD COLUMN IF NOT EXISTS sdr_id uuid REFERENCES public.internal_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_closer_id uuid REFERENCES public.internal_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS duration_minutes integer NOT NULL DEFAULT 45,
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text;

ALTER TABLE public.seller_appointments
  DROP CONSTRAINT IF EXISTS seller_appointments_duration_check;
ALTER TABLE public.seller_appointments
  ADD CONSTRAINT seller_appointments_duration_check CHECK (duration_minutes BETWEEN 15 AND 240);

ALTER TABLE public.seller_appointments DROP CONSTRAINT IF EXISTS seller_appointments_source_check;
ALTER TABLE public.seller_appointments ADD CONSTRAINT seller_appointments_source_check
  CHECK (source IN ('manual', 'admin', 'lead_follow_up', 'sdr_handoff'));

CREATE INDEX IF NOT EXISTS seller_appointments_sdr_scheduled_idx
  ON public.seller_appointments (sdr_id, scheduled_at);
CREATE INDEX IF NOT EXISTS seller_appointments_closer_scheduled_idx
  ON public.seller_appointments (assigned_closer_id, scheduled_at);

CREATE TABLE IF NOT EXISTS public.seller_meeting_reminder_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES public.seller_appointments(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  minutes_before integer NOT NULL CHECK (minutes_before IN (30, 5)),
  scheduled_at timestamptz NOT NULL,
  recipient_email text NOT NULL,
  recipient_name text NOT NULL,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'enviado', 'erro')),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (appointment_id, recipient_user_id, minutes_before, scheduled_at)
);
ALTER TABLE public.seller_meeting_reminder_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_meeting_reminder_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.seller_meeting_reminder_deliveries TO service_role;

DROP POLICY IF EXISTS "vendedor gerencia seus compromissos" ON public.seller_appointments;
CREATE POLICY "equipe comercial gerencia compromissos vinculados"
  ON public.seller_appointments FOR ALL TO authenticated
  USING (
    seller_id = public.internal_user_id(auth.uid())
    OR sdr_id = public.internal_user_id(auth.uid())
    OR assigned_closer_id = public.internal_user_id(auth.uid())
    OR public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master')
  )
  WITH CHECK (
    seller_id = public.internal_user_id(auth.uid())
    OR sdr_id = public.internal_user_id(auth.uid())
    OR assigned_closer_id = public.internal_user_id(auth.uid())
    OR public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master')
  );

CREATE OR REPLACE FUNCTION public.get_available_closer_slots(
  p_from_date date DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  p_days integer DEFAULT 14,
  p_duration_minutes integer DEFAULT 45
)
RETURNS TABLE (
  slot_start timestamptz, slot_end timestamptz, closer_id uuid,
  closer_name text, closer_email text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_type text;
BEGIN
  SELECT seller.seller_type INTO v_seller_type
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid() AND seller.role = 'vendedor' AND seller.status = 'ativo'
  LIMIT 1;
  IF coalesce(v_seller_type, '') NOT IN ('sdr', 'closer') AND NOT public.is_admin(auth.uid())
     AND NOT public.has_internal_role(auth.uid(), 'admin_master') THEN
    RAISE EXCEPTION 'Somente a equipe comercial pode consultar a agenda compartilhada.';
  END IF;

  RETURN QUERY
  WITH days AS (
    SELECT day::date AS work_day
    FROM generate_series(p_from_date, p_from_date + greatest(1, least(p_days, 31)) - 1, interval '1 day') day
    WHERE extract(isodow FROM day) BETWEEN 1 AND 5
  ), slots AS (
    SELECT (
      work_day::timestamp + make_interval(hours => hour_value, mins => minute_value)
    ) AT TIME ZONE 'America/Sao_Paulo' AS starts_at
    FROM days
    CROSS JOIN generate_series(9, 17) hour_value
    CROSS JOIN (VALUES (0), (30)) minute(minute_value)
    WHERE hour_value <> 12
  ), candidates AS (
    SELECT slot.starts_at, closer.id, closer.full_name, closer.email
    FROM slots AS slot
    CROSS JOIN public.internal_users AS closer
    WHERE closer.role = 'vendedor' AND closer.seller_type = 'closer'
      AND closer.status = 'ativo' AND NOT closer.exclude_from_commercial_metrics
      AND slot.starts_at > now() + interval '30 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM public.seller_appointments AS busy
        WHERE coalesce(busy.assigned_closer_id, busy.seller_id) = closer.id
          AND busy.status NOT IN ('cancelado', 'concluido', 'nao_compareceu')
          AND tstzrange(busy.scheduled_at, busy.scheduled_at + make_interval(mins => busy.duration_minutes), '[)')
              && tstzrange(slot.starts_at, slot.starts_at + make_interval(mins => p_duration_minutes), '[)')
      )
  ), balanced AS (
    SELECT candidates.*,
      row_number() OVER (
        PARTITION BY candidates.starts_at
        ORDER BY (
          SELECT count(*) FROM public.seller_appointments day_meeting
          WHERE coalesce(day_meeting.assigned_closer_id, day_meeting.seller_id) = candidates.id
            AND (day_meeting.scheduled_at AT TIME ZONE 'America/Sao_Paulo')::date =
                (candidates.starts_at AT TIME ZONE 'America/Sao_Paulo')::date
            AND day_meeting.status NOT IN ('cancelado', 'nao_compareceu')
        ), candidates.full_name
      ) AS choice
    FROM candidates
  )
  SELECT balanced.starts_at,
    balanced.starts_at + make_interval(mins => p_duration_minutes),
    balanced.id, balanced.full_name, balanced.email
  FROM balanced WHERE balanced.choice = 1
  ORDER BY balanced.starts_at
  LIMIT 120;
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_sdr_closer_meeting(
  p_slot_start timestamptz,
  p_title text,
  p_contact_name text,
  p_contact_email text DEFAULT NULL,
  p_contact_phone text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_duration_minutes integer DEFAULT 45
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_sdr_id uuid;
  v_closer_id uuid;
  v_id uuid;
BEGIN
  SELECT seller.id INTO v_sdr_id FROM public.internal_users seller
  WHERE seller.auth_user_id = auth.uid() AND seller.role = 'vendedor'
    AND seller.seller_type = 'sdr' AND seller.status = 'ativo' LIMIT 1;
  IF v_sdr_id IS NULL THEN RAISE EXCEPTION 'Somente SDRs ativos podem distribuir reunioes.'; END IF;
  IF nullif(trim(p_title), '') IS NULL OR nullif(trim(p_contact_name), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o titulo e o contato da reuniao.';
  END IF;
  IF p_slot_start <= now() + interval '30 minutes' THEN RAISE EXCEPTION 'Escolha um horario com pelo menos 30 minutos de antecedencia.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_slot_start::text, 0));

  SELECT available.closer_id INTO v_closer_id
  FROM public.get_available_closer_slots(
    (p_slot_start AT TIME ZONE 'America/Sao_Paulo')::date, 1, p_duration_minutes
  ) AS available
  WHERE available.slot_start = p_slot_start
  LIMIT 1;
  IF v_closer_id IS NULL THEN RAISE EXCEPTION 'Este horario acabou de ser ocupado. Escolha outro horario disponivel.'; END IF;

  INSERT INTO public.seller_appointments (
    seller_id, sdr_id, assigned_closer_id, title, type, status, priority,
    scheduled_at, reminder_minutes, notes, source, duration_minutes,
    contact_name, contact_email, contact_phone
  ) VALUES (
    v_closer_id, v_sdr_id, v_closer_id, trim(p_title), 'reuniao', 'agendado', 'alta',
    p_slot_start, 5, nullif(trim(coalesce(p_notes, '')), ''), 'sdr_handoff',
    p_duration_minutes, trim(p_contact_name), nullif(lower(trim(coalesce(p_contact_email, ''))), ''),
    nullif(trim(coalesce(p_contact_phone, '')), '')
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reschedule_shared_sales_meeting(
  p_appointment_id uuid, p_slot_start timestamptz
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_meeting public.seller_appointments%ROWTYPE;
  v_actor uuid := public.internal_user_id(auth.uid());
  v_closer_id uuid;
BEGIN
  SELECT * INTO v_meeting FROM public.seller_appointments WHERE id = p_appointment_id FOR UPDATE;
  IF v_meeting.id IS NULL OR v_meeting.source <> 'sdr_handoff' THEN RAISE EXCEPTION 'Reuniao compartilhada nao encontrada.'; END IF;
  IF v_actor NOT IN (v_meeting.sdr_id, v_meeting.assigned_closer_id) AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Voce nao pode remarcar esta reuniao.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_slot_start::text, 0));
  SELECT available.closer_id INTO v_closer_id
  FROM public.get_available_closer_slots((p_slot_start AT TIME ZONE 'America/Sao_Paulo')::date, 1, v_meeting.duration_minutes) available
  WHERE available.slot_start = p_slot_start LIMIT 1;
  IF v_closer_id IS NULL THEN RAISE EXCEPTION 'Horario indisponivel.'; END IF;
  UPDATE public.seller_appointments
  SET seller_id = v_closer_id, assigned_closer_id = v_closer_id,
      scheduled_at = p_slot_start, status = 'remarcado', updated_at = now()
  WHERE id = p_appointment_id;
  DELETE FROM public.seller_meeting_reminder_deliveries WHERE appointment_id = p_appointment_id;
  RETURN v_closer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_available_closer_slots(date, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.schedule_sdr_closer_meeting(timestamptz, text, text, text, text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reschedule_shared_sales_meeting(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_available_closer_slots(date, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_sdr_closer_meeting(timestamptz, text, text, text, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_shared_sales_meeting(uuid, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.process_due_sdr_closer_panel_reminders()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_row record; v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT appointment.id, appointment.title, appointment.scheduled_at,
      closer.auth_user_id, coalesce(appointment.contact_name, 'cliente') AS contact_name
    FROM public.seller_appointments appointment
    JOIN public.internal_users closer ON closer.id = appointment.assigned_closer_id
    WHERE appointment.source = 'sdr_handoff'
      AND appointment.status IN ('agendado', 'confirmado', 'remarcado')
      AND appointment.scheduled_at > now()
      AND appointment.scheduled_at <= now() + interval '5 minutes'
      AND closer.status = 'ativo'
  LOOP
    IF public.enqueue_important_notification(
      'closer-meeting-5:' || v_row.id || ':' || extract(epoch FROM v_row.scheduled_at)::bigint,
      v_row.auth_user_id,
      'Reuniao em 5 minutos',
      v_row.title || ' com ' || v_row.contact_name || ' comeca as ' ||
        to_char(v_row.scheduled_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') || '.',
      'reuniao_closer', 'amarelo', '/vendedor/agenda'
    ) THEN v_count := v_count + 1; END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.process_due_sdr_closer_panel_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_due_sdr_closer_panel_reminders() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('nox-sdr-closer-panel-reminders')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nox-sdr-closer-panel-reminders');
    PERFORM cron.schedule('nox-sdr-closer-panel-reminders', '* * * * *',
      'SELECT public.process_due_sdr_closer_panel_reminders();');
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
     AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'cron_notifications_secret') THEN
    PERFORM cron.unschedule('nox-sdr-closer-email-reminders')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nox-sdr-closer-email-reminders');
    PERFORM cron.schedule(
      'nox-sdr-closer-email-reminders',
      '* * * * *',
      $cron$
      SELECT net.http_post(
        url := 'https://njheoytyidsghittjilr.supabase.co/functions/v1/process-sales-meeting-reminders',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_notifications_secret')
        ),
        body := '{}'::jsonb
      );
      $cron$
    );
  ELSE
    RAISE NOTICE 'Cron de e-mail SDR/Closer nao agendado: pg_cron, pg_net ou cron_notifications_secret indisponivel.';
  END IF;
END $$;

-- Indicacao individual do SDR: primeiro ele cadastra nome/telefone, depois o
-- sistema libera um token particular. Cada contrato gera R$ 50,00 somente
-- quando a segunda parcela desse contrato for paga.
CREATE TABLE IF NOT EXISTS public.seller_referral_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sdr_id uuid NOT NULL REFERENCES public.internal_users(id) ON DELETE CASCADE,
  invitee_name text NOT NULL,
  invitee_phone text NOT NULL,
  phone_normalized text NOT NULL,
  token text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  referred_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'aguardando_cadastro'
    CHECK (status IN ('aguardando_cadastro', 'cadastrado', 'cancelado')),
  registered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sdr_id, phone_normalized)
);

CREATE TABLE IF NOT EXISTS public.seller_referral_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id uuid NOT NULL REFERENCES public.seller_referral_invites(id) ON DELETE CASCADE,
  sdr_id uuid NOT NULL REFERENCES public.internal_users(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES public.apolices(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL DEFAULT 50 CHECK (amount = 50),
  status text NOT NULL DEFAULT 'disponivel'
    CHECK (status IN ('disponivel', 'paga', 'cancelada')),
  second_installment_paid_at timestamptz NOT NULL,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invite_id, policy_id)
);

ALTER TABLE public.seller_referral_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_referral_rewards ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.seller_referral_invites, public.seller_referral_rewards TO authenticated;
GRANT ALL ON public.seller_referral_invites, public.seller_referral_rewards TO service_role;

DROP POLICY IF EXISTS "SDR visualiza suas indicacoes" ON public.seller_referral_invites;
CREATE POLICY "SDR visualiza suas indicacoes" ON public.seller_referral_invites FOR SELECT TO authenticated
USING (sdr_id = public.internal_user_id(auth.uid()) OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "SDR visualiza recompensas de indicacao" ON public.seller_referral_rewards;
CREATE POLICY "SDR visualiza recompensas de indicacao" ON public.seller_referral_rewards FOR SELECT TO authenticated
USING (sdr_id = public.internal_user_id(auth.uid()) OR public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.create_my_sdr_referral_invite(p_name text, p_phone text)
RETURNS TABLE (invite_id uuid, invite_token text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_sdr uuid; v_digits text := public.normalize_br_phone(p_phone); v_row public.seller_referral_invites%ROWTYPE;
BEGIN
  SELECT id INTO v_sdr FROM public.internal_users
  WHERE auth_user_id = auth.uid() AND role = 'vendedor' AND seller_type = 'sdr' AND status = 'ativo' LIMIT 1;
  IF v_sdr IS NULL THEN RAISE EXCEPTION 'Somente SDRs ativos podem gerar links de indicacao.'; END IF;
  IF length(trim(coalesce(p_name, ''))) < 3 THEN RAISE EXCEPTION 'Informe o nome completo do indicado.'; END IF;
  INSERT INTO public.seller_referral_invites (sdr_id, invitee_name, invitee_phone, phone_normalized)
  VALUES (v_sdr, trim(p_name), trim(p_phone), v_digits)
  ON CONFLICT (sdr_id, phone_normalized) DO UPDATE
    SET invitee_name = excluded.invitee_name, invitee_phone = excluded.invitee_phone, updated_at = now()
  RETURNING * INTO v_row;
  RETURN QUERY SELECT v_row.id, v_row.token;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_sdr_referral_invite(
  p_token text, p_profile_id uuid, p_email text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_profile_email text;
BEGIN
  SELECT lower(email) INTO v_profile_email FROM public.profiles WHERE id = p_profile_id;
  IF v_profile_email IS NULL OR v_profile_email <> lower(trim(p_email)) THEN RETURN false; END IF;
  UPDATE public.seller_referral_invites
  SET referred_profile_id = p_profile_id, status = 'cadastrado',
      registered_at = coalesce(registered_at, now()), updated_at = now()
  WHERE token = p_token AND status <> 'cancelado'
    AND (referred_profile_id IS NULL OR referred_profile_id = p_profile_id);
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_seller_referral_reward_for_policy(p_policy_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_paid_at timestamptz; v_count integer := 0;
BEGIN
  SELECT min(paid_at) INTO v_paid_at FROM (
    SELECT coalesce(invoice.pago_em, invoice.updated_at, invoice.created_at) AS paid_at
    FROM public.faturas_inquilino invoice
    WHERE invoice.apolice_id = p_policy_id AND invoice.numero_parcela = 2
      AND lower(coalesce(invoice.status, '')) IN ('paid','pago','confirmed','received','paid_via_consolidated')
    UNION ALL
    SELECT coalesce(monthly.data_pagamento, monthly.updated_at, monthly.created_at)
    FROM public.mensalidades monthly
    WHERE monthly.apolice_id = p_policy_id AND monthly.numero_parcela = 2
      AND lower(coalesce(monthly.status, '')) IN ('paid','pago','confirmed','received')
  ) paid;
  IF v_paid_at IS NULL THEN RETURN 0; END IF;

  INSERT INTO public.seller_referral_rewards (invite_id, sdr_id, policy_id, second_installment_paid_at)
  SELECT invite.id, invite.sdr_id, policy.id, v_paid_at
  FROM public.apolices policy
  LEFT JOIN public.consultas_credito consultation ON consultation.id = policy.consulta_id
  JOIN public.seller_referral_invites invite
    ON invite.status = 'cadastrado'
   AND invite.referred_profile_id IN (
     policy.corretor_profile_id, policy.imobiliaria_profile_id,
     policy.proprietario_profile_id, consultation.profile_id_solicitante
   )
  WHERE policy.id = p_policy_id
  ON CONFLICT (invite_id, policy_id) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_refresh_seller_referral_reward()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF coalesce(NEW.numero_parcela, 1) = 2 THEN
    PERFORM public.refresh_seller_referral_reward_for_policy(NEW.apolice_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seller_referral_reward_invoice ON public.faturas_inquilino;
CREATE TRIGGER trg_seller_referral_reward_invoice
AFTER INSERT OR UPDATE OF status ON public.faturas_inquilino
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_seller_referral_reward();
DROP TRIGGER IF EXISTS trg_seller_referral_reward_monthly ON public.mensalidades;
CREATE TRIGGER trg_seller_referral_reward_monthly
AFTER INSERT OR UPDATE OF status ON public.mensalidades
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_seller_referral_reward();

REVOKE ALL ON FUNCTION public.create_my_sdr_referral_invite(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_sdr_referral_invite(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_seller_referral_reward_for_policy(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_my_sdr_referral_invite(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sdr_referral_invite(text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_seller_referral_reward_for_policy(uuid) TO service_role;

-- Sem bonificacao por producao: comissoes contratuais continuam existindo,
-- mas bonus automaticos sao sempre zerados.
CREATE OR REPLACE FUNCTION public.calcular_bonus_vendedor(contratos integer)
RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT 0::numeric; $$;

CREATE OR REPLACE FUNCTION public.enforce_no_seller_production_bonus()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN NEW.bonus_amount := 0; RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_no_seller_production_bonus ON public.seller_commissions;
CREATE TRIGGER trg_no_seller_production_bonus
BEFORE INSERT OR UPDATE OF bonus_amount ON public.seller_commissions
FOR EACH ROW EXECUTE FUNCTION public.enforce_no_seller_production_bonus();
UPDATE public.seller_commissions SET bonus_amount = 0 WHERE bonus_amount <> 0;
UPDATE public.seller_performance SET bonus_total = 0,
  total_estimated_gain = coalesce(commission_total, 0)
WHERE bonus_total <> 0;

-- Se o mesmo contrato pertence a um SDR e a um Closer, ambos recebem o mesmo
-- valor contratual. A menor faixa positiva do par e usada para nunca inflar a
-- despesa e os totais mensais sao reconciliados imediatamente.
CREATE OR REPLACE FUNCTION public.equalize_sdr_closer_commission_pair()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_equal numeric;
BEGIN
  IF NEW.contract_id IS NULL OR pg_trigger_depth() > 1 THEN RETURN NEW; END IF;

  SELECT min(nullif(commission.commission_amount, 0)) INTO v_equal
  FROM public.seller_commissions commission
  JOIN public.internal_users seller ON seller.id = commission.seller_id
  WHERE commission.contract_id = NEW.contract_id
    AND commission.month = NEW.month AND commission.year = NEW.year
    AND seller.seller_type IN ('sdr', 'closer')
    AND commission.status NOT IN ('estornada', 'cancelada')
  HAVING count(DISTINCT seller.seller_type) = 2
     AND count(*) FILTER (WHERE commission.commission_amount > 0) >= 2;

  IF v_equal IS NULL THEN RETURN NEW; END IF;

  UPDATE public.seller_commissions commission
  SET commission_amount = v_equal,
      reserve_amount = CASE
        WHEN commission.status IN ('elegivel', 'retida', 'liberada_parcial') THEN v_equal * 0.15
        ELSE commission.reserve_amount END,
      released_amount = CASE
        WHEN commission.status IN ('elegivel', 'retida', 'liberada_parcial') THEN v_equal * 0.85
        WHEN commission.status IN ('liberada_total', 'paga', 'pago') THEN v_equal
        ELSE commission.released_amount END,
      updated_at = now()
  FROM public.internal_users seller
  WHERE seller.id = commission.seller_id
    AND seller.seller_type IN ('sdr', 'closer')
    AND commission.contract_id = NEW.contract_id
    AND commission.month = NEW.month AND commission.year = NEW.year
    AND commission.status NOT IN ('estornada', 'cancelada')
    AND commission.commission_amount IS DISTINCT FROM v_equal;

  UPDATE public.seller_performance performance
  SET commission_total = totals.total,
      total_estimated_gain = totals.total,
      bonus_total = 0,
      updated_at = now()
  FROM (
    SELECT commission.seller_id, coalesce(sum(commission.commission_amount), 0) AS total
    FROM public.seller_commissions commission
    WHERE commission.month = NEW.month AND commission.year = NEW.year
      AND commission.status NOT IN ('estornada', 'cancelada')
      AND commission.seller_id IN (
        SELECT paired.seller_id FROM public.seller_commissions paired
        WHERE paired.contract_id = NEW.contract_id
      )
    GROUP BY commission.seller_id
  ) totals
  WHERE performance.seller_id = totals.seller_id
    AND performance.month = NEW.month AND performance.year = NEW.year;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_equalize_sdr_closer_commission_pair ON public.seller_commissions;
CREATE TRIGGER trg_equalize_sdr_closer_commission_pair
AFTER INSERT OR UPDATE OF commission_amount ON public.seller_commissions
FOR EACH ROW EXECUTE FUNCTION public.equalize_sdr_closer_commission_pair();

-- Ranking mensal por cadastros, isolado por tipo de login e sem contas teste.
DROP FUNCTION IF EXISTS public.ranking_vendedores(integer, integer);
CREATE FUNCTION public.ranking_vendedores(
  p_month integer DEFAULT extract(month FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::integer,
  p_year integer DEFAULT extract(year FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::integer
)
RETURNS TABLE (
  vendedor_id uuid, nome text, avatar_url text, total_leads bigint,
  contratos_fechados bigint, em_atendimento bigint, comissoes numeric, posicao bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_type text; v_start timestamptz; v_end timestamptz;
BEGIN
  SELECT seller.seller_type INTO v_type FROM public.internal_users seller
  WHERE seller.auth_user_id = auth.uid() AND seller.role = 'vendedor' AND seller.status = 'ativo' LIMIT 1;
  v_start := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'America/Sao_Paulo');
  v_end := v_start + interval '1 month';
  RETURN QUERY
  WITH metrics AS (
    SELECT seller.id, seller.full_name, profile.avatar_url, seller.seller_type,
      count(partnership.id)::bigint AS registrations
    FROM public.internal_users seller
    LEFT JOIN public.profiles profile ON profile.id = seller.auth_user_id
    LEFT JOIN public.seller_client_partnerships partnership
      ON partnership.seller_id = seller.id
     AND partnership.created_at >= v_start AND partnership.created_at < v_end
    WHERE seller.role = 'vendedor' AND seller.status = 'ativo'
      AND NOT seller.exclude_from_commercial_metrics
      AND lower(seller.email) <> 'vendedornox@nox.com'
      AND (v_type IS NULL OR seller.seller_type = v_type)
    GROUP BY seller.id, seller.full_name, profile.avatar_url, seller.seller_type
  ), ranked AS (
    SELECT metrics.*, row_number() OVER (
      PARTITION BY metrics.seller_type ORDER BY metrics.registrations DESC, metrics.full_name
    )::bigint AS ranking_position
    FROM metrics
  )
  SELECT ranked.id, ranked.full_name, ranked.avatar_url, ranked.registrations,
    ranked.registrations, 0::bigint, 0::numeric, ranked.ranking_position
  FROM ranked ORDER BY ranked.seller_type, ranked.ranking_position;
END;
$$;
REVOKE ALL ON FUNCTION public.ranking_vendedores(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ranking_vendedores(integer, integer) TO authenticated;

-- A administracao define uma unica prioridade mensal: cadastros realizados.
-- A conta de teste permanece utilizavel, mas nao aparece nas metas comerciais.
CREATE OR REPLACE FUNCTION public.get_seller_team_monthly_progress(
  p_month integer,
  p_year integer
)
RETURNS TABLE (
  seller_id uuid, seller_name text, target_meetings integer, target_clients integer,
  target_contracts integer, meetings_completed bigint, clients_registered bigint,
  contracts_closed bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_start timestamptz; v_end timestamptz;
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)) THEN
    RAISE EXCEPTION 'Apenas administradores podem consultar metas da equipe.';
  END IF;
  IF p_month < 1 OR p_month > 12 OR p_year < 2000 OR p_year > 9999 THEN
    RAISE EXCEPTION 'Mes ou ano invalido.';
  END IF;
  v_start := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'America/Sao_Paulo');
  v_end := v_start + interval '1 month';
  RETURN QUERY
  SELECT seller.id, seller.full_name, 0, goal.target_clients, 0,
    0::bigint,
    (SELECT count(*) FROM public.seller_client_partnerships partnership
      WHERE partnership.seller_id = seller.id
        AND partnership.created_at >= v_start AND partnership.created_at < v_end),
    0::bigint
  FROM public.internal_users seller
  LEFT JOIN public.seller_goals goal ON goal.seller_id = seller.id
    AND goal.month = p_month AND goal.year = p_year
  WHERE seller.role = 'vendedor' AND seller.status = 'ativo'
    AND NOT seller.exclude_from_commercial_metrics
    AND lower(seller.email) <> 'vendedornox@nox.com'
  ORDER BY seller.seller_type, seller.full_name;
END;
$$;
REVOKE ALL ON FUNCTION public.get_seller_team_monthly_progress(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_seller_team_monthly_progress(integer, integer) TO authenticated;

COMMENT ON COLUMN public.internal_users.seller_type IS 'Especialidade do vendedor: SDR ou Closer.';
COMMENT ON COLUMN public.internal_users.exclude_from_commercial_metrics IS 'Oculta contas internas/teste de rankings e metricas comerciais.';
COMMENT ON TABLE public.seller_referral_invites IS 'Links individuais de indicacao pre-cadastrados por SDR.';
COMMENT ON TABLE public.seller_referral_rewards IS 'R$ 50 por contrato indicado, liberados apos a segunda parcela.';
