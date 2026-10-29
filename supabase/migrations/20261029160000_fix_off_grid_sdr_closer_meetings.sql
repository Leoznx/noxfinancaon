-- Compatibilidade para reunioes SDR -> Closer criadas por clientes antigos ou
-- pelo formulario manual em minutos fora da grade oficial (:00/:30).
--
-- A agenda compartilhada continua oferecendo slots de 30 em 30 minutos. Este
-- fallback somente garante que uma reuniao futura valida, por exemplo 14:15 ou
-- 16:40, nao fique presa na agenda do SDR: o minuto exato e preservado e um
-- Closer livre e atribuido de forma atomica.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_seller_manual_shared_start_within_business_hours(
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
    p_slot_start IS NOT NULL
    AND p_duration_minutes = 30
    AND extract(isodow FROM starts_at) BETWEEN 1 AND 5
    AND extract(second FROM starts_at) = 0
    AND (
      (
        starts_at::time >= time '08:00'
        AND starts_at::time <= time '11:30'
        AND ends_at::time <= time '12:00'
      )
      OR (
        starts_at::time >= time '13:00'
        AND starts_at::time <= time '17:30'
        AND ends_at::time <= time '18:00'
      )
    )
  FROM local_slot;
$$;

REVOKE ALL ON FUNCTION public.is_seller_manual_shared_start_within_business_hours(timestamptz, integer)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.is_seller_manual_shared_start_within_business_hours(timestamptz, integer) IS
  'Valida o fallback de reunioes SDR -> Closer com minuto exato, sem limitar o inicio a :00 ou :30.';

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
     OR coalesce(NEW.source, 'manual') NOT IN ('manual', 'sdr_handoff')
     OR NEW.assigned_closer_id IS NOT NULL
     OR NEW.scheduled_at <= now() THEN
    RETURN NEW;
  END IF;

  -- No formulario manual o SDR ainda e o dono da linha. Em uma linha de
  -- handoff parcialmente gravada, recuperamos o SDR pela coluna de origem.
  SELECT seller.id
  INTO v_sdr_id
  FROM public.internal_users AS seller
  WHERE seller.id = CASE
          WHEN coalesce(NEW.source, 'manual') = 'sdr_handoff'
            THEN coalesce(NEW.sdr_id, NEW.seller_id)
          ELSE NEW.seller_id
        END
    AND seller.role = 'vendedor'
    AND seller.seller_type = 'sdr'
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_sdr_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_seller_manual_shared_start_within_business_hours(NEW.scheduled_at, 30) THEN
    RAISE EXCEPTION 'Escolha um horario comercial: seg-sex 08:00-11:30 e 13:00-17:30.';
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

-- Reprocessa reunioes futuras orfas. Cada UPDATE passa pelo trigger acima; a
-- excecao de uma linha nao impede a publicacao das demais.
DO $$
DECLARE
  v_appointment_id uuid;
BEGIN
  FOR v_appointment_id IN
    SELECT appointment.id
    FROM public.seller_appointments AS appointment
    LEFT JOIN public.internal_users AS owner ON owner.id = appointment.seller_id
    LEFT JOIN public.internal_users AS origin_sdr ON origin_sdr.id = appointment.sdr_id
    WHERE appointment.scheduled_at > now()
      AND appointment.type = 'reuniao'
      AND appointment.assigned_closer_id IS NULL
      AND coalesce(appointment.source, 'manual') IN ('manual', 'sdr_handoff')
      AND (
        (
          coalesce(appointment.source, 'manual') = 'manual'
          AND owner.role = 'vendedor'
          AND owner.seller_type = 'sdr'
          AND owner.status = 'ativo'
        )
        OR (
          appointment.source = 'sdr_handoff'
          AND origin_sdr.role = 'vendedor'
          AND origin_sdr.seller_type = 'sdr'
          AND origin_sdr.status = 'ativo'
        )
      )
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

COMMENT ON FUNCTION public.prepare_sdr_closer_meeting() IS
  'Entrega reunioes futuras do SDR ao Closer livre, inclusive em minutos fora da grade oficial.';

COMMIT;
