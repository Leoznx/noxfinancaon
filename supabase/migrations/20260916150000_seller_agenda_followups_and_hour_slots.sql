-- Mantem a agenda SDR -> Closer com reunioes de exatamente uma hora e cria
-- dois lembretes pessoais de follow-up ao concluir uma reuniao com um Closer.
-- Nenhum compromisso existente e removido ou remarcado por esta migracao.

ALTER TABLE public.seller_appointments
  ADD COLUMN IF NOT EXISTS origin_appointment_id uuid
    REFERENCES public.seller_appointments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS follow_up_offset_days integer;

ALTER TABLE public.seller_appointments
  DROP CONSTRAINT IF EXISTS seller_appointments_source_check;
ALTER TABLE public.seller_appointments
  ADD CONSTRAINT seller_appointments_source_check
  CHECK (source IN ('manual', 'admin', 'lead_follow_up', 'sdr_handoff', 'meeting_follow_up'));

ALTER TABLE public.seller_appointments
  DROP CONSTRAINT IF EXISTS seller_appointments_follow_up_offset_check;
ALTER TABLE public.seller_appointments
  ADD CONSTRAINT seller_appointments_follow_up_offset_check
  CHECK (
    (source = 'meeting_follow_up' AND follow_up_offset_days IN (1, 4) AND origin_appointment_id IS NOT NULL)
    OR
    (source <> 'meeting_follow_up' AND follow_up_offset_days IS NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS seller_appointments_meeting_follow_up_key
  ON public.seller_appointments (origin_appointment_id, follow_up_offset_days)
  WHERE source = 'meeting_follow_up';

CREATE INDEX IF NOT EXISTS seller_appointments_origin_idx
  ON public.seller_appointments (origin_appointment_id)
  WHERE origin_appointment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.seller_appointment_effective_duration_minutes(
  p_type text,
  p_duration_minutes integer
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN coalesce(p_type, '') = 'reuniao' THEN 60
    ELSE greatest(15, least(coalesce(p_duration_minutes, 60), 240))
  END;
$$;

CREATE OR REPLACE FUNCTION public.format_seller_shared_meeting_title(
  p_contact_name text,
  p_notes text,
  p_fallback_title text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  WITH metadata AS (
    SELECT regexp_match(
      coalesce(p_notes, ''),
      '(^|[\r\n])Tipo de cliente:[[:space:]]*([^\r\n]+)',
      'i'
    ) AS parts
  ), normalized AS (
    SELECT
      nullif(btrim(parts[2]), '') AS profile,
      coalesce(nullif(btrim(p_contact_name), ''), 'Contato nao informado') AS contact_name,
      nullif(btrim(p_fallback_title), '') AS fallback_title
    FROM metadata
  )
  SELECT CASE
    WHEN profile IS NOT NULL THEN profile || ' — ' || contact_name
    ELSE coalesce(fallback_title, 'Cliente — ' || contact_name)
  END
  FROM normalized;
$$;

REVOKE ALL ON FUNCTION public.seller_appointment_effective_duration_minutes(text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.format_seller_shared_meeting_title(text, text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.normalize_seller_meeting_duration()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.type = 'reuniao' THEN
    NEW.duration_minutes := 60;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_seller_meeting_duration ON public.seller_appointments;
CREATE TRIGGER trg_normalize_seller_meeting_duration
BEFORE INSERT OR UPDATE OF type, duration_minutes
ON public.seller_appointments
FOR EACH ROW
EXECUTE FUNCTION public.normalize_seller_meeting_duration();

REVOKE ALL ON FUNCTION public.normalize_seller_meeting_duration()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_available_closer_slots(
  p_from_date date DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  p_days integer DEFAULT 14,
  p_duration_minutes integer DEFAULT 60
)
RETURNS TABLE (
  slot_start timestamptz,
  slot_end timestamptz,
  closer_id uuid,
  closer_name text,
  closer_email text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_type text;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_from_date date := greatest(coalesce(p_from_date, v_today), v_today);
  v_days integer := greatest(1, least(coalesce(p_days, 14), 31));
BEGIN
  IF p_duration_minutes IS DISTINCT FROM 60 THEN
    RAISE EXCEPTION 'As reunioes da agenda compartilhada duram sempre 1 hora.';
  END IF;

  SELECT seller.seller_type
  INTO v_seller_type
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid()
    AND seller.role = 'vendedor'
    AND seller.status = 'ativo'
  LIMIT 1;

  IF coalesce(v_seller_type, '') NOT IN ('sdr', 'closer')
     AND NOT public.is_admin(auth.uid())
     AND NOT public.has_internal_role(auth.uid(), 'admin_master') THEN
    RAISE EXCEPTION 'Somente a equipe comercial pode consultar a agenda compartilhada.';
  END IF;

  RETURN QUERY
  WITH days AS (
    SELECT day::date AS work_day
    FROM generate_series(
      v_from_date,
      v_from_date + v_days - 1,
      interval '1 day'
    ) AS day
    WHERE extract(isodow FROM day) BETWEEN 1 AND 5
  ), business_hours AS (
    SELECT generate_series(
      timestamp '2000-01-01 08:00',
      timestamp '2000-01-01 17:00',
      interval '1 hour'
    )::time AS slot_time
  ), slots AS (
    SELECT (days.work_day + business_hours.slot_time) AT TIME ZONE 'America/Sao_Paulo' AS starts_at
    FROM days
    CROSS JOIN business_hours
    WHERE public.is_seller_shared_slot_within_business_hours(
      (days.work_day + business_hours.slot_time) AT TIME ZONE 'America/Sao_Paulo',
      60
    )
  ), candidates AS (
    SELECT slot.starts_at, closer.id, closer.full_name, closer.email
    FROM slots AS slot
    CROSS JOIN public.internal_users AS closer
    WHERE closer.role = 'vendedor'
      AND closer.seller_type = 'closer'
      AND closer.status = 'ativo'
      AND NOT coalesce(closer.exclude_from_commercial_metrics, false)
      AND slot.starts_at > now() + interval '30 minutes'
      AND NOT EXISTS (
        SELECT 1
        FROM public.seller_appointments AS busy
        WHERE coalesce(busy.assigned_closer_id, busy.seller_id) = closer.id
          AND public.seller_appointment_blocks_availability(busy.type, busy.status)
          AND tstzrange(
                busy.scheduled_at,
                busy.scheduled_at + make_interval(
                  mins => public.seller_appointment_effective_duration_minutes(
                    busy.type,
                    busy.duration_minutes
                  )
                ),
                '[)'
              )
              && tstzrange(slot.starts_at, slot.starts_at + interval '1 hour', '[)')
      )
  ), balanced AS (
    SELECT candidates.*,
      row_number() OVER (
        PARTITION BY candidates.starts_at
        ORDER BY (
          SELECT count(*)
          FROM public.seller_appointments AS upcoming
          WHERE coalesce(upcoming.assigned_closer_id, upcoming.seller_id) = candidates.id
            AND public.seller_appointment_blocks_availability(upcoming.type, upcoming.status)
            AND upcoming.scheduled_at >= now()
        ), (
          SELECT count(*)
          FROM public.seller_appointments AS day_meeting
          WHERE coalesce(day_meeting.assigned_closer_id, day_meeting.seller_id) = candidates.id
            AND public.seller_appointment_blocks_availability(day_meeting.type, day_meeting.status)
            AND (day_meeting.scheduled_at AT TIME ZONE 'America/Sao_Paulo')::date =
                (candidates.starts_at AT TIME ZONE 'America/Sao_Paulo')::date
        ), candidates.full_name
      ) AS choice
    FROM candidates
  )
  SELECT
    balanced.starts_at,
    balanced.starts_at + interval '1 hour',
    balanced.id,
    balanced.full_name,
    balanced.email
  FROM balanced
  WHERE balanced.choice = 1
  ORDER BY balanced.starts_at
  LIMIT 240;
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_sdr_closer_meeting(
  p_slot_start timestamptz,
  p_title text,
  p_contact_name text,
  p_contact_email text DEFAULT NULL,
  p_contact_phone text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_duration_minutes integer DEFAULT 60
)
RETURNS TABLE (id uuid, closer_id uuid, closer_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sdr_id uuid;
  v_closer_id uuid;
  v_closer_name text;
  v_id uuid;
BEGIN
  SELECT seller.id
  INTO v_sdr_id
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid()
    AND seller.role = 'vendedor'
    AND seller.seller_type = 'sdr'
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_sdr_id IS NULL THEN
    RAISE EXCEPTION 'Somente SDRs ativos podem distribuir reunioes.';
  END IF;
  IF nullif(trim(p_contact_name), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o contato da reuniao.';
  END IF;
  IF p_duration_minutes IS DISTINCT FROM 60 THEN
    RAISE EXCEPTION 'As reunioes da agenda compartilhada duram sempre 1 hora.';
  END IF;
  IF p_slot_start <= now() + interval '30 minutes' THEN
    RAISE EXCEPTION 'Escolha um horario com pelo menos 30 minutos de antecedencia.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_slot_start::text, 0));

  SELECT available.closer_id, available.closer_name
  INTO v_closer_id, v_closer_name
  FROM public.get_available_closer_slots(
    (p_slot_start AT TIME ZONE 'America/Sao_Paulo')::date,
    1,
    60
  ) AS available
  WHERE available.slot_start = p_slot_start
  LIMIT 1;

  IF v_closer_id IS NULL THEN
    RAISE EXCEPTION 'Este horario acabou de ser ocupado. Escolha outro horario disponivel.';
  END IF;

  INSERT INTO public.seller_appointments (
    seller_id,
    sdr_id,
    assigned_closer_id,
    title,
    type,
    status,
    priority,
    scheduled_at,
    reminder_minutes,
    notes,
    source,
    duration_minutes,
    contact_name,
    contact_email,
    contact_phone
  ) VALUES (
    v_closer_id,
    v_sdr_id,
    v_closer_id,
    public.format_seller_shared_meeting_title(p_contact_name, p_notes, p_title),
    'reuniao',
    'agendado',
    'alta',
    p_slot_start,
    5,
    nullif(trim(coalesce(p_notes, '')), ''),
    'sdr_handoff',
    60,
    trim(p_contact_name),
    nullif(lower(trim(coalesce(p_contact_email, ''))), ''),
    nullif(trim(coalesce(p_contact_phone, '')), '')
  )
  RETURNING seller_appointments.id INTO v_id;

  RETURN QUERY SELECT v_id, v_closer_id, v_closer_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_sdr_closer_meeting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sdr_id uuid;
  v_closer_id uuid;
  v_ignored_id uuid := CASE WHEN TG_OP = 'UPDATE' THEN OLD.id ELSE NULL END;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.source = 'sdr_handoff'
     AND (
       OLD.scheduled_at IS DISTINCT FROM NEW.scheduled_at
       OR OLD.assigned_closer_id IS DISTINCT FROM NEW.assigned_closer_id
     ) THEN
    NEW.creation_notified_at := NULL;
  END IF;

  IF NEW.type <> 'reuniao'
     OR coalesce(NEW.source, 'manual') <> 'manual'
     OR NEW.assigned_closer_id IS NOT NULL
     OR NEW.scheduled_at <= now() THEN
    RETURN NEW;
  END IF;

  SELECT seller.id
  INTO v_sdr_id
  FROM public.internal_users AS seller
  WHERE seller.id = NEW.seller_id
    AND seller.role = 'vendedor'
    AND seller.seller_type = 'sdr'
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_sdr_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_seller_shared_slot_within_business_hours(NEW.scheduled_at, 60) THEN
    RAISE EXCEPTION 'Escolha um horario comercial: seg-qui 08:00-12:00 e 13:00-18:00; sex ate 17:00.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.scheduled_at::text, 0));

  SELECT closer.id
  INTO v_closer_id
  FROM public.internal_users AS closer
  WHERE closer.role = 'vendedor'
    AND closer.seller_type = 'closer'
    AND closer.status = 'ativo'
    AND NOT coalesce(closer.exclude_from_commercial_metrics, false)
    AND NOT EXISTS (
      SELECT 1
      FROM public.seller_appointments AS busy
      WHERE coalesce(busy.assigned_closer_id, busy.seller_id) = closer.id
        AND (v_ignored_id IS NULL OR busy.id <> v_ignored_id)
        AND public.seller_appointment_blocks_availability(busy.type, busy.status)
        AND tstzrange(
              busy.scheduled_at,
              busy.scheduled_at + make_interval(
                mins => public.seller_appointment_effective_duration_minutes(
                  busy.type,
                  busy.duration_minutes
                )
              ),
              '[)'
            )
            && tstzrange(NEW.scheduled_at, NEW.scheduled_at + interval '1 hour', '[)')
    )
  ORDER BY
    (
      SELECT count(*)
      FROM public.seller_appointments AS upcoming
      WHERE coalesce(upcoming.assigned_closer_id, upcoming.seller_id) = closer.id
        AND (v_ignored_id IS NULL OR upcoming.id <> v_ignored_id)
        AND public.seller_appointment_blocks_availability(upcoming.type, upcoming.status)
        AND upcoming.scheduled_at >= now()
    ),
    (
      SELECT count(*)
      FROM public.seller_appointments AS day_meeting
      WHERE coalesce(day_meeting.assigned_closer_id, day_meeting.seller_id) = closer.id
        AND (v_ignored_id IS NULL OR day_meeting.id <> v_ignored_id)
        AND public.seller_appointment_blocks_availability(day_meeting.type, day_meeting.status)
        AND (day_meeting.scheduled_at AT TIME ZONE 'America/Sao_Paulo')::date =
            (NEW.scheduled_at AT TIME ZONE 'America/Sao_Paulo')::date
    ),
    closer.full_name
  LIMIT 1;

  IF v_closer_id IS NULL THEN
    RAISE EXCEPTION 'Nenhum Closer esta livre neste horario. Escolha outro horario disponivel.';
  END IF;

  NEW.seller_id := v_closer_id;
  NEW.sdr_id := v_sdr_id;
  NEW.assigned_closer_id := v_closer_id;
  NEW.source := 'sdr_handoff';
  NEW.duration_minutes := 60;
  NEW.reminder_minutes := 5;
  NEW.contact_name := coalesce(
    nullif(trim(NEW.contact_name), ''),
    nullif(trim(NEW.title), ''),
    'Contato nao informado'
  );
  NEW.title := public.format_seller_shared_meeting_title(
    NEW.contact_name,
    NEW.notes,
    NEW.title
  );
  NEW.creation_notified_at := NULL;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_seller_meeting_follow_up_reminders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner_id uuid;
  v_completed_at timestamptz;
  v_closer_type text;
  v_base_title text;
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
  WHERE seller.id = coalesce(NEW.assigned_closer_id, NEW.seller_id)
    AND seller.role = 'vendedor'
    AND seller.status = 'ativo'
  LIMIT 1;

  IF NEW.assigned_closer_id IS NULL AND coalesce(v_closer_type, '') <> 'closer' THEN
    RETURN NEW;
  END IF;

  v_owner_id := coalesce(NEW.sdr_id, NEW.seller_id);
  v_completed_at := coalesce(NEW.completed_at, now());
  v_base_title := coalesce(
    nullif(trim(NEW.title), ''),
    nullif(trim(NEW.contact_name), ''),
    'Cliente'
  );

  INSERT INTO public.seller_appointments (
    seller_id,
    sdr_id,
    assigned_closer_id,
    lead_id,
    partnership_id,
    title,
    type,
    status,
    priority,
    scheduled_at,
    reminder_minutes,
    notes,
    source,
    duration_minutes,
    contact_name,
    contact_email,
    contact_phone,
    origin_appointment_id,
    follow_up_offset_days
  )
  SELECT
    v_owner_id,
    CASE WHEN NEW.sdr_id IS NOT NULL THEN v_owner_id ELSE NULL END,
    NULL,
    NEW.lead_id,
    NEW.partnership_id,
    CASE offset_days
      WHEN 1 THEN 'Follow-up 24h — ' || v_base_title
      ELSE 'Follow-up 4 dias — ' || v_base_title
    END,
    'follow_up',
    'agendado',
    'normal',
    v_completed_at + make_interval(days => offset_days),
    30,
    'Lembrete criado automaticamente apos a conclusao da reuniao.',
    'meeting_follow_up',
    60,
    NEW.contact_name,
    NEW.contact_email,
    NEW.contact_phone,
    NEW.id,
    offset_days
  FROM (VALUES (1), (4)) AS offsets(offset_days)
  ON CONFLICT (origin_appointment_id, follow_up_offset_days)
    WHERE source = 'meeting_follow_up'
  DO NOTHING;

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

REVOKE ALL ON FUNCTION public.get_available_closer_slots(date, integer, integer)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.schedule_sdr_closer_meeting(timestamptz, text, text, text, text, text, integer)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prepare_sdr_closer_meeting()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_seller_meeting_follow_up_reminders()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_available_closer_slots(date, integer, integer)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_sdr_closer_meeting(timestamptz, text, text, text, text, text, integer)
  TO authenticated;

COMMENT ON COLUMN public.seller_appointments.origin_appointment_id IS
  'Reuniao concluida que originou um lembrete automatico de follow-up.';
COMMENT ON COLUMN public.seller_appointments.follow_up_offset_days IS
  'Prazo idempotente do follow-up automatico: 1 dia (24h) ou 4 dias.';
COMMENT ON FUNCTION public.seller_appointment_effective_duration_minutes(text, integer) IS
  'Normaliza toda reuniao para exatamente 60 minutos ao calcular conflitos de agenda.';
COMMENT ON FUNCTION public.create_seller_meeting_follow_up_reminders() IS
  'Cria follow-ups pessoais de 24 horas e 4 dias para quem marcou uma reuniao concluida com um Closer.';
