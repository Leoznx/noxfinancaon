-- Restaura o contrato de reunioes administrativas no banco compartilhado.
-- A disponibilidade e calculada para todos os participantes em uma unica
-- consulta, enquanto follow-ups permanecem apenas como lembretes.

CREATE OR REPLACE FUNCTION public.seller_appointment_blocks_availability(
  p_type text,
  p_status text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    lower(trim(coalesce(p_type, ''))) NOT IN ('follow_up', 'follow-up', 'followup')
    AND lower(trim(coalesce(p_status, 'agendado'))) NOT IN (
      'cancelado', 'concluido', 'nao_compareceu'
    );
$$;

REVOKE ALL ON FUNCTION public.seller_appointment_blocks_availability(text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_admin_team_meeting_availability(
  p_participant_ids uuid[],
  p_scheduled_at timestamptz,
  p_all_sellers boolean DEFAULT false
)
RETURNS TABLE (
  participant_id uuid,
  participant_name text,
  seller_type text,
  is_available boolean,
  conflict_title text,
  conflict_start timestamptz,
  conflict_end timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (
    public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  ) THEN
    RAISE EXCEPTION 'Somente administradores podem consultar a disponibilidade da equipe.';
  END IF;

  RETURN QUERY
  WITH targets AS (
    SELECT DISTINCT seller.id, seller.full_name, seller.seller_type::text
    FROM public.internal_users AS seller
    WHERE seller.role = 'vendedor'
      AND seller.status = 'ativo'
      AND (
        coalesce(p_all_sellers, false)
        OR seller.id = ANY(coalesce(p_participant_ids, ARRAY[]::uuid[]))
      )
  )
  SELECT
    target.id,
    coalesce(nullif(trim(target.full_name), ''), 'Vendedor'),
    target.seller_type,
    p_scheduled_at > now() + interval '30 minutes'
      AND public.is_seller_shared_slot_within_business_hours(p_scheduled_at, 60)
      AND conflict.id IS NULL,
    CASE
      WHEN p_scheduled_at <= now() + interval '30 minutes'
        THEN 'Escolha um horario com pelo menos 30 minutos de antecedencia'
      WHEN NOT public.is_seller_shared_slot_within_business_hours(p_scheduled_at, 60)
        THEN 'Fora do horario comercial ou inicio fora da hora cheia'
      ELSE conflict.title
    END,
    conflict.scheduled_at,
    conflict.scheduled_at + make_interval(mins => conflict.duration_minutes)
  FROM targets AS target
  LEFT JOIN LATERAL (
    SELECT
      busy.id,
      busy.title,
      busy.scheduled_at,
      greatest(coalesce(busy.duration_minutes, 60), 1) AS duration_minutes
    FROM public.seller_appointments AS busy
    WHERE (
        busy.seller_id = target.id
        OR busy.sdr_id = target.id
        OR busy.assigned_closer_id = target.id
      )
      AND public.seller_appointment_blocks_availability(busy.type, busy.status)
      AND tstzrange(
            busy.scheduled_at,
            busy.scheduled_at + make_interval(
              mins => greatest(coalesce(busy.duration_minutes, 60), 1)
            ),
            '[)'
          ) && tstzrange(p_scheduled_at, p_scheduled_at + interval '1 hour', '[)')
    ORDER BY busy.scheduled_at
    LIMIT 1
  ) AS conflict ON true
  ORDER BY 2;
END;
$$;

REVOKE ALL ON FUNCTION public.check_admin_team_meeting_availability(uuid[], timestamptz, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_admin_team_meeting_availability(uuid[], timestamptz, boolean)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.schedule_admin_team_meeting(
  p_title text,
  p_notes text,
  p_scheduled_at timestamptz,
  p_participant_ids uuid[],
  p_all_sellers boolean DEFAULT false
)
RETURNS TABLE (meeting_group_id uuid, participant_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_group_id uuid := gen_random_uuid();
  v_target_ids uuid[];
  v_conflicting_names text;
  v_target record;
BEGIN
  IF NOT (
    public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  ) THEN
    RAISE EXCEPTION 'Somente administradores podem criar reunioes de equipe.';
  END IF;

  IF nullif(trim(coalesce(p_title, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe um titulo para a reuniao.';
  END IF;
  IF length(trim(p_title)) > 120 THEN
    RAISE EXCEPTION 'O titulo deve ter no maximo 120 caracteres.';
  END IF;
  IF length(coalesce(p_notes, '')) > 2000 THEN
    RAISE EXCEPTION 'A pauta deve ter no maximo 2000 caracteres.';
  END IF;
  IF p_scheduled_at IS NULL OR p_scheduled_at <= now() + interval '30 minutes' THEN
    RAISE EXCEPTION 'Escolha um horario futuro com pelo menos 30 minutos de antecedencia.';
  END IF;
  IF NOT public.is_seller_shared_slot_within_business_hours(p_scheduled_at, 60) THEN
    RAISE EXCEPTION 'Escolha um horario comercial livre, com inicio em hora cheia.';
  END IF;

  SELECT array_agg(DISTINCT seller.id ORDER BY seller.id)
  INTO v_target_ids
  FROM public.internal_users AS seller
  WHERE seller.role = 'vendedor'
    AND seller.status = 'ativo'
    AND (
      coalesce(p_all_sellers, false)
      OR seller.id = ANY(coalesce(p_participant_ids, ARRAY[]::uuid[]))
    );

  IF coalesce(cardinality(v_target_ids), 0) = 0 THEN
    RAISE EXCEPTION 'Selecione pelo menos um colaborador ativo.';
  END IF;

  -- A trava e a segunda checagem impedem duas reservas simultaneas de
  -- atravessarem a validacao para qualquer participante do grupo.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_scheduled_at::text, 0));

  SELECT string_agg(
    coalesce(nullif(trim(seller.full_name), ''), 'Vendedor'),
    ', '
    ORDER BY seller.full_name
  )
  INTO v_conflicting_names
  FROM public.internal_users AS seller
  WHERE seller.id = ANY(v_target_ids)
    AND EXISTS (
      SELECT 1
      FROM public.seller_appointments AS busy
      WHERE (
          busy.seller_id = seller.id
          OR busy.sdr_id = seller.id
          OR busy.assigned_closer_id = seller.id
        )
        AND public.seller_appointment_blocks_availability(busy.type, busy.status)
        AND tstzrange(
              busy.scheduled_at,
              busy.scheduled_at + make_interval(
                mins => greatest(coalesce(busy.duration_minutes, 60), 1)
              ),
              '[)'
            ) && tstzrange(p_scheduled_at, p_scheduled_at + interval '1 hour', '[)')
    );

  IF v_conflicting_names IS NOT NULL THEN
    RAISE EXCEPTION 'Conflito de agenda: % ja possui reuniao neste horario.', v_conflicting_names;
  END IF;

  INSERT INTO public.seller_appointments (
    seller_id,
    meeting_group_id,
    title,
    type,
    status,
    priority,
    scheduled_at,
    duration_minutes,
    reminder_minutes,
    notes,
    source,
    lead_id
  )
  SELECT
    target_id,
    v_group_id,
    trim(p_title),
    'reuniao',
    'agendado',
    'alta',
    p_scheduled_at,
    60,
    30,
    nullif(trim(coalesce(p_notes, '')), ''),
    'admin',
    NULL
  FROM unnest(v_target_ids) AS target_id;

  FOR v_target IN
    SELECT seller.auth_user_id, seller.full_name
    FROM public.internal_users AS seller
    WHERE seller.id = ANY(v_target_ids)
      AND seller.auth_user_id IS NOT NULL
  LOOP
    PERFORM public.enqueue_important_notification(
      'reuniao-equipe:' || v_group_id || ':' || v_target.auth_user_id,
      v_target.auth_user_id,
      'Nova reuniao com a equipe',
      trim(p_title) || ' foi agendada para ' ||
        to_char(p_scheduled_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY "as" HH24:MI') ||
        '. O horario foi reservado automaticamente na sua agenda.',
      'reuniao_equipe',
      'amarelo',
      '/vendedor/agenda'
    );
  END LOOP;

  RETURN QUERY SELECT v_group_id, cardinality(v_target_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_admin_team_meeting(text, text, timestamptz, uuid[], boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_admin_team_meeting(text, text, timestamptz, uuid[], boolean)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_admin_team_meeting(p_meeting_group_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT (
    public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  ) THEN
    RAISE EXCEPTION 'Somente administradores podem cancelar reunioes de equipe.';
  END IF;

  UPDATE public.seller_appointments
  SET status = 'cancelado', updated_at = now()
  WHERE meeting_group_id = p_meeting_group_id
    AND source = 'admin'
    AND status <> 'cancelado';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_admin_team_meeting(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_admin_team_meeting(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_admin_team_appointment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.meeting_group_id IS NULL OR OLD.source <> 'admin' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF auth.role() = 'service_role'
     OR public.is_admin(auth.uid())
     OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Reunioes criadas pelo administrador nao podem ser excluidas pelo participante.';
  END IF;

  IF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
     OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes
     OR NEW.seller_id IS DISTINCT FROM OLD.seller_id
     OR NEW.meeting_group_id IS DISTINCT FROM OLD.meeting_group_id
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.status = 'cancelado' AND OLD.status IS DISTINCT FROM 'cancelado' THEN
    RAISE EXCEPTION 'Esta reuniao foi definida pelo administrador e nao pode ser reagendada, editada ou excluida.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_admin_team_appointment ON public.seller_appointments;
CREATE TRIGGER trg_guard_admin_team_appointment
BEFORE UPDATE OR DELETE ON public.seller_appointments
FOR EACH ROW EXECUTE FUNCTION public.guard_admin_team_appointment();

REVOKE ALL ON FUNCTION public.guard_admin_team_appointment()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.seller_appointment_blocks_availability(text, text) IS
  'Somente compromissos reais bloqueiam horario; follow-ups sao lembretes e nunca ocupam a agenda.';
COMMENT ON FUNCTION public.check_admin_team_meeting_availability(uuid[], timestamptz, boolean) IS
  'Confere simultaneamente todos os participantes e retorna um resultado individual por agenda.';
COMMENT ON FUNCTION public.schedule_admin_team_meeting(text, text, timestamptz, uuid[], boolean) IS
  'Reserva atomicamente a reuniao em todas as agendas somente quando todos estao livres.';
