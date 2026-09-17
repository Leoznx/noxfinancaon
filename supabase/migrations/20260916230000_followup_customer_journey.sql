-- Liga o envio do link de uma reuniao ao cadastro resultante e acompanha a
-- jornada comercial nos follow-ups de SDR e Closer. O banco e compartilhado
-- pelos clientes web e mobile.

ALTER TABLE public.seller_appointments
  ADD COLUMN IF NOT EXISTS tracked_profile_id uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS visible_from timestamptz,
  ADD COLUMN IF NOT EXISTS journey_test_status text;

ALTER TABLE public.seller_appointments
  DROP CONSTRAINT IF EXISTS seller_appointments_journey_test_status_check;
ALTER TABLE public.seller_appointments
  ADD CONSTRAINT seller_appointments_journey_test_status_check
  CHECK (
    journey_test_status IS NULL
    OR journey_test_status IN (
      'no_consultations',
      'consultation_in_progress',
      'contract_closed'
    )
  );

ALTER TABLE public.seller_signup_link_send_events
  ADD COLUMN IF NOT EXISTS appointment_id uuid
    REFERENCES public.seller_appointments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_profile_id uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

CREATE INDEX IF NOT EXISTS seller_signup_link_send_events_appointment_idx
  ON public.seller_signup_link_send_events (appointment_id, created_at DESC)
  WHERE appointment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS seller_appointments_tracked_profile_idx
  ON public.seller_appointments (tracked_profile_id)
  WHERE tracked_profile_id IS NOT NULL;

UPDATE public.seller_appointments
SET visible_from = (
  ((scheduled_at AT TIME ZONE 'America/Sao_Paulo')::date - 1) + time '10:00'
) AT TIME ZONE 'America/Sao_Paulo'
WHERE source = 'meeting_follow_up'
  AND visible_from IS NULL;

CREATE OR REPLACE FUNCTION public.record_meeting_signup_link_send(
  p_appointment_id uuid,
  p_token text,
  p_profile_role text,
  p_channel text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_closer_id uuid;
  v_meeting public.seller_appointments%ROWTYPE;
  v_link public.seller_signup_links%ROWTYPE;
  v_event_id uuid;
BEGIN
  IF p_profile_role NOT IN ('proprietario', 'imobiliaria', 'corretor') THEN
    RAISE EXCEPTION 'Perfil de cadastro invalido.';
  END IF;
  IF p_channel NOT IN ('copy', 'whatsapp', 'share') THEN
    RAISE EXCEPTION 'Canal de envio invalido.';
  END IF;

  SELECT seller.id
  INTO v_closer_id
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid()
    AND seller.role = 'vendedor'
    AND seller.seller_type = 'closer'
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_closer_id IS NULL THEN
    RAISE EXCEPTION 'Somente Closers ativos podem enviar o link desta reuniao.';
  END IF;

  SELECT appointment.*
  INTO v_meeting
  FROM public.seller_appointments AS appointment
  WHERE appointment.id = p_appointment_id
    AND appointment.type = 'reuniao'
    AND coalesce(appointment.assigned_closer_id, appointment.seller_id) = v_closer_id;

  IF v_meeting.id IS NULL THEN
    RAISE EXCEPTION 'Reuniao nao encontrada na agenda deste Closer.';
  END IF;

  SELECT link.*
  INTO v_link
  FROM public.seller_signup_links AS link
  WHERE link.token = trim(p_token)
    AND link.profile_role = p_profile_role
    AND link.seller_id = v_closer_id
    AND link.source_sdr_id IS NOT DISTINCT FROM v_meeting.sdr_id
    AND link.active
  LIMIT 1;

  IF v_link.id IS NULL THEN
    RAISE EXCEPTION 'O link informado nao pertence a esta reuniao.';
  END IF;

  INSERT INTO public.seller_signup_link_send_events (
    link_id,
    seller_id,
    source_sdr_id,
    profile_role,
    channel,
    appointment_id
  ) VALUES (
    v_link.id,
    v_link.seller_id,
    v_link.source_sdr_id,
    v_link.profile_role,
    p_channel,
    v_meeting.id
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_seller_signup_link_for_meeting(
  p_appointment_id uuid,
  p_token text,
  p_profile_id uuid,
  p_profile_role text,
  p_email text,
  p_display_name text
)
RETURNS TABLE (
  recipient_email text,
  recipient_name text,
  credited_seller_type text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_meeting public.seller_appointments%ROWTYPE;
  v_event public.seller_signup_link_send_events%ROWTYPE;
  v_closer_id uuid;
  v_closer_partnership_id uuid;
  v_sdr_partnership_id uuid;
BEGIN
  SELECT appointment.*
  INTO v_meeting
  FROM public.seller_appointments AS appointment
  WHERE appointment.id = p_appointment_id
    AND appointment.type = 'reuniao'
  FOR UPDATE;

  IF v_meeting.id IS NULL THEN
    RAISE EXCEPTION 'Reuniao de origem nao encontrada.';
  END IF;

  v_closer_id := coalesce(v_meeting.assigned_closer_id, v_meeting.seller_id);

  SELECT event.*
  INTO v_event
  FROM public.seller_signup_link_send_events AS event
  JOIN public.seller_signup_links AS link ON link.id = event.link_id
  WHERE event.appointment_id = v_meeting.id
    AND link.token = trim(p_token)
    AND event.profile_role = p_profile_role
    AND event.seller_id = v_closer_id
    AND event.source_sdr_id IS NOT DISTINCT FROM v_meeting.sdr_id
  ORDER BY event.created_at DESC
  LIMIT 1
  FOR UPDATE OF event;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'Este link nao foi enviado pela reuniao informada.';
  END IF;
  IF v_event.claimed_profile_id IS NOT NULL
     AND v_event.claimed_profile_id <> p_profile_id THEN
    RAISE EXCEPTION 'Este envio ja foi vinculado a outro cadastro.';
  END IF;

  RETURN QUERY
  SELECT claimed.recipient_email, claimed.recipient_name, claimed.credited_seller_type
  FROM public.claim_seller_signup_link(
    p_token,
    p_profile_id,
    p_profile_role,
    p_email,
    p_display_name
  ) AS claimed;

  v_closer_partnership_id := public.ensure_seller_signup_partnership(
    v_closer_id,
    p_profile_id,
    p_profile_role,
    p_email
  );

  IF v_meeting.sdr_id IS NOT NULL THEN
    v_sdr_partnership_id := public.ensure_seller_signup_partnership(
      v_meeting.sdr_id,
      p_profile_id,
      p_profile_role,
      p_email
    );
  END IF;

  UPDATE public.seller_signup_link_send_events
  SET claimed_profile_id = p_profile_id,
      claimed_at = coalesce(claimed_at, now())
  WHERE appointment_id = v_meeting.id
    AND link_id = v_event.link_id
    AND claimed_profile_id IS NULL;

  UPDATE public.seller_appointments
  SET tracked_profile_id = p_profile_id,
      partnership_id = coalesce(v_closer_partnership_id, partnership_id),
      updated_at = now()
  WHERE id = v_meeting.id;

  UPDATE public.seller_appointments
  SET tracked_profile_id = p_profile_id,
      partnership_id = CASE follow_up_owner_type
        WHEN 'sdr' THEN coalesce(v_sdr_partnership_id, partnership_id)
        ELSE coalesce(v_closer_partnership_id, partnership_id)
      END,
      updated_at = now()
  WHERE origin_appointment_id = v_meeting.id
    AND source = 'meeting_follow_up';
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_meeting_signup_link(
  p_appointment_id uuid,
  p_token text,
  p_profile_role text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.seller_signup_link_send_events AS event
    JOIN public.seller_signup_links AS link ON link.id = event.link_id
    JOIN public.seller_appointments AS appointment ON appointment.id = event.appointment_id
    WHERE event.appointment_id = p_appointment_id
      AND link.token = trim(p_token)
      AND event.profile_role = p_profile_role
      AND link.active
      AND appointment.type = 'reuniao'
      AND coalesce(appointment.assigned_closer_id, appointment.seller_id) = event.seller_id
      AND appointment.sdr_id IS NOT DISTINCT FROM event.source_sdr_id
  );
$$;

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
  v_scheduled_at timestamptz;
  v_visible_from timestamptz;
  v_partnership_id uuid;
BEGIN
  IF p_owner_id IS NULL OR p_owner_type NOT IN ('sdr', 'closer') THEN
    RETURN;
  END IF;

  v_key := CASE
    WHEN p_owner_type = 'closer' AND p_offset_days = 1 THEN 'closer_24h'
    WHEN p_owner_type = 'closer' AND p_offset_days = 3 THEN 'closer_3d'
    WHEN p_owner_type = 'sdr' AND p_offset_days = 2 THEN 'sdr_48h'
    WHEN p_owner_type = 'sdr' AND p_offset_days = 5 THEN 'sdr_5d'
    ELSE 'sdr_27d'
  END;

  v_title := CASE v_key
    WHEN 'closer_24h' THEN 'Follow-up Closer 24h — '
    WHEN 'closer_3d' THEN 'Follow-up Closer 3 dias — '
    WHEN 'sdr_48h' THEN 'Follow-up SDR 48h — '
    WHEN 'sdr_5d' THEN 'Follow-up SDR 5 dias — '
    ELSE 'Follow-up SDR 27 dias — '
  END || coalesce(nullif(trim(p_origin.contact_name), ''), nullif(trim(p_origin.title), ''), 'Cliente');

  v_scheduled_at := public.allocate_seller_follow_up_at(
    p_owner_id,
    v_date,
    p_origin.id::text || ':' || p_owner_type || ':' || p_offset_days::text
  );
  v_visible_from := (
    ((v_scheduled_at AT TIME ZONE 'America/Sao_Paulo')::date - 1) + time '10:00'
  ) AT TIME ZONE 'America/Sao_Paulo';

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

CREATE OR REPLACE FUNCTION public.protect_required_seller_follow_up()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL
     OR auth.role() = 'service_role'
     OR public.is_admin(auth.uid())
     OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF OLD.source <> 'meeting_follow_up' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Este follow-up e obrigatorio e deve ser marcado como concluido.';
  END IF;

  IF OLD.status = 'concluido' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Um follow-up obrigatorio concluido nao pode ser reaberto ou cancelado.';
  END IF;

  IF OLD.status <> 'concluido' AND NEW.status <> 'concluido' THEN
    RAISE EXCEPTION 'Este follow-up automatico nao pode ser editado ou cancelado; marque-o como concluido.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_seller_follow_up_journeys(p_profile_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.seller_appointments AS appointment
  SET updated_at = now()
  WHERE appointment.source = 'meeting_follow_up'
    AND (
      appointment.tracked_profile_id = p_profile_id
      OR EXISTS (
        SELECT 1
        FROM public.seller_client_partnerships AS partnership
        JOIN public.corretores AS broker
          ON broker.imobiliaria_id = partnership.imobiliaria_id
        WHERE partnership.id = appointment.partnership_id
          AND broker.profile_id = p_profile_id
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.notify_seller_follow_up_journey_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_profile_id uuid;
  v_new_profile_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'consultas_credito' THEN
    IF TG_OP <> 'INSERT' THEN v_old_profile_id := OLD.profile_id_solicitante; END IF;
    IF TG_OP <> 'DELETE' THEN v_new_profile_id := NEW.profile_id_solicitante; END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN
      SELECT credit.profile_id_solicitante INTO v_old_profile_id
      FROM public.consultas_credito AS credit
      WHERE credit.id = OLD.consulta_id;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      SELECT credit.profile_id_solicitante INTO v_new_profile_id
      FROM public.consultas_credito AS credit
      WHERE credit.id = NEW.consulta_id;
    END IF;
  END IF;

  IF v_old_profile_id IS NOT NULL THEN
    PERFORM public.touch_seller_follow_up_journeys(v_old_profile_id);
  END IF;
  IF v_new_profile_id IS NOT NULL AND v_new_profile_id IS DISTINCT FROM v_old_profile_id THEN
    PERFORM public.touch_seller_follow_up_journeys(v_new_profile_id);
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_seller_follow_up_credit_change
  ON public.consultas_credito;
CREATE TRIGGER trg_notify_seller_follow_up_credit_change
AFTER INSERT OR UPDATE OR DELETE
ON public.consultas_credito
FOR EACH ROW
EXECUTE FUNCTION public.notify_seller_follow_up_journey_change();

DROP TRIGGER IF EXISTS trg_notify_seller_follow_up_contract_change
  ON public.apolices;
CREATE TRIGGER trg_notify_seller_follow_up_contract_change
AFTER INSERT OR UPDATE OR DELETE
ON public.apolices
FOR EACH ROW
EXECUTE FUNCTION public.notify_seller_follow_up_journey_change();

DROP TRIGGER IF EXISTS trg_protect_required_seller_follow_up
  ON public.seller_appointments;
CREATE TRIGGER trg_protect_required_seller_follow_up
BEFORE UPDATE OR DELETE
ON public.seller_appointments
FOR EACH ROW
EXECUTE FUNCTION public.protect_required_seller_follow_up();

CREATE OR REPLACE FUNCTION public.get_my_follow_up_journeys(p_appointment_ids uuid[])
RETURNS TABLE (
  appointment_id uuid,
  tracked_profile_id uuid,
  journey_status text,
  consultation_count bigint,
  contract_count bigint,
  last_activity_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH caller AS (
    SELECT seller.id
    FROM public.internal_users AS seller
    WHERE seller.auth_user_id = auth.uid()
      AND seller.role = 'vendedor'
      AND seller.status = 'ativo'
    LIMIT 1
  ), scoped AS (
    SELECT appointment.*, coalesce(owner.exclude_from_commercial_metrics, false) AS test_owner
    FROM public.seller_appointments AS appointment
    JOIN caller ON caller.id IN (
      appointment.seller_id,
      appointment.sdr_id,
      appointment.assigned_closer_id
    )
    JOIN public.internal_users AS owner ON owner.id = appointment.seller_id
    WHERE appointment.id = ANY(coalesce(p_appointment_ids, ARRAY[]::uuid[]))
      AND appointment.source = 'meeting_follow_up'
  )
  SELECT
    appointment.id,
    appointment.tracked_profile_id,
    CASE
      WHEN appointment.test_owner AND appointment.journey_test_status IS NOT NULL
        THEN appointment.journey_test_status
      WHEN appointment.tracked_profile_id IS NULL THEN 'registration_pending'
      WHEN coalesce(contracts.total, 0) > 0 THEN 'contract_closed'
      WHEN coalesce(consultations.total, 0) > 0 THEN 'consultation_in_progress'
      ELSE 'no_consultations'
    END,
    coalesce(consultations.total, 0),
    coalesce(contracts.total, 0),
    greatest(consultations.last_created_at, contracts.last_created_at)
  FROM scoped AS appointment
  LEFT JOIN public.seller_client_partnerships AS partnership
    ON partnership.id = appointment.partnership_id
  LEFT JOIN LATERAL (
    SELECT count(*) AS total, max(credit.created_at) AS last_created_at
    FROM public.consultas_credito AS credit
    WHERE credit.profile_id_solicitante = appointment.tracked_profile_id
       OR (
         partnership.imobiliaria_id IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM public.corretores AS broker
           WHERE broker.imobiliaria_id = partnership.imobiliaria_id
             AND broker.profile_id = credit.profile_id_solicitante
         )
       )
  ) AS consultations ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS total, max(policy.created_at) AS last_created_at
    FROM public.apolices AS policy
    JOIN public.consultas_credito AS credit ON credit.id = policy.consulta_id
    WHERE credit.profile_id_solicitante = appointment.tracked_profile_id
       OR (
         partnership.imobiliaria_id IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM public.corretores AS broker
           WHERE broker.imobiliaria_id = partnership.imobiliaria_id
             AND broker.profile_id = credit.profile_id_solicitante
         )
       )
  ) AS contracts ON true;
$$;

-- Mantem as mudancas de consultas e contratos chegando em tempo real aos
-- detalhes do follow-up. Os blocos sao idempotentes para projetos ja ligados.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'apolices'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.apolices;
  END IF;
END;
$$;

-- Cenarios visuais isolados para vendedornox@nox.com. O status de teste so e
-- considerado para contas excluidas das metricas comerciais.
WITH test_seller AS (
  SELECT seller.*
  FROM public.internal_users AS seller
  WHERE lower(seller.email) = 'vendedornox@nox.com'
    AND seller.role = 'vendedor'
    AND seller.seller_type IN ('sdr', 'closer')
    AND seller.status = 'ativo'
  LIMIT 1
), test_closer AS (
  SELECT closer.*
  FROM public.internal_users AS closer
  CROSS JOIN test_seller
  WHERE closer.role = 'vendedor'
    AND closer.seller_type = 'closer'
    AND closer.status = 'ativo'
  ORDER BY CASE WHEN closer.id = test_seller.id THEN 0 ELSE 1 END, closer.created_at
  LIMIT 1
)
INSERT INTO public.seller_appointments (
  seller_id, sdr_id, assigned_closer_id, title, type, status, priority,
  scheduled_at, reminder_minutes, notes, source, duration_minutes,
  contact_name, contact_email, contact_phone, meeting_feedback,
  feedback_submitted_at, completed_at
)
SELECT
  closer.id,
  CASE WHEN seller.seller_type = 'sdr' THEN seller.id ELSE NULL END,
  closer.id, 'TESTE — Jornada do cliente no follow-up',
  'reuniao', 'concluido', 'normal', now() - interval '2 hours', 5,
  'Cenario interno NOX para validar a jornada automatica do cliente.',
  CASE WHEN seller.seller_type = 'sdr' THEN 'sdr_handoff' ELSE 'manual' END,
  60, 'Cliente Jornada NOX', 'jornada-teste@nox.com',
  '(11) 99999-1010', 'Reuniao de teste concluida para validar os follow-ups.',
  now(), now()
FROM test_seller AS seller
CROSS JOIN test_closer AS closer
WHERE NOT EXISTS (
    SELECT 1
    FROM public.seller_appointments AS existing
    WHERE existing.title = 'TESTE — Jornada do cliente no follow-up'
      AND existing.type = 'reuniao'
      AND (
        existing.seller_id = seller.id
        OR existing.sdr_id = seller.id
        OR existing.assigned_closer_id = seller.id
      )
  );

INSERT INTO public.seller_appointments (
  seller_id, title, type, status, priority, scheduled_at,
  reminder_minutes, notes, source, duration_minutes, contact_name,
  contact_email, contact_phone, origin_appointment_id,
  follow_up_offset_days, follow_up_owner_type, follow_up_message_key,
  visible_from, journey_test_status
)
SELECT
  seller.id, 'TESTE — Cliente com contrato fechado',
  'follow_up', 'agendado', 'normal',
  public.allocate_seller_follow_up_at(
    seller.id,
    ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 4),
    meeting.id::text || ':closer:test-contract'
  ),
  30, 'Simulacao interna NOX da jornada com contrato fechado.',
  'meeting_follow_up', 20, 'Cliente Contrato Fechado',
  'contrato-teste@nox.com', '(11) 99999-1103', meeting.id,
  6, 'closer', 'closer_3d', now() - interval '1 minute',
  'contract_closed'
FROM public.seller_appointments AS meeting
JOIN public.internal_users AS seller
  ON lower(seller.email) = 'vendedornox@nox.com'
 AND seller.seller_type = 'closer'
WHERE meeting.title = 'TESTE — Jornada do cliente no follow-up'
  AND meeting.type = 'reuniao'
  AND coalesce(meeting.assigned_closer_id, meeting.seller_id) = seller.id
ON CONFLICT (origin_appointment_id, follow_up_owner_type, follow_up_offset_days)
  WHERE source = 'meeting_follow_up'
DO UPDATE SET
  title = EXCLUDED.title,
  contact_name = EXCLUDED.contact_name,
  contact_email = EXCLUDED.contact_email,
  contact_phone = EXCLUDED.contact_phone,
  visible_from = EXCLUDED.visible_from,
  journey_test_status = EXCLUDED.journey_test_status,
  updated_at = now();

WITH ranked_follow_ups AS (
  SELECT follow_up.id,
    row_number() OVER (ORDER BY follow_up.follow_up_offset_days, follow_up.scheduled_at) AS sequence
  FROM public.seller_appointments AS follow_up
  JOIN public.seller_appointments AS meeting ON meeting.id = follow_up.origin_appointment_id
  JOIN public.internal_users AS seller ON seller.id = follow_up.seller_id
  WHERE follow_up.source = 'meeting_follow_up'
    AND meeting.title = 'TESTE — Jornada do cliente no follow-up'
    AND lower(seller.email) = 'vendedornox@nox.com'
)
UPDATE public.seller_appointments AS follow_up
SET title = CASE ranked.sequence
      WHEN 1 THEN 'TESTE — Cliente sem consultas feitas'
      WHEN 2 THEN 'TESTE — Cliente consultando sem fechamento'
      WHEN 3 THEN 'TESTE — Cliente com contrato fechado'
    END,
    contact_name = CASE ranked.sequence
      WHEN 1 THEN 'Cliente Sem Consulta'
      WHEN 2 THEN 'Cliente Em Consulta'
      WHEN 3 THEN 'Cliente Contrato Fechado'
    END,
    contact_email = CASE ranked.sequence
      WHEN 1 THEN 'sem-consulta-teste@nox.com'
      WHEN 2 THEN 'consulta-teste@nox.com'
      WHEN 3 THEN 'contrato-teste@nox.com'
    END,
    contact_phone = CASE ranked.sequence
      WHEN 1 THEN '(11) 99999-1101'
      WHEN 2 THEN '(11) 99999-1102'
      WHEN 3 THEN '(11) 99999-1103'
    END,
    journey_test_status = CASE ranked.sequence
      WHEN 1 THEN 'no_consultations'
      WHEN 2 THEN 'consultation_in_progress'
      WHEN 3 THEN 'contract_closed'
    END,
    visible_from = now() - interval '1 minute',
    updated_at = now()
FROM ranked_follow_ups AS ranked
WHERE follow_up.id = ranked.id
  AND ranked.sequence <= 3;

REVOKE ALL ON FUNCTION public.record_meeting_signup_link_send(uuid, text, text, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_seller_signup_link_for_meeting(uuid, text, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_meeting_signup_link(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_follow_up_journeys(uuid[])
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.protect_required_seller_follow_up()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_seller_follow_up_journeys(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_seller_follow_up_journey_change()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_meeting_signup_link_send(uuid, text, text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_seller_signup_link_for_meeting(uuid, text, uuid, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_meeting_signup_link(uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_my_follow_up_journeys(uuid[])
  TO authenticated;

COMMENT ON COLUMN public.seller_appointments.tracked_profile_id IS
  'Perfil cadastrado pelo link enviado dentro da reuniao que originou o follow-up.';
COMMENT ON COLUMN public.seller_appointments.visible_from IS
  'Momento a partir do qual o follow-up automatico aparece na agenda comercial.';
COMMENT ON FUNCTION public.get_my_follow_up_journeys(uuid[]) IS
  'Retorna, apenas para os follow-ups do vendedor autenticado, se houve consulta e contrato.';
