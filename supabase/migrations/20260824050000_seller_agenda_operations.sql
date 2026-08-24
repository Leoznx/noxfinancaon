-- Professional seller agenda: real client links, lead follow-up synchronization
-- and compact summary metrics shared by web and mobile.

ALTER TABLE public.seller_appointments
  ADD COLUMN IF NOT EXISTS partnership_id uuid
    REFERENCES public.seller_client_partnerships(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

UPDATE public.seller_appointments
SET source = CASE WHEN meeting_group_id IS NOT NULL THEN 'admin' ELSE 'manual' END
WHERE source IS NULL
   OR source = ''
   OR (meeting_group_id IS NOT NULL AND source = 'manual');

ALTER TABLE public.seller_appointments
  DROP CONSTRAINT IF EXISTS seller_appointments_source_check;

ALTER TABLE public.seller_appointments
  ADD CONSTRAINT seller_appointments_source_check
  CHECK (source IN ('manual', 'admin', 'lead_follow_up'));

CREATE INDEX IF NOT EXISTS seller_appointments_seller_status_scheduled_idx
  ON public.seller_appointments (seller_id, status, scheduled_at);

CREATE INDEX IF NOT EXISTS seller_appointments_seller_type_scheduled_idx
  ON public.seller_appointments (seller_id, type, scheduled_at);

CREATE UNIQUE INDEX IF NOT EXISTS seller_appointments_lead_follow_up_key
  ON public.seller_appointments (lead_id)
  WHERE source = 'lead_follow_up' AND lead_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_seller_appointment_completion_time()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'concluido' THEN
    NEW.completed_at := coalesce(NEW.completed_at, now());
  ELSIF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.completed_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_seller_appointment_completion_time ON public.seller_appointments;
CREATE TRIGGER trg_set_seller_appointment_completion_time
BEFORE INSERT OR UPDATE OF status
ON public.seller_appointments
FOR EACH ROW
EXECUTE FUNCTION public.set_seller_appointment_completion_time();

CREATE OR REPLACE FUNCTION public.sync_sales_lead_to_seller_agenda()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_appointment_status text;
BEGIN
  -- An appointment trigger may update the lead. In that nested call the
  -- appointment already contains the desired state, so do not bounce it back.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.assigned_seller_id IS NOT NULL
     AND NEW.next_action_at IS NOT NULL
     AND lower(coalesce(NEW.status, 'pendente')) NOT IN ('atendido', 'convertido', 'perdido') THEN
    INSERT INTO public.seller_appointments (
      seller_id,
      lead_id,
      title,
      type,
      status,
      priority,
      scheduled_at,
      reminder_minutes,
      notes,
      source
    )
    VALUES (
      NEW.assigned_seller_id,
      NEW.id,
      'Follow-up com ' || coalesce(nullif(trim(NEW.full_name), ''), 'lead'),
      'follow_up',
      'agendado',
      'normal',
      NEW.next_action_at,
      30,
      NEW.notes,
      'lead_follow_up'
    )
    ON CONFLICT (lead_id) WHERE source = 'lead_follow_up' AND lead_id IS NOT NULL
    DO UPDATE SET
      seller_id = EXCLUDED.seller_id,
      title = EXCLUDED.title,
      scheduled_at = EXCLUDED.scheduled_at,
      status = CASE
        WHEN public.seller_appointments.status IN ('concluido', 'cancelado')
          THEN 'agendado'
        ELSE public.seller_appointments.status
      END,
      completed_at = NULL,
      notes = coalesce(EXCLUDED.notes, public.seller_appointments.notes),
      updated_at = now();
  ELSE
    v_appointment_status := CASE
      WHEN lower(coalesce(NEW.status, '')) IN ('atendido', 'convertido') THEN 'concluido'
      ELSE 'cancelado'
    END;

    UPDATE public.seller_appointments
    SET status = v_appointment_status,
        completed_at = CASE WHEN v_appointment_status = 'concluido' THEN coalesce(completed_at, now()) ELSE NULL END,
        updated_at = now()
    WHERE lead_id = NEW.id
      AND source = 'lead_follow_up'
      AND status IS DISTINCT FROM v_appointment_status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_sales_lead_to_seller_agenda ON public.sales_leads;
CREATE TRIGGER trg_sync_sales_lead_to_seller_agenda
AFTER INSERT OR UPDATE OF assigned_seller_id, next_action_at, status, full_name, notes
ON public.sales_leads
FOR EACH ROW
EXECUTE FUNCTION public.sync_sales_lead_to_seller_agenda();

CREATE OR REPLACE FUNCTION public.sync_seller_agenda_to_sales_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.source <> 'lead_follow_up' OR NEW.lead_id IS NULL OR pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'concluido' THEN
    UPDATE public.lead_followups
    SET status_followup = 'realizado',
        realizado_em = coalesce(realizado_em, now()),
        observacao = coalesce(nullif(trim(NEW.notes), ''), observacao),
        updated_at = now()
    WHERE lead_id = NEW.lead_id
      AND status_followup = 'pendente';

    UPDATE public.sales_leads
    SET status = 'atendido',
        next_action_at = NULL,
        last_followup_at = now(),
        notes = coalesce(nullif(trim(NEW.notes), ''), notes)
    WHERE id = NEW.lead_id;
  ELSIF NEW.status = 'cancelado' THEN
    UPDATE public.lead_followups
    SET status_followup = 'cancelado',
        observacao = coalesce(nullif(trim(NEW.notes), ''), observacao),
        updated_at = now()
    WHERE lead_id = NEW.lead_id
      AND status_followup = 'pendente';

    UPDATE public.sales_leads
    SET next_action_at = NULL,
        notes = coalesce(nullif(trim(NEW.notes), ''), notes)
    WHERE id = NEW.lead_id;
  ELSE
    UPDATE public.sales_leads
    SET next_action_at = NEW.scheduled_at,
        status = CASE
          WHEN status IN ('pendente', 'novo', 'sem_resposta') THEN 'em_atendimento'
          ELSE status
        END,
        notes = coalesce(nullif(trim(NEW.notes), ''), notes)
    WHERE id = NEW.lead_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_seller_agenda_to_sales_lead ON public.seller_appointments;
CREATE TRIGGER trg_sync_seller_agenda_to_sales_lead
AFTER UPDATE OF scheduled_at, status, notes
ON public.seller_appointments
FOR EACH ROW
EXECUTE FUNCTION public.sync_seller_agenda_to_sales_lead();

CREATE OR REPLACE FUNCTION public.clear_sales_lead_follow_up_after_agenda_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.source = 'lead_follow_up' AND OLD.lead_id IS NOT NULL THEN
    UPDATE public.lead_followups
    SET status_followup = 'cancelado',
        updated_at = now()
    WHERE lead_id = OLD.lead_id
      AND status_followup = 'pendente';

    UPDATE public.sales_leads
    SET next_action_at = NULL
    WHERE id = OLD.lead_id;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_sales_lead_follow_up_after_agenda_delete ON public.seller_appointments;
CREATE TRIGGER trg_clear_sales_lead_follow_up_after_agenda_delete
AFTER DELETE ON public.seller_appointments
FOR EACH ROW
EXECUTE FUNCTION public.clear_sales_lead_follow_up_after_agenda_delete();

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
      SELECT count(*)
      FROM public.seller_appointments AS appointment
      WHERE appointment.seller_id = v_seller_id
        AND appointment.scheduled_at >= v_today_start
        AND appointment.scheduled_at < v_today_start + interval '1 day'
        AND appointment.status <> 'cancelado'
    ),
    'this_week', (
      SELECT count(*)
      FROM public.seller_appointments AS appointment
      WHERE appointment.seller_id = v_seller_id
        AND appointment.scheduled_at >= v_week_start
        AND appointment.scheduled_at < v_week_start + interval '7 days'
        AND appointment.status <> 'cancelado'
    ),
    'pending_followups', (
      SELECT count(*)
      FROM public.seller_appointments AS appointment
      WHERE appointment.seller_id = v_seller_id
        AND appointment.type = 'follow_up'
        AND appointment.status NOT IN ('concluido', 'cancelado')
    ),
    'scheduled_meetings', (
      SELECT count(*)
      FROM public.seller_appointments AS appointment
      WHERE appointment.seller_id = v_seller_id
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

-- Backfill the current pending follow-up of every assigned lead. Historical
-- lead_followups remain in their original audit table and are not duplicated.
INSERT INTO public.seller_appointments (
  seller_id,
  lead_id,
  title,
  type,
  status,
  priority,
  scheduled_at,
  reminder_minutes,
  notes,
  source
)
SELECT
  lead.assigned_seller_id,
  lead.id,
  'Follow-up com ' || coalesce(nullif(trim(lead.full_name), ''), 'lead'),
  'follow_up',
  'agendado',
  'normal',
  lead.next_action_at,
  30,
  lead.notes,
  'lead_follow_up'
FROM public.sales_leads AS lead
WHERE lead.assigned_seller_id IS NOT NULL
  AND lead.next_action_at IS NOT NULL
  AND lower(coalesce(lead.status, 'pendente')) NOT IN ('atendido', 'convertido', 'perdido')
ON CONFLICT (lead_id) WHERE source = 'lead_follow_up' AND lead_id IS NOT NULL
DO UPDATE SET
  seller_id = EXCLUDED.seller_id,
  title = EXCLUDED.title,
  scheduled_at = EXCLUDED.scheduled_at,
  notes = coalesce(EXCLUDED.notes, public.seller_appointments.notes),
  updated_at = now();

COMMENT ON COLUMN public.seller_appointments.partnership_id IS
  'Cliente parceiro real vinculado ao compromisso do vendedor.';
COMMENT ON COLUMN public.seller_appointments.source IS
  'Origem do compromisso: manual, agenda administrativa ou follow-up sincronizado do lead.';
COMMENT ON FUNCTION public.get_my_seller_agenda_summary() IS
  'Indicadores operacionais reais da agenda do vendedor autenticado.';
