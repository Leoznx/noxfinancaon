-- Meetings can end before the reserved slot. Only the responsible Closer may
-- complete them, and the real end time/duration are persisted for both clients.

ALTER TABLE public.seller_appointments
  ADD COLUMN IF NOT EXISTS actual_duration_minutes integer;

ALTER TABLE public.seller_appointments
  DROP CONSTRAINT IF EXISTS seller_appointments_actual_duration_check;

ALTER TABLE public.seller_appointments
  ADD CONSTRAINT seller_appointments_actual_duration_check
  CHECK (actual_duration_minutes IS NULL OR actual_duration_minutes >= 1);

CREATE OR REPLACE FUNCTION public.seller_meeting_actual_duration_minutes(
  p_scheduled_at timestamptz,
  p_completed_at timestamptz
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
  SELECT greatest(
    1,
    ceil(greatest(0, extract(epoch FROM (p_completed_at - p_scheduled_at))) / 60.0)::integer
  );
$$;

UPDATE public.seller_appointments
SET actual_duration_minutes = public.seller_meeting_actual_duration_minutes(
      scheduled_at,
      completed_at
    )
WHERE type = 'reuniao'
  AND status = 'concluido'
  AND completed_at IS NOT NULL
  AND actual_duration_minutes IS NULL;

CREATE OR REPLACE FUNCTION public.enforce_closer_meeting_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid;
  v_actor_type text;
BEGIN
  IF NEW.type <> 'reuniao'
     OR NEW.status <> 'concluido'
     OR (TG_OP = 'UPDATE' AND OLD.status = 'concluido') THEN
    RETURN NEW;
  END IF;

  -- SQL migrations and service jobs have no authenticated user. Interactive
  -- clients must always be the active Closer assigned to this meeting.
  IF auth.uid() IS NOT NULL THEN
    SELECT seller.id, seller.seller_type
    INTO v_actor_id, v_actor_type
    FROM public.internal_users AS seller
    WHERE seller.auth_user_id = auth.uid()
      AND seller.role = 'vendedor'
      AND seller.status = 'ativo'
    LIMIT 1;

    IF v_actor_type IS DISTINCT FROM 'closer'
       OR v_actor_id IS DISTINCT FROM coalesce(NEW.assigned_closer_id, NEW.seller_id) THEN
      RAISE EXCEPTION 'Somente o Closer responsavel pode concluir esta reuniao.';
    END IF;

    IF clock_timestamp() < NEW.scheduled_at THEN
      RAISE EXCEPTION 'A reuniao pode ser concluida a partir do horario de inicio.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_00_enforce_closer_meeting_completion
  ON public.seller_appointments;
CREATE TRIGGER trg_00_enforce_closer_meeting_completion
BEFORE INSERT OR UPDATE OF status
ON public.seller_appointments
FOR EACH ROW
EXECUTE FUNCTION public.enforce_closer_meeting_completion();

CREATE OR REPLACE FUNCTION public.set_seller_appointment_completion_time()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'concluido' THEN
    IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'concluido' THEN
      NEW.completed_at := coalesce(NEW.completed_at, clock_timestamp());
      NEW.actual_duration_minutes := CASE
        WHEN NEW.type = 'reuniao' THEN public.seller_meeting_actual_duration_minutes(
          NEW.scheduled_at,
          NEW.completed_at
        )
        ELSE NULL
      END;
    END IF;
  ELSIF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.completed_at := NULL;
    NEW.actual_duration_minutes := NULL;
  END IF;

  RETURN NEW;
END;
$$;

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
  v_completed_at timestamptz;
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
  IF v_meeting.status = 'concluido' THEN
    RAISE EXCEPTION 'Esta reuniao ja foi concluida.';
  END IF;

  v_completed_at := clock_timestamp();
  IF v_completed_at < v_meeting.scheduled_at THEN
    RAISE EXCEPTION 'A reuniao pode ser concluida a partir do horario de inicio.';
  END IF;
  IF length(trim(coalesce(p_feedback, ''))) < 10 THEN
    RAISE EXCEPTION 'Descreva o resultado da reuniao com pelo menos 10 caracteres.';
  END IF;

  UPDATE public.seller_appointments
  SET meeting_feedback = trim(p_feedback),
      feedback_submitted_at = v_completed_at,
      completed_at = v_completed_at,
      actual_duration_minutes = public.seller_meeting_actual_duration_minutes(
        v_meeting.scheduled_at,
        v_completed_at
      ),
      status = 'concluido'
  WHERE id = v_meeting.id
  RETURNING * INTO v_meeting;

  RETURN v_meeting;
END;
$$;

REVOKE ALL ON FUNCTION public.seller_meeting_actual_duration_minutes(timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_closer_meeting_completion()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_closer_meeting(uuid, text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.seller_meeting_actual_duration_minutes(timestamptz, timestamptz)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_closer_meeting(uuid, text)
  TO authenticated;

COMMENT ON COLUMN public.seller_appointments.actual_duration_minutes IS
  'Duracao efetiva entre o inicio agendado e a conclusao registrada pelo Closer.';
COMMENT ON FUNCTION public.complete_closer_meeting(uuid, text) IS
  'Conclui a reuniao pelo Closer responsavel a partir do inicio, registrando termino e duracao reais.';
