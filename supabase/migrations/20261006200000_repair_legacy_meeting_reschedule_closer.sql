-- Permite reagendar reunioes legadas cujo Closer mudou de funcao, foi
-- desativado ou ficou gravado como SDR. O contrato das RPCs permanece igual
-- para que site e aplicativo recebam a correcao ao mesmo tempo.

BEGIN;

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

  -- Se o responsavel salvo deixou de ser Closer, usa a mesma distribuicao
  -- balanceada da agenda compartilhada. Ela devolve somente um Closer por
  -- horario e evita chaves duplicadas nos clientes web e nativo.
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
      60
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
  ), candidate_slots AS (
    SELECT
      (work_days.work_day + make_interval(hours => hour_value))
        AT TIME ZONE 'America/Sao_Paulo' AS starts_at
    FROM work_days
    CROSS JOIN generate_series(8, 17) AS hour_value
  )
  SELECT
    candidate.starts_at,
    candidate.starts_at + interval '1 hour',
    closer.id,
    closer.full_name,
    closer.email
  FROM candidate_slots AS candidate
  JOIN public.internal_users AS closer ON closer.id = v_closer_id
  WHERE public.is_seller_shared_slot_within_business_hours(candidate.starts_at, 60)
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
              busy.scheduled_at + make_interval(mins => busy.duration_minutes),
              '[)'
            ) && tstzrange(candidate.starts_at, candidate.starts_at + interval '1 hour', '[)')
    )
  ORDER BY candidate.starts_at;
END;
$$;

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
     OR NOT public.is_seller_shared_slot_within_business_hours(p_slot_start, 60) THEN
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

  -- Serializa a reserva antes de recuperar um novo Closer para uma reuniao
  -- legada; assim dois reagendamentos nao ocupam o mesmo horario.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_slot_start::text, 0));

  IF v_closer_id IS NULL THEN
    SELECT available.closer_id
    INTO v_closer_id
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
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.seller_appointments AS busy
    WHERE coalesce(busy.assigned_closer_id, busy.seller_id) = v_closer_id
      AND busy.id <> v_meeting.id
      AND public.seller_appointment_blocks_availability(busy.type, busy.status)
      AND tstzrange(
            busy.scheduled_at,
            busy.scheduled_at + make_interval(mins => busy.duration_minutes),
            '[)'
          ) && tstzrange(p_slot_start, p_slot_start + interval '1 hour', '[)')
  ) THEN
    RAISE EXCEPTION 'Este horario acabou de ser ocupado. Escolha outro horario disponivel.';
  END IF;

  UPDATE public.seller_appointments
  SET seller_id = v_closer_id,
      assigned_closer_id = v_closer_id,
      scheduled_at = p_slot_start,
      duration_minutes = 60,
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

-- Reunioes compartilhadas que perderam o Closer ficam visiveis ao unico
-- Closer ativo atual. Reunioes futuras so sao movidas se nao houver conflito;
-- as demais continuam protegidas e serao recuperadas ao escolher outro horario.
WITH single_active_closer AS (
  SELECT min(seller.id::text)::uuid AS closer_id
  FROM public.internal_users AS seller
  WHERE seller.role = 'vendedor'
    AND seller.seller_type = 'closer'
    AND seller.status = 'ativo'
    AND NOT coalesce(seller.exclude_from_commercial_metrics, false)
  HAVING count(*) = 1
)
UPDATE public.seller_appointments AS appointment
SET seller_id = active.closer_id,
    assigned_closer_id = active.closer_id,
    updated_at = now()
FROM single_active_closer AS active
WHERE appointment.type = 'reuniao'
  AND appointment.source = 'sdr_handoff'
  AND appointment.sdr_id IS NOT NULL
  AND appointment.status NOT IN ('concluido', 'cancelado', 'nao_compareceu')
  AND NOT EXISTS (
    SELECT 1
    FROM public.internal_users AS saved_closer
    WHERE saved_closer.id = coalesce(
        appointment.assigned_closer_id,
        appointment.seller_id
      )
      AND saved_closer.role = 'vendedor'
      AND saved_closer.seller_type = 'closer'
      AND saved_closer.status = 'ativo'
      AND NOT coalesce(saved_closer.exclude_from_commercial_metrics, false)
  )
  AND (
    appointment.scheduled_at <= now()
    OR NOT EXISTS (
      SELECT 1
      FROM public.seller_appointments AS busy
      WHERE coalesce(busy.assigned_closer_id, busy.seller_id) = active.closer_id
        AND busy.id <> appointment.id
        AND public.seller_appointment_blocks_availability(busy.type, busy.status)
        AND tstzrange(
              busy.scheduled_at,
              busy.scheduled_at + make_interval(mins => busy.duration_minutes),
              '[)'
            ) && tstzrange(
              appointment.scheduled_at,
              appointment.scheduled_at + interval '1 hour',
              '[)'
            )
    )
  );

COMMENT ON FUNCTION public.get_available_meeting_reschedule_slots(uuid, date, integer) IS
  'Lista horarios do Closer atual ou recupera automaticamente um Closer ativo quando o vinculo legado ficou invalido.';
COMMENT ON FUNCTION public.reschedule_seller_meeting(uuid, timestamptz) IS
  'Reagenda atomicamente e corrige o Closer de reunioes legadas antes de reservar o novo horario.';

NOTIFY pgrst, 'reload schema';

COMMIT;
