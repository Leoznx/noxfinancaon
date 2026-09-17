-- Reagendamento unificado de reunioes do SDR e do Closer.
-- A disponibilidade e validada novamente dentro da mesma transacao que grava
-- a nova data, impedindo que dois usuarios ocupem o mesmo horario do Closer.

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
  v_from_date date := coalesce(p_from_date, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
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

  v_closer_id := coalesce(v_meeting.assigned_closer_id, v_meeting.seller_id);

  IF NOT EXISTS (
    SELECT 1
    FROM public.internal_users AS closer
    WHERE closer.id = v_closer_id
      AND closer.role = 'vendedor'
      AND closer.seller_type = 'closer'
      AND closer.status = 'ativo'
  ) THEN
    RAISE EXCEPTION 'O Closer desta reuniao nao esta disponivel para reagendamento.';
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

  v_closer_id := coalesce(v_meeting.assigned_closer_id, v_meeting.seller_id);

  IF NOT EXISTS (
    SELECT 1
    FROM public.internal_users AS closer
    WHERE closer.id = v_closer_id
      AND closer.role = 'vendedor'
      AND closer.seller_type = 'closer'
      AND closer.status = 'ativo'
  ) THEN
    RAISE EXCEPTION 'O Closer desta reuniao nao esta disponivel para reagendamento.';
  END IF;

  -- A mesma chave e usada pelo agendamento SDR -> Closer existente. Depois de
  -- adquirir a trava, a disponibilidade e consultada novamente nesta transacao.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_slot_start::text, 0));

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
  SET scheduled_at = p_slot_start,
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

-- Mantem clientes antigos seguros e com o mesmo comportamento do novo fluxo.
CREATE OR REPLACE FUNCTION public.reschedule_shared_sales_meeting(
  p_appointment_id uuid,
  p_slot_start timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_closer_id uuid;
BEGIN
  PERFORM public.reschedule_seller_meeting(p_appointment_id, p_slot_start);

  SELECT coalesce(appointment.assigned_closer_id, appointment.seller_id)
  INTO v_closer_id
  FROM public.seller_appointments AS appointment
  WHERE appointment.id = p_appointment_id;

  RETURN v_closer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_available_meeting_reschedule_slots(uuid, date, integer)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reschedule_seller_meeting(uuid, timestamptz)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reschedule_shared_sales_meeting(uuid, timestamptz)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_available_meeting_reschedule_slots(uuid, date, integer)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_seller_meeting(uuid, timestamptz)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_shared_sales_meeting(uuid, timestamptz)
  TO authenticated;

COMMENT ON FUNCTION public.get_available_meeting_reschedule_slots(uuid, date, integer) IS
  'Lista horarios livres do Closer atual sem considerar a propria reuniao que sera remarcada.';
COMMENT ON FUNCTION public.reschedule_seller_meeting(uuid, timestamptz) IS
  'Reagenda reuniao de SDR ou Closer com autorizacao, horario comercial e trava concorrente atomica.';

-- Canal sem dados de cliente usado somente para invalidar calendarios de
-- disponibilidade em todos os logins comerciais, inclusive entre SDRs que nao
-- possuem permissao para ler a reuniao criada por outro SDR.
CREATE TABLE IF NOT EXISTS public.seller_agenda_availability_events (
  closer_id uuid PRIMARY KEY REFERENCES public.internal_users(id) ON DELETE CASCADE,
  changed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.seller_agenda_availability_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_agenda_availability_events REPLICA IDENTITY FULL;

REVOKE ALL ON public.seller_agenda_availability_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.seller_agenda_availability_events TO authenticated;

DROP POLICY IF EXISTS "equipe comercial acompanha mudancas de disponibilidade"
  ON public.seller_agenda_availability_events;
CREATE POLICY "equipe comercial acompanha mudancas de disponibilidade"
  ON public.seller_agenda_availability_events
  FOR SELECT
  TO authenticated
  USING (public.internal_user_id(auth.uid()) IS NOT NULL);

CREATE OR REPLACE FUNCTION public.notify_seller_agenda_availability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_closer_id uuid;
  v_new_closer_id uuid;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE')
     AND public.seller_appointment_blocks_availability(OLD.type, OLD.status) THEN
    v_old_closer_id := coalesce(OLD.assigned_closer_id, OLD.seller_id);
    INSERT INTO public.seller_agenda_availability_events (closer_id, changed_at)
    VALUES (v_old_closer_id, now())
    ON CONFLICT (closer_id) DO UPDATE SET changed_at = EXCLUDED.changed_at;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE')
     AND public.seller_appointment_blocks_availability(NEW.type, NEW.status) THEN
    v_new_closer_id := coalesce(NEW.assigned_closer_id, NEW.seller_id);
    INSERT INTO public.seller_agenda_availability_events (closer_id, changed_at)
    VALUES (v_new_closer_id, now())
    ON CONFLICT (closer_id) DO UPDATE SET changed_at = EXCLUDED.changed_at;
  END IF;

  RETURN coalesce(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_seller_agenda_availability
  ON public.seller_appointments;
CREATE TRIGGER trg_notify_seller_agenda_availability
AFTER INSERT OR UPDATE OR DELETE ON public.seller_appointments
FOR EACH ROW
EXECUTE FUNCTION public.notify_seller_agenda_availability();

REVOKE ALL ON FUNCTION public.notify_seller_agenda_availability()
  FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'seller_agenda_availability_events'
     ) THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.seller_agenda_availability_events;
  END IF;
END;
$$;

COMMENT ON TABLE public.seller_agenda_availability_events IS
  'Sinal minimo de invalidacao em tempo real para horarios da agenda comercial; nao contem dados de clientes.';
