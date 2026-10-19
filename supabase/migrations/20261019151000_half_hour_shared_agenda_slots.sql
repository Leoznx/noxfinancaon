-- Abre horarios de 30 em 30 minutos na agenda compartilhada SDR -> Closer e
-- normaliza novas reunioes para a duracao de 30 minutos. Nenhum compromisso
-- existente e removido, remarcado ou atualizado por esta migracao: as
-- reunioes ja agendadas mantem a duracao gravada e continuam participando
-- da deteccao de conflitos pela sua propria duracao.
--
-- Janela comercial (America/Sao_Paulo): segunda a sexta, 08:00-11:30 e
-- 13:00-17:30, com reunioes iniciando a cada 30 minutos.

BEGIN;

-- Mantem compatibilidade com reunioes administrativas de 1 hora (seg-qui 08:00-12:00 e
-- 13:00-18:00; sex 08:00-12:00 e 13:00-17:00) e passa a aceitar horarios livres
-- de 30 minutos para a agenda SDR -> Closer (seg-sex 08:00-11:30 e 13:00-17:30
-- em passos de 30 minutos). Reunioes ja agendadas nao sao revalidadas por esta
-- funcao e permanecem como estao.
CREATE OR REPLACE FUNCTION public.is_seller_shared_slot_within_business_hours(
  p_slot_start timestamptz,
  p_duration_minutes integer DEFAULT 30
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
    AND extract(second FROM starts_at) = 0
    AND CASE
      WHEN p_duration_minutes = 30 THEN
        extract(minute FROM starts_at) IN (0, 30)
        AND (
          (starts_at::time >= time '08:00' AND ends_at::time <= time '11:30')
          OR (starts_at::time >= time '13:00' AND ends_at::time <= time '17:30')
        )
      ELSE
        starts_at = date_trunc('hour', starts_at)
        AND (
          (starts_at::time >= time '08:00' AND ends_at::time <= time '12:00')
          OR (
            starts_at::time >= time '13:00'
            AND ends_at::time <= CASE
              WHEN extract(isodow FROM starts_at) = 5 THEN time '17:00'
              ELSE time '18:00'
            END
          )
        )
    END
  FROM local_slot;
$$;

REVOKE ALL ON FUNCTION public.is_seller_shared_slot_within_business_hours(timestamptz, integer)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.is_seller_shared_slot_within_business_hours(timestamptz, integer) IS
  'Valida horarios de 30 minutos da agenda compartilhada em America/Sao_Paulo: seg-sex 08:00-11:30 e 13:00-17:30.';

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
    WHEN coalesce(p_type, '') = 'reuniao'
      THEN coalesce(nullif(p_duration_minutes, 0), 30)
    ELSE greatest(15, least(coalesce(p_duration_minutes, 60), 240))
  END;
$$;

REVOKE ALL ON FUNCTION public.seller_appointment_effective_duration_minutes(text, integer)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.seller_appointment_effective_duration_minutes(text, integer) IS
  'Usa a duracao gravada da reuniao para calcular conflitos; novos agendamentos nasceram em 30 minutos sem alterar os existentes.';

CREATE OR REPLACE FUNCTION public.normalize_seller_meeting_duration()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.type = 'reuniao' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.duration_minutes := 30;
    ELSIF NEW.duration_minutes IS NULL OR NEW.duration_minutes <= 0 THEN
      NEW.duration_minutes := coalesce(OLD.duration_minutes, 30);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_seller_meeting_duration()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_available_closer_slots(
  p_from_date date DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  p_days integer DEFAULT 14,
  p_duration_minutes integer DEFAULT 30
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
  v_duration_minutes integer := coalesce(p_duration_minutes, 30);
BEGIN
  IF v_duration_minutes <> 30 THEN
    RAISE EXCEPTION 'As reunioes da agenda compartilhada duram 30 minutos.';
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
      interval '30 minutes'
    )::time AS slot_time
  ), slots AS (
    SELECT (days.work_day + business_hours.slot_time) AT TIME ZONE 'America/Sao_Paulo' AS starts_at
    FROM days
    CROSS JOIN business_hours
    WHERE public.is_seller_shared_slot_within_business_hours(
      (days.work_day + business_hours.slot_time) AT TIME ZONE 'America/Sao_Paulo',
      v_duration_minutes
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
              && tstzrange(
                slot.starts_at,
                slot.starts_at + make_interval(mins => v_duration_minutes),
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
    balanced.starts_at + make_interval(mins => v_duration_minutes),
    balanced.id,
    balanced.full_name,
    balanced.email
  FROM balanced
  WHERE balanced.choice = 1
  ORDER BY balanced.starts_at
  LIMIT 480;
END;
$$;

REVOKE ALL ON FUNCTION public.get_available_closer_slots(date, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_available_closer_slots(date, integer, integer)
  TO authenticated;

COMMENT ON FUNCTION public.get_available_closer_slots(date, integer, integer) IS
  'Horarios livres de 30 minutos: seg-sex 08:00-11:30 e 13:00-17:30 (America/Sao_Paulo).';

CREATE OR REPLACE FUNCTION public.schedule_sdr_closer_meeting(
  p_slot_start timestamptz,
  p_title text,
  p_contact_name text,
  p_contact_email text DEFAULT NULL,
  p_contact_phone text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_duration_minutes integer DEFAULT 30
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
  v_duration_minutes integer := coalesce(p_duration_minutes, 30);
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
  IF v_duration_minutes <> 30 THEN
    RAISE EXCEPTION 'As reunioes da agenda compartilhada duram 30 minutos.';
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
    v_duration_minutes
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
    v_duration_minutes,
    trim(p_contact_name),
    nullif(lower(trim(coalesce(p_contact_email, ''))), ''),
    nullif(trim(coalesce(p_contact_phone, '')), '')
  )
  RETURNING seller_appointments.id INTO v_id;

  RETURN QUERY SELECT v_id, v_closer_id, v_closer_name;
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_sdr_closer_meeting(timestamptz, text, text, text, text, text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_sdr_closer_meeting(timestamptz, text, text, text, text, text, integer)
  TO authenticated;

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

  IF NOT public.is_seller_shared_slot_within_business_hours(NEW.scheduled_at, 30) THEN
    RAISE EXCEPTION 'Escolha um horario comercial: seg-sex 08:00-11:30 e 13:00-17:30 em passos de 30 minutos.';
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
            && tstzrange(
              NEW.scheduled_at,
              NEW.scheduled_at + interval '30 minutes',
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
  NEW.duration_minutes := 30;
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

REVOKE ALL ON FUNCTION public.prepare_sdr_closer_meeting()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_available_meeting_reschedule_slots(
  p_appointment_id uuid,
  p_from_date date DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  p_days integer DEFAULT 1
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
  v_meeting public.seller_appointments%ROWTYPE;
  v_actor uuid := public.internal_user_id(auth.uid());
  v_closer_id uuid;
  v_from_date date := coalesce(
    p_from_date,
    (now() AT TIME ZONE 'America/Sao_Paulo')::date
  );
BEGIN
  SELECT appointment.*
  INTO v_meeting
  FROM public.seller_appointments AS appointment
  WHERE appointment.id = p_appointment_id;

  IF v_meeting.id IS NULL
     OR v_meeting.type <> 'reuniao'
     OR v_meeting.source = 'meeting_follow_up' THEN
    RAISE EXCEPTION 'Reuniao nao encontrada para reagendamento.';
  END IF;

  IF v_meeting.status IN ('concluido', 'cancelado', 'nao_compareceu') THEN
    RAISE EXCEPTION 'Somente reunioes pendentes podem ser reagendadas.';
  END IF;

  IF NOT (
    coalesce(v_actor = v_meeting.seller_id, false)
    OR coalesce(v_actor = v_meeting.sdr_id, false)
    OR coalesce(v_actor = v_meeting.assigned_closer_id, false)
    OR public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master')
  ) THEN
    RAISE EXCEPTION 'Voce nao pode reagendar esta reuniao.';
  END IF;

  SELECT closer.id
  INTO v_closer_id
  FROM public.internal_users AS closer
  WHERE closer.id = coalesce(v_meeting.assigned_closer_id, v_meeting.seller_id)
    AND closer.role = 'vendedor'
    AND closer.seller_type = 'closer'
    AND closer.status = 'ativo'
    AND NOT coalesce(closer.exclude_from_commercial_metrics, false);

  IF v_closer_id IS NULL THEN
    RETURN QUERY
    SELECT
      available.slot_start,
      available.slot_end,
      available.closer_id,
      available.closer_name,
      available.closer_email
    FROM public.get_available_closer_slots(
      v_from_date,
      greatest(1, least(coalesce(p_days, 1), 31)),
      30
    ) AS available
    WHERE available.slot_start IS DISTINCT FROM v_meeting.scheduled_at
    ORDER BY available.slot_start;
    RETURN;
  END IF;

  RETURN QUERY
  WITH work_days AS (
    SELECT generated.day::date AS work_day
    FROM generate_series(
      v_from_date,
      v_from_date + greatest(1, least(coalesce(p_days, 1), 31)) - 1,
      interval '1 day'
    ) AS generated(day)
  ), slot_offsets AS (
    SELECT (offset_minutes * interval '1 minute') AS slot_offset
    FROM generate_series(0, (17 - 8) * 60 + 30, 30) AS offset_minutes
  ), candidate_slots AS (
    SELECT
      ((work_days.work_day + time '08:00') + slot_offsets.slot_offset)
        AT TIME ZONE 'America/Sao_Paulo' AS starts_at
    FROM work_days
    CROSS JOIN slot_offsets
  )
  SELECT
    candidate.starts_at,
    candidate.starts_at + interval '30 minutes',
    closer.id,
    closer.full_name,
    closer.email
  FROM candidate_slots AS candidate
  JOIN public.internal_users AS closer ON closer.id = v_closer_id
  WHERE public.is_seller_shared_slot_within_business_hours(candidate.starts_at, 30)
    AND candidate.starts_at > now() + interval '30 minutes'
    AND candidate.starts_at IS DISTINCT FROM v_meeting.scheduled_at
    AND NOT EXISTS (
      SELECT 1
      FROM public.seller_appointments AS busy
      WHERE coalesce(busy.assigned_closer_id, busy.seller_id) = v_closer_id
        AND busy.id <> v_meeting.id
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
            ) && tstzrange(
              candidate.starts_at,
              candidate.starts_at + interval '30 minutes',
              '[)'
            )
    )
  ORDER BY candidate.starts_at;
END;
$$;

REVOKE ALL ON FUNCTION public.get_available_meeting_reschedule_slots(uuid, date, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_available_meeting_reschedule_slots(uuid, date, integer)
  TO authenticated;

COMMENT ON FUNCTION public.get_available_meeting_reschedule_slots(uuid, date, integer) IS
  'Lista horarios livres de 30 minutos para reagendar reunioes pendentes em America/Sao_Paulo.';

CREATE OR REPLACE FUNCTION public.reschedule_seller_meeting(
  p_appointment_id uuid,
  p_slot_start timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_meeting public.seller_appointments%ROWTYPE;
  v_actor uuid := public.internal_user_id(auth.uid());
  v_closer_id uuid;
  v_new_duration integer := 30;
BEGIN
  SELECT appointment.*
  INTO v_meeting
  FROM public.seller_appointments AS appointment
  WHERE appointment.id = p_appointment_id
  FOR UPDATE;

  IF v_meeting.id IS NULL
     OR v_meeting.type <> 'reuniao'
     OR v_meeting.source = 'meeting_follow_up' THEN
    RAISE EXCEPTION 'Reuniao nao encontrada para reagendamento.';
  END IF;

  IF v_meeting.status IN ('concluido', 'cancelado', 'nao_compareceu') THEN
    RAISE EXCEPTION 'Somente reunioes pendentes podem ser reagendadas.';
  END IF;

  IF NOT (
    coalesce(v_actor = v_meeting.seller_id, false)
    OR coalesce(v_actor = v_meeting.sdr_id, false)
    OR coalesce(v_actor = v_meeting.assigned_closer_id, false)
    OR public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master')
  ) THEN
    RAISE EXCEPTION 'Voce nao pode reagendar esta reuniao.';
  END IF;

  IF p_slot_start IS NULL
     OR p_slot_start <= now() + interval '30 minutes'
     OR NOT public.is_seller_shared_slot_within_business_hours(p_slot_start, v_new_duration) THEN
    RAISE EXCEPTION 'Escolha um horario comercial com pelo menos 30 minutos de antecedencia.';
  END IF;

  IF p_slot_start = v_meeting.scheduled_at THEN
    RAISE EXCEPTION 'Escolha um horario diferente do atual.';
  END IF;

  SELECT closer.id
  INTO v_closer_id
  FROM public.internal_users AS closer
  WHERE closer.id = coalesce(v_meeting.assigned_closer_id, v_meeting.seller_id)
    AND closer.role = 'vendedor'
    AND closer.seller_type = 'closer'
    AND closer.status = 'ativo'
    AND NOT coalesce(closer.exclude_from_commercial_metrics, false);

  PERFORM pg_advisory_xact_lock(hashtextextended(p_slot_start::text, 0));

  IF v_closer_id IS NULL THEN
    SELECT available.closer_id
    INTO v_closer_id
    FROM public.get_available_closer_slots(
      (p_slot_start AT TIME ZONE 'America/Sao_Paulo')::date,
      1,
      v_new_duration
    ) AS available
    WHERE available.slot_start = p_slot_start
    LIMIT 1;

    IF v_closer_id IS NULL THEN
      RAISE EXCEPTION 'Este horario acabou de ser ocupado. Escolha outro horario disponivel.';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.seller_appointments AS busy
    WHERE coalesce(busy.assigned_closer_id, busy.seller_id) = v_closer_id
      AND busy.id <> v_meeting.id
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
          ) && tstzrange(
            p_slot_start,
            p_slot_start + make_interval(mins => v_new_duration),
            '[)'
          )
  ) THEN
    RAISE EXCEPTION 'Este horario acabou de ser ocupado. Escolha outro horario disponivel.';
  END IF;

  UPDATE public.seller_appointments
  SET seller_id = v_closer_id,
      assigned_closer_id = v_closer_id,
      scheduled_at = p_slot_start,
      duration_minutes = v_new_duration,
      status = 'remarcado',
      completed_at = NULL,
      creation_notified_at = CASE
        WHEN source = 'sdr_handoff' THEN NULL
        ELSE creation_notified_at
      END,
      updated_at = now()
  WHERE id = v_meeting.id;

  DELETE FROM public.seller_meeting_reminder_deliveries
  WHERE appointment_id = v_meeting.id;

  RETURN v_meeting.id;
END;
$$;

REVOKE ALL ON FUNCTION public.reschedule_seller_meeting(uuid, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_seller_meeting(uuid, timestamptz)
  TO authenticated;

COMMENT ON FUNCTION public.reschedule_seller_meeting(uuid, timestamptz) IS
  'Reagenda reunioes em janelas de 30 minutos (seg-sex 08:00-11:30 e 13:00-17:30) com trava concorrente atomica.';

NOTIFY pgrst, 'reload schema';

COMMIT;
