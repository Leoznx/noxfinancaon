-- Resultado obrigatorio de reuniao, link de cadastro contextual e cadencia
-- comercial separada para Closer e SDR. O banco e compartilhado por web/mobile.

ALTER TABLE public.seller_appointments
  ADD COLUMN IF NOT EXISTS meeting_feedback text,
  ADD COLUMN IF NOT EXISTS feedback_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS follow_up_owner_type text,
  ADD COLUMN IF NOT EXISTS follow_up_message_key text;

UPDATE public.seller_appointments
SET follow_up_owner_type = CASE
      WHEN sdr_id IS NOT NULL AND seller_id = sdr_id THEN 'sdr'
      ELSE 'closer'
    END,
    follow_up_message_key = CASE
      WHEN follow_up_offset_days = 1 THEN 'closer_24h'
      WHEN follow_up_offset_days = 4 THEN 'legacy_4d'
      ELSE 'legacy'
    END
WHERE source = 'meeting_follow_up'
  AND follow_up_owner_type IS NULL;

ALTER TABLE public.seller_appointments
  DROP CONSTRAINT IF EXISTS seller_appointments_follow_up_offset_check,
  DROP CONSTRAINT IF EXISTS seller_appointments_follow_up_owner_check;

ALTER TABLE public.seller_appointments
  ADD CONSTRAINT seller_appointments_follow_up_owner_check
  CHECK (
    (
      source = 'meeting_follow_up'
      AND origin_appointment_id IS NOT NULL
      AND follow_up_offset_days >= 1
      AND follow_up_owner_type IN ('sdr', 'closer')
      AND nullif(trim(follow_up_message_key), '') IS NOT NULL
    )
    OR
    (
      source <> 'meeting_follow_up'
      AND origin_appointment_id IS NULL
      AND follow_up_offset_days IS NULL
      AND follow_up_owner_type IS NULL
      AND follow_up_message_key IS NULL
    )
  );

DROP INDEX IF EXISTS public.seller_appointments_meeting_follow_up_key;
CREATE UNIQUE INDEX seller_appointments_meeting_follow_up_key
  ON public.seller_appointments (
    origin_appointment_id,
    follow_up_owner_type,
    follow_up_offset_days
  )
  WHERE source = 'meeting_follow_up';

CREATE TABLE IF NOT EXISTS public.seller_business_holidays (
  holiday_date date PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.seller_business_holidays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_business_holidays FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.seller_business_holidays TO authenticated;
GRANT ALL ON public.seller_business_holidays TO service_role;

DROP POLICY IF EXISTS "Equipe comercial consulta feriados" ON public.seller_business_holidays;
CREATE POLICY "Equipe comercial consulta feriados"
  ON public.seller_business_holidays FOR SELECT TO authenticated
  USING (
    public.internal_user_id(auth.uid()) IS NOT NULL
    OR public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master')
  );

CREATE OR REPLACE FUNCTION public.seller_easter_sunday(p_year integer)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  a integer := p_year % 19;
  b integer := p_year / 100;
  c integer := p_year % 100;
  d integer := b / 4;
  e integer := b % 4;
  f integer := (b + 8) / 25;
  g integer := (b - f + 1) / 3;
  h integer;
  i integer := c / 4;
  k integer := c % 4;
  l integer;
  m integer;
  month_number integer;
  day_number integer;
BEGIN
  h := (19 * a + b - d - g + 15) % 30;
  l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  month_number := (h + l - 7 * m + 114) / 31;
  day_number := ((h + l - 7 * m + 114) % 31) + 1;
  RETURN make_date(p_year, month_number, day_number);
END;
$$;

CREATE OR REPLACE FUNCTION public.is_seller_business_holiday(p_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.seller_business_holidays AS holiday
      WHERE holiday.holiday_date = p_date
    )
    OR to_char(p_date, 'MM-DD') IN (
      '01-01', '04-21', '05-01', '09-07', '10-12',
      '11-02', '11-15', '11-20', '12-25'
    )
    OR p_date IN (
      public.seller_easter_sunday(extract(year FROM p_date)::integer) - 48,
      public.seller_easter_sunday(extract(year FROM p_date)::integer) - 47,
      public.seller_easter_sunday(extract(year FROM p_date)::integer) - 2,
      public.seller_easter_sunday(extract(year FROM p_date)::integer) + 60
    );
$$;

CREATE OR REPLACE FUNCTION public.next_seller_business_day(p_date date)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_date date := p_date;
BEGIN
  WHILE extract(isodow FROM v_date) NOT BETWEEN 1 AND 5
        OR public.is_seller_business_holiday(v_date)
  LOOP
    v_date := v_date + 1;
  END LOOP;
  RETURN v_date;
END;
$$;

CREATE OR REPLACE FUNCTION public.allocate_seller_follow_up_at(
  p_seller_id uuid,
  p_preferred_date date,
  p_seed text
)
RETURNS timestamptz
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_date date := public.next_seller_business_day(
    greatest(p_preferred_date, (now() AT TIME ZONE 'America/Sao_Paulo')::date)
  );
  v_times time[] := ARRAY[
    time '09:10', time '10:20', time '11:30',
    time '13:40', time '14:50', time '16:00'
  ];
  v_start integer := abs(hashtext(coalesce(p_seed, 'follow-up'))) % array_length(v_times, 1);
  v_index integer;
  v_candidate timestamptz;
  v_attempt integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_seller_id::text, 37));

  WHILE v_attempt < 370 LOOP
    v_date := public.next_seller_business_day(v_date);
    FOR v_index IN 0..array_length(v_times, 1) - 1 LOOP
      v_candidate := (v_date + v_times[((v_start + v_index) % array_length(v_times, 1)) + 1])
        AT TIME ZONE 'America/Sao_Paulo';

      IF NOT EXISTS (
        SELECT 1
        FROM public.seller_appointments AS appointment
        WHERE appointment.seller_id = p_seller_id
          AND appointment.status <> 'cancelado'
          AND tstzrange(
                appointment.scheduled_at,
                appointment.scheduled_at + make_interval(
                  mins => public.seller_appointment_effective_duration_minutes(
                    appointment.type,
                    appointment.duration_minutes
                  )
                ),
                '[)'
              ) && tstzrange(v_candidate, v_candidate + interval '20 minutes', '[)')
      ) THEN
        RETURN v_candidate;
      END IF;
    END LOOP;
    v_date := v_date + 1;
    v_attempt := v_attempt + 1;
  END LOOP;

  RAISE EXCEPTION 'Nao foi possivel reservar um horario de follow-up nos proximos dias uteis.';
END;
$$;

CREATE OR REPLACE FUNCTION public.require_closer_meeting_feedback()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_type text;
BEGIN
  IF NEW.type <> 'reuniao' OR NEW.status <> 'concluido' THEN
    RETURN NEW;
  END IF;

  SELECT seller.seller_type
  INTO v_seller_type
  FROM public.internal_users AS seller
  WHERE seller.id = coalesce(NEW.assigned_closer_id, NEW.seller_id)
    AND seller.role = 'vendedor'
  LIMIT 1;

  IF v_seller_type = 'closer' THEN
    IF length(trim(coalesce(NEW.meeting_feedback, ''))) < 10 THEN
      RAISE EXCEPTION 'Informe o feedback da reuniao com pelo menos 10 caracteres antes de concluir.';
    END IF;
    NEW.meeting_feedback := trim(NEW.meeting_feedback);
    NEW.feedback_submitted_at := coalesce(NEW.feedback_submitted_at, now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_require_closer_meeting_feedback ON public.seller_appointments;
CREATE TRIGGER trg_require_closer_meeting_feedback
BEFORE INSERT OR UPDATE OF status, meeting_feedback
ON public.seller_appointments
FOR EACH ROW
EXECUTE FUNCTION public.require_closer_meeting_feedback();

CREATE OR REPLACE FUNCTION public.complete_closer_meeting(
  p_appointment_id uuid,
  p_feedback text
)
RETURNS public.seller_appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_closer_id uuid;
  v_meeting public.seller_appointments%ROWTYPE;
BEGIN
  SELECT seller.id
  INTO v_closer_id
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid()
    AND seller.role = 'vendedor'
    AND seller.seller_type = 'closer'
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_closer_id IS NULL THEN
    RAISE EXCEPTION 'Somente o Closer responsavel pode concluir esta reuniao.';
  END IF;

  SELECT appointment.*
  INTO v_meeting
  FROM public.seller_appointments AS appointment
  WHERE appointment.id = p_appointment_id
    AND appointment.type = 'reuniao'
    AND coalesce(appointment.assigned_closer_id, appointment.seller_id) = v_closer_id
  FOR UPDATE;

  IF v_meeting.id IS NULL THEN
    RAISE EXCEPTION 'Reuniao nao encontrada na agenda deste Closer.';
  END IF;
  IF v_meeting.status = 'cancelado' THEN
    RAISE EXCEPTION 'Uma reuniao cancelada nao pode ser concluida.';
  END IF;
  IF now() < v_meeting.scheduled_at + make_interval(mins => v_meeting.duration_minutes) THEN
    RAISE EXCEPTION 'O feedback fica disponivel ao final do horario marcado da reuniao.';
  END IF;
  IF length(trim(coalesce(p_feedback, ''))) < 10 THEN
    RAISE EXCEPTION 'Descreva o resultado da reuniao com pelo menos 10 caracteres.';
  END IF;

  UPDATE public.seller_appointments
  SET meeting_feedback = trim(p_feedback),
      feedback_submitted_at = now(),
      status = 'concluido'
  WHERE id = v_meeting.id
  RETURNING * INTO v_meeting;

  RETURN v_meeting;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_meeting_signup_links(p_appointment_id uuid)
RETURNS TABLE (
  profile_role text,
  token text,
  source_sdr_id uuid,
  source_sdr_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_closer_id uuid;
  v_sdr_id uuid;
BEGIN
  SELECT seller.id
  INTO v_closer_id
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid()
    AND seller.role = 'vendedor'
    AND seller.seller_type = 'closer'
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_closer_id IS NULL THEN
    RAISE EXCEPTION 'Somente Closers ativos podem gerar o link desta reuniao.';
  END IF;

  SELECT appointment.sdr_id
  INTO v_sdr_id
  FROM public.seller_appointments AS appointment
  WHERE appointment.id = p_appointment_id
    AND appointment.type = 'reuniao'
    AND coalesce(appointment.assigned_closer_id, appointment.seller_id) = v_closer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reuniao nao encontrada na agenda deste Closer.';
  END IF;

  RETURN QUERY
  SELECT generated.profile_role, generated.token,
    generated.source_sdr_id, generated.source_sdr_name
  FROM public.get_my_seller_signup_links(v_sdr_id) AS generated;
END;
$$;

CREATE OR REPLACE FUNCTION public.insert_seller_meeting_follow_up(
  p_origin public.seller_appointments,
  p_owner_id uuid,
  p_owner_type text,
  p_offset_days integer,
  p_preferred_date date DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_title text;
  v_key text;
  v_date date := coalesce(
    p_preferred_date,
    ((coalesce(p_origin.completed_at, now()) AT TIME ZONE 'America/Sao_Paulo')::date + p_offset_days)
  );
  v_scheduled_at timestamptz;
BEGIN
  IF p_owner_id IS NULL OR p_owner_type NOT IN ('sdr', 'closer') THEN
    RETURN;
  END IF;

  v_key := CASE
    WHEN p_owner_type = 'closer' AND p_offset_days = 1 THEN 'closer_24h'
    WHEN p_owner_type = 'closer' AND p_offset_days = 3 THEN 'closer_3d'
    WHEN p_owner_type = 'sdr' AND p_offset_days = 2 THEN 'sdr_48h'
    WHEN p_owner_type = 'sdr' AND p_offset_days = 5 THEN 'sdr_5d'
    ELSE 'sdr_27d'
  END;

  v_title := CASE v_key
    WHEN 'closer_24h' THEN 'Follow-up Closer 24h — '
    WHEN 'closer_3d' THEN 'Follow-up Closer 3 dias — '
    WHEN 'sdr_48h' THEN 'Follow-up SDR 48h — '
    WHEN 'sdr_5d' THEN 'Follow-up SDR 5 dias — '
    ELSE 'Follow-up SDR 27 dias — '
  END || coalesce(nullif(trim(p_origin.contact_name), ''), nullif(trim(p_origin.title), ''), 'Cliente');

  v_scheduled_at := public.allocate_seller_follow_up_at(
    p_owner_id,
    v_date,
    p_origin.id::text || ':' || p_owner_type || ':' || p_offset_days::text
  );

  INSERT INTO public.seller_appointments (
    seller_id, lead_id, partnership_id, title, type, status, priority,
    scheduled_at, reminder_minutes, notes, source, duration_minutes,
    contact_name, contact_email, contact_phone, origin_appointment_id,
    follow_up_offset_days, follow_up_owner_type, follow_up_message_key
  ) VALUES (
    p_owner_id, p_origin.lead_id, p_origin.partnership_id, v_title,
    'follow_up', 'agendado', 'normal', v_scheduled_at, 30,
    'Follow-up criado automaticamente a partir da reuniao concluida.',
    'meeting_follow_up', 20, p_origin.contact_name, p_origin.contact_email,
    p_origin.contact_phone, p_origin.id, p_offset_days, p_owner_type, v_key
  )
  ON CONFLICT (origin_appointment_id, follow_up_owner_type, follow_up_offset_days)
    WHERE source = 'meeting_follow_up'
  DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_seller_meeting_follow_up_reminders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_closer_id uuid := coalesce(NEW.assigned_closer_id, NEW.seller_id);
  v_closer_type text;
BEGIN
  IF NEW.type <> 'reuniao' OR NEW.status <> 'concluido' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'concluido' THEN
    RETURN NEW;
  END IF;

  SELECT seller.seller_type
  INTO v_closer_type
  FROM public.internal_users AS seller
  WHERE seller.id = v_closer_id
    AND seller.role = 'vendedor'
    AND seller.status = 'ativo';

  IF v_closer_type <> 'closer' THEN
    RETURN NEW;
  END IF;

  PERFORM public.insert_seller_meeting_follow_up(NEW, v_closer_id, 'closer', 1);
  PERFORM public.insert_seller_meeting_follow_up(NEW, v_closer_id, 'closer', 3);

  IF NEW.sdr_id IS NOT NULL THEN
    PERFORM public.insert_seller_meeting_follow_up(NEW, NEW.sdr_id, 'sdr', 2);
    PERFORM public.insert_seller_meeting_follow_up(NEW, NEW.sdr_id, 'sdr', 5);
    PERFORM public.insert_seller_meeting_follow_up(NEW, NEW.sdr_id, 'sdr', 27);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_seller_meeting_follow_up_reminders
  ON public.seller_appointments;
CREATE TRIGGER trg_create_seller_meeting_follow_up_reminders
AFTER INSERT OR UPDATE OF status
ON public.seller_appointments
FOR EACH ROW
EXECUTE FUNCTION public.create_seller_meeting_follow_up_reminders();

CREATE OR REPLACE FUNCTION public.create_next_sdr_recurring_follow_up()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_origin public.seller_appointments%ROWTYPE;
  v_next_offset integer;
  v_next_date date;
BEGIN
  IF NEW.source <> 'meeting_follow_up'
     OR NEW.follow_up_owner_type <> 'sdr'
     OR NEW.follow_up_offset_days < 27
     OR NEW.follow_up_offset_days % 27 <> 0
     OR NEW.status <> 'concluido'
     OR (TG_OP = 'UPDATE' AND OLD.status = 'concluido') THEN
    RETURN NEW;
  END IF;

  SELECT origin.* INTO v_origin
  FROM public.seller_appointments AS origin
  WHERE origin.id = NEW.origin_appointment_id;

  IF v_origin.id IS NULL THEN
    RETURN NEW;
  END IF;

  v_next_offset := NEW.follow_up_offset_days + 27;
  v_next_date := ((coalesce(NEW.completed_at, now()) AT TIME ZONE 'America/Sao_Paulo')::date + 27);
  PERFORM public.insert_seller_meeting_follow_up(
    v_origin,
    NEW.seller_id,
    'sdr',
    v_next_offset,
    v_next_date
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_next_sdr_recurring_follow_up
  ON public.seller_appointments;
CREATE TRIGGER trg_create_next_sdr_recurring_follow_up
AFTER INSERT OR UPDATE OF status
ON public.seller_appointments
FOR EACH ROW
EXECUTE FUNCTION public.create_next_sdr_recurring_follow_up();

-- Converte cadastros por link em vinculos operacionais. Assim o cliente aparece
-- para os dois responsaveis e contratos futuros alimentam comissao e ranking.
CREATE OR REPLACE FUNCTION public.ensure_seller_signup_partnership(
  p_seller_id uuid,
  p_profile_id uuid,
  p_profile_role text,
  p_email text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller public.internal_users%ROWTYPE;
  v_corretor public.corretores%ROWTYPE;
  v_imobiliaria public.imobiliarias%ROWTYPE;
  v_partner_type text;
  v_partnership_id uuid;
BEGIN
  IF p_profile_role = 'proprietario' THEN
    RETURN NULL;
  END IF;

  SELECT seller.* INTO v_seller
  FROM public.internal_users AS seller
  WHERE seller.id = p_seller_id
    AND seller.role = 'vendedor'
    AND seller.seller_type IN ('sdr', 'closer')
    AND seller.status = 'ativo';

  IF v_seller.id IS NULL OR v_seller.auth_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_profile_role = 'corretor' THEN
    SELECT broker.* INTO v_corretor
    FROM public.corretores AS broker
    WHERE broker.profile_id = p_profile_id
    LIMIT 1;
    IF v_corretor.id IS NULL THEN RETURN NULL; END IF;
    IF v_corretor.imobiliaria_id IS NULL THEN
      v_partner_type := 'corretor_autonomo';
    ELSE
      v_partner_type := 'imobiliaria';
      SELECT agency.* INTO v_imobiliaria
      FROM public.imobiliarias AS agency
      WHERE agency.id = v_corretor.imobiliaria_id;
    END IF;
  ELSIF p_profile_role = 'imobiliaria' THEN
    v_partner_type := 'imobiliaria';
    SELECT agency.* INTO v_imobiliaria
    FROM public.imobiliarias AS agency
    WHERE lower(agency.contato_email) = lower(trim(p_email))
    LIMIT 1;
    IF v_imobiliaria.id IS NULL THEN RETURN NULL; END IF;
  ELSE
    RETURN NULL;
  END IF;

  SELECT partnership.id INTO v_partnership_id
  FROM public.seller_client_partnerships AS partnership
  WHERE partnership.seller_id = v_seller.id
    AND (
      (v_partner_type = 'imobiliaria' AND partnership.imobiliaria_id = v_imobiliaria.id)
      OR
      (v_partner_type = 'corretor_autonomo' AND partnership.client_profile_id = p_profile_id)
    )
  LIMIT 1;
  IF v_partnership_id IS NOT NULL THEN RETURN v_partnership_id; END IF;

  INSERT INTO public.seller_client_partnerships (
    seller_id, seller_type, client_profile_id, imobiliaria_id,
    partner_type, registered_email, created_by
  ) VALUES (
    v_seller.id, v_seller.seller_type, p_profile_id,
    CASE WHEN v_partner_type = 'imobiliaria' THEN v_imobiliaria.id ELSE NULL END,
    v_partner_type, lower(trim(p_email)), v_seller.auth_user_id
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_partnership_id;

  RETURN v_partnership_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_seller_signup_link(
  p_token text,
  p_profile_id uuid,
  p_profile_role text,
  p_email text,
  p_display_name text
)
RETURNS TABLE (recipient_email text, recipient_name text, credited_seller_type text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_link record;
  v_profile_email text;
  v_profile_role text;
  v_role_label text;
  v_inserted integer := 0;
  v_any_inserted boolean := false;
BEGIN
  SELECT lower(profile.email), profile.role::text
    INTO v_profile_email, v_profile_role
  FROM public.profiles AS profile
  WHERE profile.id = p_profile_id;

  IF v_profile_email IS NULL
     OR v_profile_email <> lower(trim(p_email))
     OR v_profile_role <> p_profile_role
     OR p_profile_role NOT IN ('proprietario', 'imobiliaria', 'corretor') THEN
    RAISE EXCEPTION 'Os dados do cadastro nao correspondem ao perfil criado.';
  END IF;

  SELECT link.id, link.seller_id, link.source_sdr_id,
    seller.seller_type, seller.auth_user_id, seller.email, seller.full_name,
    source_sdr.auth_user_id AS source_auth_user_id,
    source_sdr.email AS source_email,
    source_sdr.full_name AS source_name
  INTO v_link
  FROM public.seller_signup_links AS link
  JOIN public.internal_users AS seller ON seller.id = link.seller_id
  LEFT JOIN public.internal_users AS source_sdr ON source_sdr.id = link.source_sdr_id
  WHERE link.token = p_token
    AND link.profile_role = p_profile_role
    AND link.active
    AND seller.role = 'vendedor'
    AND seller.seller_type IN ('sdr', 'closer')
    AND seller.status = 'ativo'
    AND (
      link.source_sdr_id IS NULL
      OR (
        seller.seller_type = 'closer'
        AND source_sdr.role = 'vendedor'
        AND source_sdr.seller_type = 'sdr'
        AND source_sdr.status = 'ativo'
        AND EXISTS (
          SELECT 1 FROM public.seller_appointments AS appointment
          WHERE appointment.assigned_closer_id = seller.id
            AND appointment.sdr_id = source_sdr.id
            AND appointment.source = 'sdr_handoff'
        )
      )
    )
  LIMIT 1
  FOR UPDATE OF link;

  IF v_link.id IS NULL THEN
    RAISE EXCEPTION 'Link de cadastro invalido ou inativo.';
  END IF;

  v_role_label := CASE p_profile_role
    WHEN 'proprietario' THEN 'proprietario'
    WHEN 'imobiliaria' THEN 'imobiliaria'
    ELSE 'corretor'
  END;

  INSERT INTO public.seller_signup_attributions (
    link_id, seller_id, seller_type, registered_profile_id, profile_role, registered_email
  ) VALUES (
    v_link.id, v_link.seller_id, v_link.seller_type,
    p_profile_id, p_profile_role, lower(trim(p_email))
  )
  ON CONFLICT (registered_profile_id, seller_type) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  PERFORM public.ensure_seller_signup_partnership(
    v_link.seller_id, p_profile_id, p_profile_role, p_email
  );

  IF v_inserted > 0 THEN
    v_any_inserted := true;
    INSERT INTO public.notificacoes (
      user_id, titulo, mensagem, tipo, icone, cor_destaque, link
    ) VALUES (
      v_link.auth_user_id,
      'Novo cadastro pelo seu link',
      trim(coalesce(p_display_name, 'Um novo cliente')) || ' concluiu o cadastro como ' ||
        v_role_label || '. O cadastro ja entrou no seu ranking e na sua carteira.',
      'cadastro_link', 'user-plus', 'amarelo', '/vendedor/ranking'
    );
    RETURN QUERY SELECT v_link.email::text, v_link.full_name::text, v_link.seller_type::text;
  END IF;

  IF v_link.source_sdr_id IS NOT NULL THEN
    INSERT INTO public.seller_signup_attributions (
      link_id, seller_id, seller_type, registered_profile_id, profile_role, registered_email
    ) VALUES (
      v_link.id, v_link.source_sdr_id, 'sdr',
      p_profile_id, p_profile_role, lower(trim(p_email))
    )
    ON CONFLICT (registered_profile_id, seller_type) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    PERFORM public.ensure_seller_signup_partnership(
      v_link.source_sdr_id, p_profile_id, p_profile_role, p_email
    );

    IF v_inserted > 0 THEN
      v_any_inserted := true;
      INSERT INTO public.notificacoes (
        user_id, titulo, mensagem, tipo, icone, cor_destaque, link
      ) VALUES (
        v_link.source_auth_user_id,
        'Novo cadastro compartilhado',
        trim(coalesce(p_display_name, 'Um novo cliente')) || ' concluiu o cadastro como ' ||
          v_role_label || ' apos sua reuniao. O cliente esta vinculado ao SDR e ao Closer.',
        'cadastro_link', 'user-plus', 'amarelo', '/vendedor/ranking'
      );
      RETURN QUERY SELECT v_link.source_email::text, v_link.source_name::text, 'sdr'::text;
    END IF;
  END IF;

  IF v_any_inserted THEN
    UPDATE public.seller_signup_links
    SET usage_count = usage_count + 1, last_used_at = now(), updated_at = now()
    WHERE id = v_link.id;
  END IF;
END;
$$;

DO $$
DECLARE
  attribution record;
BEGIN
  FOR attribution IN
    SELECT item.seller_id, item.registered_profile_id,
      item.profile_role, item.registered_email
    FROM public.seller_signup_attributions AS item
  LOOP
    PERFORM public.ensure_seller_signup_partnership(
      attribution.seller_id,
      attribution.registered_profile_id,
      attribution.profile_role,
      attribution.registered_email
    );
  END LOOP;
END;
$$;

-- Cenario isolado para validar a experiencia solicitada na conta de teste.
INSERT INTO public.seller_appointments (
  seller_id, assigned_closer_id, title, type, status, priority,
  scheduled_at, reminder_minutes, notes, source, duration_minutes,
  contact_name, contact_email, contact_phone
)
SELECT
  seller.id, seller.id, 'TESTE — Feedback, cadastro e WhatsApp',
  'reuniao', 'agendado', 'normal', now() - interval '1 day', 5,
  'Cenario interno NOX: conclua a reuniao, informe o feedback e teste o envio do link.',
  'manual', 60, 'Imobiliaria Teste NOX', 'teste-agenda@nox.com', '(11) 99999-0000'
FROM public.internal_users AS seller
WHERE lower(seller.email) = 'vendedornox@nox.com'
  AND seller.role = 'vendedor'
  AND seller.seller_type = 'closer'
  AND seller.status = 'ativo'
  AND NOT EXISTS (
    SELECT 1
    FROM public.seller_appointments AS existing
    WHERE existing.seller_id = seller.id
      AND existing.title = 'TESTE — Feedback, cadastro e WhatsApp'
  );

REVOKE ALL ON FUNCTION public.seller_easter_sunday(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_seller_business_holiday(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.next_seller_business_day(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.allocate_seller_follow_up_at(uuid, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.require_closer_meeting_feedback() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_closer_meeting(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_meeting_signup_links(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.insert_seller_meeting_follow_up(public.seller_appointments, uuid, text, integer, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_seller_meeting_follow_up_reminders() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_next_sdr_recurring_follow_up() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_seller_signup_partnership(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_seller_signup_link(text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.is_seller_business_holiday(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_seller_business_day(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_closer_meeting(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_meeting_signup_links(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_seller_signup_link(text, uuid, text, text, text) TO service_role;

COMMENT ON COLUMN public.seller_appointments.meeting_feedback IS
  'Feedback obrigatorio informado pelo Closer ao concluir uma reuniao.';
COMMENT ON COLUMN public.seller_appointments.follow_up_owner_type IS
  'Etapa comercial responsavel pelo follow-up automatico: closer ou sdr.';
COMMENT ON FUNCTION public.complete_closer_meeting(uuid, text) IS
  'Conclui a reuniao somente depois do horario final e com feedback obrigatorio.';
COMMENT ON FUNCTION public.get_meeting_signup_links(uuid) IS
  'Gera links do Closer vinculados automaticamente ao SDR de origem da reuniao.';
