-- Padroniza a agenda compartilhada SDR -> Closer em reunioes de 1 hora.
-- Tambem corrige o contrato que rejeitava os 45 minutos ainda enviados
-- pelos clientes depois que a agenda foi alterada diretamente para 30.

ALTER TABLE public.seller_appointments
  ALTER COLUMN duration_minutes SET DEFAULT 60;

CREATE OR REPLACE FUNCTION public.get_available_closer_slots(
  p_from_date date DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  p_days integer DEFAULT 14,
  p_duration_minutes integer DEFAULT 60
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
  ), business_hours AS (
    SELECT generate_series(
      timestamp '2000-01-01 08:30', timestamp '2000-01-01 16:30', interval '1 hour'
    )::time AS slot_time
  ), filtered_hours AS (
    SELECT slot_time FROM business_hours
    WHERE slot_time + make_interval(mins => p_duration_minutes) <= time '17:30'
      AND (
        slot_time + make_interval(mins => p_duration_minutes) <= time '12:00'
        OR slot_time >= time '13:30'
      )
  ), slots AS (
    SELECT (days.work_day + filtered_hours.slot_time) AT TIME ZONE 'America/Sao_Paulo' AS starts_at
    FROM days
    CROSS JOIN filtered_hours
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
          SELECT count(*) FROM public.seller_appointments upcoming
          WHERE coalesce(upcoming.assigned_closer_id, upcoming.seller_id) = candidates.id
            AND upcoming.status NOT IN ('cancelado', 'concluido', 'nao_compareceu')
            AND upcoming.scheduled_at >= now()
        ), (
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_sdr_id uuid;
  v_closer_id uuid;
  v_closer_name text;
  v_id uuid;
BEGIN
  SELECT seller.id INTO v_sdr_id FROM public.internal_users seller
  WHERE seller.auth_user_id = auth.uid() AND seller.role = 'vendedor'
    AND seller.seller_type = 'sdr' AND seller.status = 'ativo' LIMIT 1;
  IF v_sdr_id IS NULL THEN RAISE EXCEPTION 'Somente SDRs ativos podem distribuir reunioes.'; END IF;
  IF nullif(trim(p_title), '') IS NULL OR nullif(trim(p_contact_name), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o titulo e o contato da reuniao.';
  END IF;
  IF p_duration_minutes IS DISTINCT FROM 60 THEN
    RAISE EXCEPTION 'As reunioes da agenda compartilhada duram sempre 1 hora.';
  END IF;
  IF p_slot_start <= now() + interval '30 minutes' THEN RAISE EXCEPTION 'Escolha um horario com pelo menos 30 minutos de antecedencia.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_slot_start::text, 0));

  SELECT available.closer_id, available.closer_name INTO v_closer_id, v_closer_name
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
  ) RETURNING seller_appointments.id INTO v_id;

  RETURN QUERY SELECT v_id, v_closer_id, v_closer_name;
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
  FROM public.get_available_closer_slots((p_slot_start AT TIME ZONE 'America/Sao_Paulo')::date, 1, 60) available
  WHERE available.slot_start = p_slot_start LIMIT 1;
  IF v_closer_id IS NULL THEN RAISE EXCEPTION 'Horario indisponivel.'; END IF;
  UPDATE public.seller_appointments
  SET seller_id = v_closer_id, assigned_closer_id = v_closer_id,
      scheduled_at = p_slot_start, duration_minutes = 60,
      status = 'remarcado', updated_at = now()
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

COMMENT ON FUNCTION public.get_available_closer_slots(date, integer, integer) IS
  'Horarios livres de 1 hora, seg-sex 08:30-17:30, com pausa de 12:00-13:30 e distribuicao balanceada entre Closers.';
COMMENT ON FUNCTION public.schedule_sdr_closer_meeting(timestamptz, text, text, text, text, text, integer) IS
  'Distribui uma reuniao de 1 hora para o Closer com a agenda mais aberta e devolve o Closer realmente atribuido.';
