-- Correcoes encontradas na revisao da migration anterior
-- (20260903100000_agenda_simplificada_metas_periodicas.sql), antes de
-- expor as mudancas para a equipe:
--
-- 1) O upsert de metas do admin gravava "target_clients_monthly", que
--    nunca existiu como coluna (a meta mensal de cadastros sempre viveu
--    na coluna legada "target_clients"). Toda tentativa de salvar metas
--    falhava com "column does not exist".
-- 2) O LIMIT da consulta de horarios livres nao acompanhou o aumento da
--    janela (14 -> 30 dias) nem da grade (9 -> 15 horarios/dia): a partir
--    de ~11 dias uteis os horarios simplesmente somem do calendario do
--    SDR, mesmo com Closers totalmente livres.
-- 3) schedule_sdr_closer_meeting aceitava qualquer duracao informada pelo
--    chamador (a UI sempre manda 30, mas nada impedia uma chamada direta
--    com outro valor), permitindo reunioes que ultrapassam as 17:30.
-- 4) O toast de confirmacao usava o nome do Closer da lista em cache do
--    navegador (ate 30s desatualizada); com 2+ Closers ativos, o Closer
--    exibido pode nao ser o mesmo que o backend realmente atribuiu.
-- 5) get_my_seller_client_phone_history ainda tinha um fallback de 3
--    horas (nunca exercitado hoje, mas inconsistente com a janela de 1
--    hora corrigida na migration anterior).

CREATE OR REPLACE FUNCTION public.get_available_closer_slots(
  p_from_date date DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  p_days integer DEFAULT 14,
  p_duration_minutes integer DEFAULT 30
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
    -- Grade fixa de 30 em 30 minutos das 08:30 as 17:30, com pausa de
    -- almoco entre 12:00 e 13:30 (nenhum horario comeca dentro da pausa)
    -- e nenhum horario termina depois do fechamento, seja qual for a
    -- duracao pedida.
    SELECT generate_series(
      timestamp '2000-01-01 08:30', timestamp '2000-01-01 17:00', interval '30 minutes'
    )::time AS slot_time
  ), filtered_hours AS (
    SELECT slot_time FROM business_hours
    WHERE (slot_time < time '12:00' OR slot_time >= time '13:30')
      AND slot_time + make_interval(mins => p_duration_minutes) <= time '17:30'
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
  -- Teto generoso: no maximo ~23 dias uteis num intervalo de 31 dias (o
  -- maior p_days aceito) x 15 horarios/dia = ~345 linhas distintas. 400
  -- garante folga sem nunca cortar a janela real de disponibilidade.
  LIMIT 400;
END;
$$;

-- schedule_sdr_closer_meeting agora exige exatamente 30 minutos (regra de
-- negocio da agenda compartilhada) e devolve o Closer realmente atribuido,
-- para o SDR nunca ver o nome de um Closer diferente do que ficou com a
-- reuniao numa disputa por horario.
DROP FUNCTION IF EXISTS public.schedule_sdr_closer_meeting(timestamptz, text, text, text, text, text, integer);
CREATE FUNCTION public.schedule_sdr_closer_meeting(
  p_slot_start timestamptz,
  p_title text,
  p_contact_name text,
  p_contact_email text DEFAULT NULL,
  p_contact_phone text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_duration_minutes integer DEFAULT 30
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
  IF p_duration_minutes IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION 'As reunioes da agenda compartilhada duram sempre 30 minutos.';
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

REVOKE ALL ON FUNCTION public.schedule_sdr_closer_meeting(timestamptz, text, text, text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_sdr_closer_meeting(timestamptz, text, text, text, text, text, integer) TO authenticated;

-- Consulta previa do telefone: remove o ultimo fallback de 3 horas
-- (inofensivo hoje porque todo INSERT/UPDATE ja define expires_at, mas
-- deixava a funcao de leitura inconsistente com a janela real de 1 hora).
CREATE OR REPLACE FUNCTION public.get_my_seller_client_phone_history()
RETURNS TABLE (
  contact_id uuid, phone_display text, status text, client_email text,
  partner_type text, agency_name text, broker_name text, city text,
  first_contact_at timestamptz, last_contact_at timestamptz,
  registered_at timestamptz, partnership_id uuid, expires_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT contact.id, contact.phone_display, contact.status, contact.client_email,
    contact.partner_type, contact.agency_name, contact.broker_name, contact.city,
    contact.first_contact_at, contact.last_contact_at, contact.registered_at,
    contact.partnership_id, contact.expires_at
  FROM public.seller_client_phone_contacts AS contact
  JOIN public.internal_users AS seller ON seller.id = contact.seller_id
  WHERE seller.auth_user_id = auth.uid()
    AND contact.status = 'em_atendimento'
    AND coalesce(contact.expires_at, contact.last_contact_at + interval '1 hour') > clock_timestamp()
  ORDER BY contact.last_contact_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_my_seller_client_phone_history() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_seller_client_phone_history() TO authenticated;

COMMENT ON FUNCTION public.schedule_sdr_closer_meeting(timestamptz, text, text, text, text, text, integer) IS
  'Distribui a reuniao de 30 minutos para o Closer com a agenda mais aberta e devolve qual Closer foi de fato escolhido.';
;
