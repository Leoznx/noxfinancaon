-- Ajusta somente a disponibilidade para novos agendamentos. Nenhum compromisso
-- existente e alterado, removido ou remarcado por esta migracao.

CREATE OR REPLACE FUNCTION public.is_seller_shared_slot_within_business_hours(
  p_slot_start timestamptz,
  p_duration_minutes integer DEFAULT 60
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  WITH local_slot AS (
    SELECT
      p_slot_start AT TIME ZONE 'America/Sao_Paulo' AS starts_at,
      (p_slot_start AT TIME ZONE 'America/Sao_Paulo')
        + make_interval(mins => p_duration_minutes) AS ends_at
  )
  SELECT
    p_duration_minutes > 0
    AND extract(isodow FROM starts_at) BETWEEN 1 AND 5
    AND starts_at = date_trunc('hour', starts_at)
    AND (
      (
        starts_at::time >= time '08:00'
        AND ends_at::time <= time '12:00'
      )
      OR
      (
        starts_at::time >= time '13:00'
        AND ends_at::time <= CASE
          WHEN extract(isodow FROM starts_at) = 5 THEN time '17:00'
          ELSE time '18:00'
        END
      )
    )
  FROM local_slot;
$$;

CREATE OR REPLACE FUNCTION public.seller_appointment_blocks_availability(
  p_type text,
  p_status text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    coalesce(p_type, '') <> 'follow_up'
    AND coalesce(p_status, 'agendado') NOT IN ('cancelado', 'concluido', 'nao_compareceu');
$$;

REVOKE ALL ON FUNCTION public.is_seller_shared_slot_within_business_hours(timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_appointment_blocks_availability(text, text)
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
  IF coalesce(p_duration_minutes, 0) <= 0 OR p_duration_minutes > 240 THEN
    RAISE EXCEPTION 'Duracao invalida para consultar a agenda.';
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
      p_duration_minutes
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
                busy.scheduled_at + make_interval(mins => busy.duration_minutes),
                '[)'
              )
              && tstzrange(
                slot.starts_at,
                slot.starts_at + make_interval(mins => p_duration_minutes),
                '[)'
              )
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
    balanced.starts_at + make_interval(mins => p_duration_minutes),
    balanced.id,
    balanced.full_name,
    balanced.email
  FROM balanced
  WHERE balanced.choice = 1
  ORDER BY balanced.starts_at
  LIMIT 240;
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
              busy.scheduled_at + make_interval(mins => busy.duration_minutes),
              '[)'
            )
            && tstzrange(
              NEW.scheduled_at,
              NEW.scheduled_at + interval '1 hour',
              '[)'
            )
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
  NEW.creation_notified_at := NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.get_available_closer_slots(date, integer, integer)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prepare_sdr_closer_meeting()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_available_closer_slots(date, integer, integer)
  TO authenticated;

COMMENT ON FUNCTION public.is_seller_shared_slot_within_business_hours(timestamptz, integer) IS
  'Valida novos horarios da agenda compartilhada em America/Sao_Paulo sem alterar compromissos existentes.';
COMMENT ON FUNCTION public.seller_appointment_blocks_availability(text, text) IS
  'Follow-ups sao lembretes e nunca consomem um horario livre da agenda compartilhada.';
COMMENT ON FUNCTION public.get_available_closer_slots(date, integer, integer) IS
  'Horarios livres de 1 hora: seg-qui 08:00-12:00 e 13:00-18:00; sex 08:00-12:00 e 13:00-17:00.';
COMMENT ON FUNCTION public.prepare_sdr_closer_meeting() IS
  'Mantem novas reunioes de SDR conectadas automaticamente a um Closer livre dentro do horario comercial.';
