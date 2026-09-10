-- Garante que toda reuniao futura criada por um SDR seja entregue a um Closer
-- disponivel, inclusive quando um cliente antigo ainda usa o formulario manual.
-- Tambem abre um tipo idempotente de entrega (0 minutos) para a confirmacao
-- imediata por e-mail e corrige reunioes futuras que ficaram orfas.

ALTER TABLE public.seller_appointments
  ADD COLUMN IF NOT EXISTS creation_notified_at timestamptz;

ALTER TABLE public.seller_meeting_reminder_deliveries
  DROP CONSTRAINT IF EXISTS seller_meeting_reminder_deliveries_minutes_before_check;

ALTER TABLE public.seller_meeting_reminder_deliveries
  ADD CONSTRAINT seller_meeting_reminder_deliveries_minutes_before_check
  CHECK (minutes_before IN (0, 30, 5));

-- Reunioes que ja estavam corretamente compartilhadas nao devem receber uma
-- confirmacao retroativa duplicada. A reuniao orfa corrigida mais abaixo muda
-- de manual para sdr_handoff depois deste marco e permanece pendente de envio.
UPDATE public.seller_appointments
SET creation_notified_at = coalesce(creation_notified_at, now())
WHERE source = 'sdr_handoff'
  AND creation_notified_at IS NULL;

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
  -- Uma remarcacao precisa gerar uma nova confirmacao com a data atualizada.
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
        AND busy.status NOT IN ('cancelado', 'concluido', 'nao_compareceu')
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
        AND upcoming.status NOT IN ('cancelado', 'concluido', 'nao_compareceu')
        AND upcoming.scheduled_at >= now()
    ),
    (
      SELECT count(*)
      FROM public.seller_appointments AS day_meeting
      WHERE coalesce(day_meeting.assigned_closer_id, day_meeting.seller_id) = closer.id
        AND (v_ignored_id IS NULL OR day_meeting.id <> v_ignored_id)
        AND (day_meeting.scheduled_at AT TIME ZONE 'America/Sao_Paulo')::date =
            (NEW.scheduled_at AT TIME ZONE 'America/Sao_Paulo')::date
        AND day_meeting.status NOT IN ('cancelado', 'nao_compareceu')
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

DROP TRIGGER IF EXISTS trg_prepare_sdr_closer_meeting ON public.seller_appointments;
CREATE TRIGGER trg_prepare_sdr_closer_meeting
BEFORE INSERT OR UPDATE ON public.seller_appointments
FOR EACH ROW
EXECUTE FUNCTION public.prepare_sdr_closer_meeting();

REVOKE ALL ON FUNCTION public.prepare_sdr_closer_meeting() FROM PUBLIC, anon, authenticated;

-- Reprocessa somente reunioes futuras e manuais de SDR que ainda nao possuem
-- Closer. Falhas pontuais ficam registradas como aviso sem impedir o deploy.
DO $$
DECLARE
  v_appointment_id uuid;
BEGIN
  FOR v_appointment_id IN
    SELECT appointment.id
    FROM public.seller_appointments AS appointment
    JOIN public.internal_users AS seller ON seller.id = appointment.seller_id
    WHERE appointment.scheduled_at > now()
      AND appointment.type = 'reuniao'
      AND coalesce(appointment.source, 'manual') = 'manual'
      AND appointment.assigned_closer_id IS NULL
      AND seller.role = 'vendedor'
      AND seller.seller_type = 'sdr'
      AND seller.status = 'ativo'
    ORDER BY appointment.scheduled_at
  LOOP
    BEGIN
      UPDATE public.seller_appointments
      SET updated_at = now()
      WHERE id = v_appointment_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Nao foi possivel distribuir a reuniao %: %', v_appointment_id, SQLERRM;
    END;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_seller_agenda_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_id uuid;
  v_now_local timestamp := now() AT TIME ZONE 'America/Sao_Paulo';
  v_today_start timestamptz;
  v_week_start timestamptz;
  v_month_start timestamptz;
BEGIN
  SELECT internal_user.id
  INTO v_seller_id
  FROM public.internal_users AS internal_user
  WHERE internal_user.auth_user_id = auth.uid()
    AND internal_user.role = 'vendedor'
    AND internal_user.status = 'ativo'
  LIMIT 1;

  IF v_seller_id IS NULL THEN
    RAISE EXCEPTION 'Somente vendedores ativos podem consultar esta agenda.';
  END IF;

  v_today_start := date_trunc('day', v_now_local) AT TIME ZONE 'America/Sao_Paulo';
  v_week_start := date_trunc('week', v_now_local) AT TIME ZONE 'America/Sao_Paulo';
  v_month_start := date_trunc('month', v_now_local) AT TIME ZONE 'America/Sao_Paulo';

  RETURN jsonb_build_object(
    'today', (
      SELECT count(*) FROM public.seller_appointments AS appointment
      WHERE v_seller_id IN (appointment.seller_id, appointment.sdr_id, appointment.assigned_closer_id)
        AND appointment.scheduled_at >= v_today_start
        AND appointment.scheduled_at < v_today_start + interval '1 day'
        AND appointment.status <> 'cancelado'
    ),
    'this_week', (
      SELECT count(*) FROM public.seller_appointments AS appointment
      WHERE v_seller_id IN (appointment.seller_id, appointment.sdr_id, appointment.assigned_closer_id)
        AND appointment.scheduled_at >= v_week_start
        AND appointment.scheduled_at < v_week_start + interval '7 days'
        AND appointment.status <> 'cancelado'
    ),
    'pending_followups', (
      SELECT count(*) FROM public.seller_appointments AS appointment
      WHERE v_seller_id IN (appointment.seller_id, appointment.sdr_id, appointment.assigned_closer_id)
        AND appointment.type = 'follow_up'
        AND appointment.status NOT IN ('concluido', 'cancelado')
    ),
    'scheduled_meetings', (
      SELECT count(*) FROM public.seller_appointments AS appointment
      WHERE v_seller_id IN (appointment.seller_id, appointment.sdr_id, appointment.assigned_closer_id)
        AND appointment.type = 'reuniao'
        AND appointment.scheduled_at >= v_month_start
        AND appointment.scheduled_at < v_month_start + interval '1 month'
        AND appointment.status NOT IN ('concluido', 'cancelado')
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_seller_agenda_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_seller_agenda_summary() TO authenticated;

COMMENT ON COLUMN public.seller_appointments.creation_notified_at IS
  'Momento em que SDR e Closer receberam as confirmacoes de criacao da reuniao.';
COMMENT ON FUNCTION public.prepare_sdr_closer_meeting() IS
  'Impede reunioes futuras de SDR sem Closer e reinicia a notificacao quando houver remarcacao.';
