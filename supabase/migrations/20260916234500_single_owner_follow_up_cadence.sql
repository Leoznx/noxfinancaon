-- Cada reuniao concluida gera uma unica cadencia, pertencente a quem originou
-- o agendamento: SDR quando houve handoff, ou Closer quando foi agendada
-- diretamente por ele. Os compromissos existentes nao sao alterados.

DROP TRIGGER IF EXISTS trg_create_next_sdr_recurring_follow_up
  ON public.seller_appointments;

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
  v_business_date date;
  v_scheduled_at timestamptz;
  v_visible_from timestamptz;
  v_partnership_id uuid;
BEGIN
  IF p_owner_id IS NULL
     OR p_owner_type NOT IN ('sdr', 'closer')
     OR p_offset_days NOT IN (1, 4, 15, 30) THEN
    RETURN;
  END IF;

  v_business_date := public.next_seller_business_day(v_date);
  v_scheduled_at := (v_business_date + time '10:00')
    AT TIME ZONE 'America/Sao_Paulo';
  v_visible_from := ((v_business_date - 1) + time '10:00')
    AT TIME ZONE 'America/Sao_Paulo';
  v_key := 'cadence_' || p_offset_days::text || 'd';
  v_title := 'Follow-up ' || p_offset_days::text
    || CASE WHEN p_offset_days = 1 THEN ' dia — ' ELSE ' dias — ' END
    || coalesce(
      nullif(trim(p_origin.contact_name), ''),
      nullif(trim(p_origin.title), ''),
      'Cliente'
    );

  IF p_origin.tracked_profile_id IS NOT NULL THEN
    SELECT partnership.id
    INTO v_partnership_id
    FROM public.seller_client_partnerships AS partnership
    WHERE partnership.seller_id = p_owner_id
      AND partnership.client_profile_id = p_origin.tracked_profile_id
    LIMIT 1;
  ELSIF p_owner_id = p_origin.seller_id THEN
    v_partnership_id := p_origin.partnership_id;
  END IF;

  INSERT INTO public.seller_appointments (
    seller_id, lead_id, partnership_id, title, type, status, priority,
    scheduled_at, reminder_minutes, notes, source, duration_minutes,
    contact_name, contact_email, contact_phone, origin_appointment_id,
    follow_up_offset_days, follow_up_owner_type, follow_up_message_key,
    tracked_profile_id, visible_from
  ) VALUES (
    p_owner_id, p_origin.lead_id, v_partnership_id, v_title,
    'follow_up', 'agendado', 'normal', v_scheduled_at, 30,
    'Follow-up criado automaticamente a partir da reuniao concluida.',
    'meeting_follow_up', 20, p_origin.contact_name, p_origin.contact_email,
    p_origin.contact_phone, p_origin.id, p_offset_days, p_owner_type, v_key,
    p_origin.tracked_profile_id, v_visible_from
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
  v_owner_id uuid;
  v_owner_type text;
  v_registered_type text;
  v_offset integer;
BEGIN
  IF NEW.type <> 'reuniao' OR NEW.status <> 'concluido' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'concluido' THEN
    RETURN NEW;
  END IF;

  IF NEW.sdr_id IS NOT NULL THEN
    v_owner_id := NEW.sdr_id;
    v_owner_type := 'sdr';
  ELSE
    v_owner_id := coalesce(NEW.assigned_closer_id, NEW.seller_id);
    v_owner_type := 'closer';
  END IF;

  SELECT seller.seller_type
  INTO v_registered_type
  FROM public.internal_users AS seller
  WHERE seller.id = v_owner_id
    AND seller.role = 'vendedor'
    AND seller.status = 'ativo';

  IF v_registered_type IS DISTINCT FROM v_owner_type THEN
    RETURN NEW;
  END IF;

  FOREACH v_offset IN ARRAY ARRAY[1, 4, 15, 30]
  LOOP
    PERFORM public.insert_seller_meeting_follow_up(
      NEW,
      v_owner_id,
      v_owner_type,
      v_offset
    );
  END LOOP;

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

REVOKE ALL ON FUNCTION public.insert_seller_meeting_follow_up(
  public.seller_appointments, uuid, text, integer, date
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_seller_meeting_follow_up_reminders()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.create_seller_meeting_follow_up_reminders() IS
  'Cria follow-ups de 1, 4, 15 e 30 dias as 10h somente para o SDR originador ou, sem SDR, para o Closer.';
COMMENT ON COLUMN public.seller_appointments.follow_up_owner_type IS
  'Responsavel exclusivo pelo follow-up automatico: SDR originador ou Closer de reuniao direta.';
