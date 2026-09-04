-- Agenda compartilhada SDR -> Closer com horario comercial fixo, reserva de
-- telefone de 1 hora (corrige o texto ja exibido na tela) e metas diarias,
-- semanais e mensais por metrica (cadastros, reunioes agendadas pelo SDR e
-- reunioes realizadas pelo Closer).

-- ===================================================================
-- 1) Horario comercial: seg-sex 08:30-17:30, pausa 12:00-13:30, reunioes
--    de 30 minutos. O Closer escolhido e sempre quem tem menos compromissos
--    futuros ativos no momento (equilibrio automatico entre os Closers).
-- ===================================================================
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
    -- almoco entre 12:00 e 13:30 (nenhum horario comeca dentro da pausa).
    SELECT generate_series(
      timestamp '2000-01-01 08:30', timestamp '2000-01-01 17:00', interval '30 minutes'
    )::time AS slot_time
  ), filtered_hours AS (
    SELECT slot_time FROM business_hours
    WHERE slot_time < time '12:00' OR slot_time >= time '13:30'
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
          -- Quem tem menos compromissos futuros ativos entra primeiro na
          -- vez (agenda mais aberta = prioridade), com o mesmo dia como
          -- desempate para nao empilhar tudo num unico dia.
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
  LIMIT 160;
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_sdr_closer_meeting(
  p_slot_start timestamptz,
  p_title text,
  p_contact_name text,
  p_contact_email text DEFAULT NULL,
  p_contact_phone text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_duration_minutes integer DEFAULT 30
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_sdr_id uuid;
  v_closer_id uuid;
  v_id uuid;
BEGIN
  SELECT seller.id INTO v_sdr_id FROM public.internal_users seller
  WHERE seller.auth_user_id = auth.uid() AND seller.role = 'vendedor'
    AND seller.seller_type = 'sdr' AND seller.status = 'ativo' LIMIT 1;
  IF v_sdr_id IS NULL THEN RAISE EXCEPTION 'Somente SDRs ativos podem distribuir reunioes.'; END IF;
  IF nullif(trim(p_title), '') IS NULL OR nullif(trim(p_contact_name), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o titulo e o contato da reuniao.';
  END IF;
  IF p_slot_start <= now() + interval '30 minutes' THEN RAISE EXCEPTION 'Escolha um horario com pelo menos 30 minutos de antecedencia.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_slot_start::text, 0));

  SELECT available.closer_id INTO v_closer_id
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
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_available_closer_slots(date, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.schedule_sdr_closer_meeting(timestamptz, text, text, text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_available_closer_slots(date, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_sdr_closer_meeting(timestamptz, text, text, text, text, text, integer) TO authenticated;

COMMENT ON FUNCTION public.get_available_closer_slots(date, integer, integer) IS
  'Horarios livres seg-sex 08:30-17:30 (pausa 12:00-13:30, reunioes de 30min por padrao). Escolhe sempre o Closer com a agenda mais aberta.';

-- ===================================================================
-- 2) Consulta previa do telefone: reserva por 1 hora (o texto exibido na
--    tela sempre disse "1 hora"; o backend reservava por 3h por engano).
-- ===================================================================
CREATE OR REPLACE FUNCTION public.claim_my_seller_client_phone(p_phone text)
RETURNS TABLE (
  contact_id uuid, outcome text, phone_display text, seller_name text,
  contact_status text, first_contact_at timestamptz, last_contact_at timestamptz,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_id uuid;
  v_seller_name text;
  v_seller_type text;
  v_owner_name text;
  v_digits text := public.normalize_br_phone(p_phone);
  v_display text;
  v_inserted_id uuid;
  v_now timestamptz := clock_timestamp();
  v_outcome text;
  v_contact public.seller_client_phone_contacts%ROWTYPE;
BEGIN
  SELECT seller.id, seller.full_name, coalesce(seller.seller_type, 'sdr')
  INTO v_seller_id, v_seller_name, v_seller_type
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid() AND seller.role = 'vendedor' AND seller.status = 'ativo'
  LIMIT 1;
  IF v_seller_id IS NULL THEN RAISE EXCEPTION 'Somente vendedores ativos podem iniciar atendimentos.'; END IF;

  v_display := CASE WHEN length(v_digits) = 11
    THEN '(' || substring(v_digits FROM 1 FOR 2) || ') ' || substring(v_digits FROM 3 FOR 5) || '-' || substring(v_digits FROM 8 FOR 4)
    ELSE '(' || substring(v_digits FROM 1 FOR 2) || ') ' || substring(v_digits FROM 3 FOR 4) || '-' || substring(v_digits FROM 7 FOR 4)
  END;

  INSERT INTO public.seller_client_phone_contacts (
    phone_normalized, phone_display, seller_id, seller_type, expires_at, created_by
  ) VALUES (v_digits, v_display, v_seller_id, v_seller_type, v_now + interval '1 hour', auth.uid())
  ON CONFLICT (phone_normalized, seller_type) DO NOTHING
  RETURNING id INTO v_inserted_id;

  SELECT contact.* INTO v_contact
  FROM public.seller_client_phone_contacts AS contact
  WHERE contact.phone_normalized = v_digits AND contact.seller_type = v_seller_type
  FOR UPDATE;

  IF v_inserted_id IS NOT NULL THEN
    v_outcome := 'available';
  ELSIF v_contact.status = 'em_atendimento'
    AND coalesce(v_contact.expires_at, v_contact.last_contact_at + interval '1 hour') <= v_now THEN
    UPDATE public.seller_client_phone_contacts AS contact
    SET phone_display = v_display, seller_id = v_seller_id, status = 'em_atendimento',
        partnership_id = NULL, client_email = NULL, partner_type = NULL,
        agency_name = NULL, broker_name = NULL, city = NULL,
        first_contact_at = v_now, last_contact_at = v_now, registered_at = NULL,
        expires_at = v_now + interval '1 hour', created_by = auth.uid(), updated_at = v_now
    WHERE contact.id = v_contact.id RETURNING contact.* INTO v_contact;
    v_outcome := 'available';
  ELSIF v_contact.seller_id = v_seller_id THEN
    IF v_contact.status = 'em_atendimento' THEN
      UPDATE public.seller_client_phone_contacts AS contact
      SET last_contact_at = v_now, expires_at = v_now + interval '1 hour', updated_at = v_now
      WHERE contact.id = v_contact.id RETURNING contact.* INTO v_contact;
    END IF;
    v_outcome := 'owned_by_me';
  ELSE
    v_outcome := 'in_use';
  END IF;

  SELECT owner.full_name INTO v_owner_name FROM public.internal_users AS owner WHERE owner.id = v_contact.seller_id;
  RETURN QUERY SELECT v_contact.id, v_outcome, v_contact.phone_display,
    CASE WHEN v_outcome = 'in_use' THEN v_owner_name ELSE v_seller_name END,
    v_contact.status, v_contact.first_contact_at, v_contact.last_contact_at, v_contact.expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_my_seller_client_details(
  p_email text, p_phone text, p_partner_type text, p_agency_name text,
  p_broker_name text, p_city text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_id uuid;
  v_seller_type text;
  v_owner_name text;
  v_digits text := public.normalize_br_phone(p_phone);
  v_display text;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_partner_type text := lower(trim(coalesce(p_partner_type, '')));
  v_agency_name text := nullif(trim(coalesce(p_agency_name, '')), '');
  v_broker_name text := nullif(trim(coalesce(p_broker_name, '')), '');
  v_city text := nullif(trim(coalesce(p_city, '')), '');
  v_now timestamptz := clock_timestamp();
  v_contact public.seller_client_phone_contacts%ROWTYPE;
  v_partnership_id uuid;
  v_actual_partner_type text;
  v_existing_phone text;
BEGIN
  SELECT seller.id, coalesce(seller.seller_type, 'sdr')
  INTO v_seller_id, v_seller_type
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid() AND seller.role = 'vendedor' AND seller.status = 'ativo'
  LIMIT 1;
  IF v_seller_id IS NULL THEN RAISE EXCEPTION 'Somente vendedores ativos podem cadastrar clientes.'; END IF;
  IF v_email = '' OR position('@' IN v_email) <= 1 THEN RAISE EXCEPTION 'Informe um e-mail valido.'; END IF;
  IF v_partner_type NOT IN ('corretor', 'imobiliaria') THEN RAISE EXCEPTION 'Selecione Corretor ou Imobiliaria.'; END IF;
  IF v_broker_name IS NULL THEN RAISE EXCEPTION 'Informe o nome do corretor ou responsavel.'; END IF;
  IF v_partner_type = 'imobiliaria' AND v_agency_name IS NULL THEN RAISE EXCEPTION 'Informe o nome da imobiliaria.'; END IF;
  IF v_city IS NULL THEN RAISE EXCEPTION 'Informe a cidade do cliente.'; END IF;

  v_display := CASE WHEN length(v_digits) = 11
    THEN '(' || substring(v_digits FROM 1 FOR 2) || ') ' || substring(v_digits FROM 3 FOR 5) || '-' || substring(v_digits FROM 8 FOR 4)
    ELSE '(' || substring(v_digits FROM 1 FOR 2) || ') ' || substring(v_digits FROM 3 FOR 4) || '-' || substring(v_digits FROM 7 FOR 4)
  END;

  INSERT INTO public.seller_client_phone_contacts (
    phone_normalized, phone_display, seller_id, seller_type, expires_at, created_by
  ) VALUES (v_digits, v_display, v_seller_id, v_seller_type, v_now + interval '1 hour', auth.uid())
  ON CONFLICT (phone_normalized, seller_type) DO NOTHING;

  SELECT contact.* INTO v_contact
  FROM public.seller_client_phone_contacts AS contact
  WHERE contact.phone_normalized = v_digits AND contact.seller_type = v_seller_type
  FOR UPDATE;

  IF v_contact.status = 'em_atendimento'
    AND coalesce(v_contact.expires_at, v_contact.last_contact_at + interval '1 hour') <= v_now THEN
    UPDATE public.seller_client_phone_contacts AS contact
    SET phone_display = v_display, seller_id = v_seller_id, status = 'em_atendimento',
        partnership_id = NULL, client_email = NULL, partner_type = NULL,
        agency_name = NULL, broker_name = NULL, city = NULL,
        first_contact_at = v_now, last_contact_at = v_now, registered_at = NULL,
        expires_at = v_now + interval '1 hour', created_by = auth.uid(), updated_at = v_now
    WHERE contact.id = v_contact.id RETURNING contact.* INTO v_contact;
  END IF;

  IF v_contact.seller_id <> v_seller_id THEN
    SELECT owner.full_name INTO v_owner_name FROM public.internal_users AS owner WHERE owner.id = v_contact.seller_id;
    RAISE EXCEPTION 'Esse numero ja esta em atendimento por outro %: %.', upper(v_seller_type), coalesce(v_owner_name, 'responsavel');
  END IF;
  IF v_contact.status = 'cadastrado' AND lower(coalesce(v_contact.client_email, '')) <> v_email THEN
    RAISE EXCEPTION 'Esse telefone ja esta vinculado a outro cliente cadastrado nesta etapa.';
  END IF;

  v_partnership_id := public.register_my_seller_client(v_email);
  SELECT partnership.partner_type, partnership.contact_phone_normalized
  INTO v_actual_partner_type, v_existing_phone
  FROM public.seller_client_partnerships AS partnership
  WHERE partnership.id = v_partnership_id AND partnership.seller_id = v_seller_id;

  IF v_partnership_id IS NULL OR v_actual_partner_type IS NULL THEN RAISE EXCEPTION 'Nao foi possivel localizar o cliente vinculado.'; END IF;
  IF (v_partner_type = 'corretor' AND v_actual_partner_type <> 'corretor_autonomo')
    OR (v_partner_type = 'imobiliaria' AND v_actual_partner_type <> 'imobiliaria') THEN
    RAISE EXCEPTION 'O tipo selecionado nao corresponde ao cadastro NOX deste e-mail.';
  END IF;
  IF v_existing_phone IS NOT NULL AND v_existing_phone <> v_digits THEN
    RAISE EXCEPTION 'Este cliente ja foi cadastrado com outro telefone nesta etapa.';
  END IF;

  UPDATE public.seller_client_partnerships
  SET contact_phone = v_display, contact_phone_normalized = v_digits,
      declared_agency_name = v_agency_name, declared_broker_name = v_broker_name,
      declared_city = v_city
  WHERE id = v_partnership_id;

  UPDATE public.seller_client_phone_contacts
  SET phone_display = v_display, status = 'cadastrado', partnership_id = v_partnership_id,
      client_email = v_email, partner_type = v_partner_type, agency_name = v_agency_name,
      broker_name = v_broker_name, city = v_city, registered_at = coalesce(registered_at, v_now),
      last_contact_at = v_now, expires_at = NULL, updated_at = v_now
  WHERE id = v_contact.id;
  RETURN v_partnership_id;
END;
$$;

COMMENT ON FUNCTION public.claim_my_seller_client_phone(text) IS
  'Reserva o telefone para o vendedor por 1 hora, independente do cadastro definitivo.';

-- ===================================================================
-- 3) Metas diarias, semanais e mensais por metrica.
-- ===================================================================
ALTER TABLE public.seller_goals
  ADD COLUMN IF NOT EXISTS target_clients_daily integer,
  ADD COLUMN IF NOT EXISTS target_clients_weekly integer,
  ADD COLUMN IF NOT EXISTS target_meetings_scheduled_daily integer,
  ADD COLUMN IF NOT EXISTS target_meetings_scheduled_weekly integer,
  ADD COLUMN IF NOT EXISTS target_meetings_scheduled_monthly integer,
  ADD COLUMN IF NOT EXISTS target_meetings_completed_daily integer,
  ADD COLUMN IF NOT EXISTS target_meetings_completed_weekly integer,
  ADD COLUMN IF NOT EXISTS target_meetings_completed_monthly integer;

ALTER TABLE public.seller_goals DROP CONSTRAINT IF EXISTS seller_goals_targets_nonnegative;
ALTER TABLE public.seller_goals ADD CONSTRAINT seller_goals_targets_nonnegative CHECK (
  target_meetings >= 0 AND target_clients >= 0 AND target_contracts >= 0
  AND target_clients_daily >= 0 AND target_clients_weekly >= 0
  AND target_meetings_scheduled_daily >= 0 AND target_meetings_scheduled_weekly >= 0 AND target_meetings_scheduled_monthly >= 0
  AND target_meetings_completed_daily >= 0 AND target_meetings_completed_weekly >= 0 AND target_meetings_completed_monthly >= 0
);

COMMENT ON COLUMN public.seller_goals.target_clients IS 'Meta mensal de cadastros (clientes parceiros).';
COMMENT ON COLUMN public.seller_goals.target_clients_daily IS 'Meta diaria de cadastros.';
COMMENT ON COLUMN public.seller_goals.target_clients_weekly IS 'Meta semanal de cadastros.';
COMMENT ON COLUMN public.seller_goals.target_meetings_scheduled_daily IS 'Meta diaria do SDR de reunioes agendadas com um Closer.';
COMMENT ON COLUMN public.seller_goals.target_meetings_scheduled_weekly IS 'Meta semanal do SDR de reunioes agendadas com um Closer.';
COMMENT ON COLUMN public.seller_goals.target_meetings_scheduled_monthly IS 'Meta mensal do SDR de reunioes agendadas com um Closer.';
COMMENT ON COLUMN public.seller_goals.target_meetings_completed_daily IS 'Meta diaria do Closer de reunioes realizadas e finalizadas.';
COMMENT ON COLUMN public.seller_goals.target_meetings_completed_weekly IS 'Meta semanal do Closer de reunioes realizadas e finalizadas.';
COMMENT ON COLUMN public.seller_goals.target_meetings_completed_monthly IS 'Meta mensal do Closer de reunioes realizadas e finalizadas.';

-- Progresso individual (aba "Minhas metas" do vendedor). Os periodos
-- diario e semanal sempre refletem hoje/esta semana; o mensal segue o
-- mes corrente, que e o mesmo mes cuja meta e exibida.
CREATE OR REPLACE FUNCTION public.get_my_seller_goal_progress()
RETURNS TABLE (
  seller_id uuid,
  seller_type text,
  month integer,
  year integer,
  target_clients_daily integer,
  target_clients_weekly integer,
  target_clients_monthly integer,
  target_meetings_scheduled_daily integer,
  target_meetings_scheduled_weekly integer,
  target_meetings_scheduled_monthly integer,
  target_meetings_completed_daily integer,
  target_meetings_completed_weekly integer,
  target_meetings_completed_monthly integer,
  clients_registered_daily bigint,
  clients_registered_weekly bigint,
  clients_registered_monthly bigint,
  meetings_scheduled_daily bigint,
  meetings_scheduled_weekly bigint,
  meetings_scheduled_monthly bigint,
  meetings_completed_daily bigint,
  meetings_completed_weekly bigint,
  meetings_completed_monthly bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_id uuid;
  v_seller_type text;
  v_now_local timestamp := now() AT TIME ZONE 'America/Sao_Paulo';
  v_month integer;
  v_year integer;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_week_start timestamptz;
  v_week_end timestamptz;
  v_month_start timestamptz;
  v_month_end timestamptz;
BEGIN
  SELECT seller.id, coalesce(seller.seller_type, 'sdr') INTO v_seller_id, v_seller_type
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid() AND seller.role = 'vendedor' AND seller.status = 'ativo'
  LIMIT 1;
  IF v_seller_id IS NULL THEN RAISE EXCEPTION 'Somente vendedores ativos podem consultar metas.'; END IF;

  v_month := extract(month FROM v_now_local)::integer;
  v_year := extract(year FROM v_now_local)::integer;
  v_day_start := date_trunc('day', v_now_local) AT TIME ZONE 'America/Sao_Paulo';
  v_day_end := v_day_start + interval '1 day';
  v_week_start := date_trunc('week', v_now_local) AT TIME ZONE 'America/Sao_Paulo';
  v_week_end := v_week_start + interval '7 days';
  v_month_start := date_trunc('month', v_now_local) AT TIME ZONE 'America/Sao_Paulo';
  v_month_end := v_month_start + interval '1 month';

  RETURN QUERY
  SELECT
    v_seller_id, v_seller_type, v_month, v_year,
    goal.target_clients_daily, goal.target_clients_weekly, goal.target_clients,
    goal.target_meetings_scheduled_daily, goal.target_meetings_scheduled_weekly, goal.target_meetings_scheduled_monthly,
    goal.target_meetings_completed_daily, goal.target_meetings_completed_weekly, goal.target_meetings_completed_monthly,
    (SELECT count(*) FROM public.seller_client_partnerships p WHERE p.seller_id = v_seller_id AND p.created_at >= v_day_start AND p.created_at < v_day_end),
    (SELECT count(*) FROM public.seller_client_partnerships p WHERE p.seller_id = v_seller_id AND p.created_at >= v_week_start AND p.created_at < v_week_end),
    (SELECT count(*) FROM public.seller_client_partnerships p WHERE p.seller_id = v_seller_id AND p.created_at >= v_month_start AND p.created_at < v_month_end),
    (SELECT count(*) FROM public.seller_appointments a WHERE a.sdr_id = v_seller_id AND a.source = 'sdr_handoff' AND a.status <> 'cancelado' AND a.created_at >= v_day_start AND a.created_at < v_day_end),
    (SELECT count(*) FROM public.seller_appointments a WHERE a.sdr_id = v_seller_id AND a.source = 'sdr_handoff' AND a.status <> 'cancelado' AND a.created_at >= v_week_start AND a.created_at < v_week_end),
    (SELECT count(*) FROM public.seller_appointments a WHERE a.sdr_id = v_seller_id AND a.source = 'sdr_handoff' AND a.status <> 'cancelado' AND a.created_at >= v_month_start AND a.created_at < v_month_end),
    (SELECT count(*) FROM public.seller_appointments a WHERE a.seller_id = v_seller_id AND a.type = 'reuniao' AND a.status = 'concluido' AND a.completed_at >= v_day_start AND a.completed_at < v_day_end),
    (SELECT count(*) FROM public.seller_appointments a WHERE a.seller_id = v_seller_id AND a.type = 'reuniao' AND a.status = 'concluido' AND a.completed_at >= v_week_start AND a.completed_at < v_week_end),
    (SELECT count(*) FROM public.seller_appointments a WHERE a.seller_id = v_seller_id AND a.type = 'reuniao' AND a.status = 'concluido' AND a.completed_at >= v_month_start AND a.completed_at < v_month_end)
  FROM (SELECT 1) AS singleton
  LEFT JOIN public.seller_goals AS goal
    ON goal.seller_id = v_seller_id AND goal.month = v_month AND goal.year = v_year;
END;
$$;

-- Visao da equipe para a aba Metas do administrador (mes navegavel; os
-- totais diario/semanal sempre refletem hoje/esta semana).
CREATE OR REPLACE FUNCTION public.get_seller_team_goal_progress(
  p_month integer,
  p_year integer
)
RETURNS TABLE (
  seller_id uuid,
  seller_name text,
  seller_type text,
  target_clients_daily integer,
  target_clients_weekly integer,
  target_clients_monthly integer,
  target_meetings_scheduled_daily integer,
  target_meetings_scheduled_weekly integer,
  target_meetings_scheduled_monthly integer,
  target_meetings_completed_daily integer,
  target_meetings_completed_weekly integer,
  target_meetings_completed_monthly integer,
  clients_registered_daily bigint,
  clients_registered_weekly bigint,
  clients_registered_monthly bigint,
  meetings_scheduled_daily bigint,
  meetings_scheduled_weekly bigint,
  meetings_scheduled_monthly bigint,
  meetings_completed_daily bigint,
  meetings_completed_weekly bigint,
  meetings_completed_monthly bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_now_local timestamp := now() AT TIME ZONE 'America/Sao_Paulo';
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_week_start timestamptz;
  v_week_end timestamptz;
  v_month_start timestamptz;
  v_month_end timestamptz;
BEGIN
  IF NOT (
    public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  ) THEN
    RAISE EXCEPTION 'Apenas administradores podem consultar metas da equipe.';
  END IF;
  IF p_month < 1 OR p_month > 12 OR p_year < 2000 OR p_year > 9999 THEN
    RAISE EXCEPTION 'Mes ou ano invalido.';
  END IF;

  v_day_start := date_trunc('day', v_now_local) AT TIME ZONE 'America/Sao_Paulo';
  v_day_end := v_day_start + interval '1 day';
  v_week_start := date_trunc('week', v_now_local) AT TIME ZONE 'America/Sao_Paulo';
  v_week_end := v_week_start + interval '7 days';
  v_month_start := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'America/Sao_Paulo');
  v_month_end := v_month_start + interval '1 month';

  RETURN QUERY
  SELECT
    seller.id, seller.full_name, coalesce(seller.seller_type, 'sdr'),
    goal.target_clients_daily, goal.target_clients_weekly, goal.target_clients,
    goal.target_meetings_scheduled_daily, goal.target_meetings_scheduled_weekly, goal.target_meetings_scheduled_monthly,
    goal.target_meetings_completed_daily, goal.target_meetings_completed_weekly, goal.target_meetings_completed_monthly,
    (SELECT count(*) FROM public.seller_client_partnerships p WHERE p.seller_id = seller.id AND p.created_at >= v_day_start AND p.created_at < v_day_end),
    (SELECT count(*) FROM public.seller_client_partnerships p WHERE p.seller_id = seller.id AND p.created_at >= v_week_start AND p.created_at < v_week_end),
    (SELECT count(*) FROM public.seller_client_partnerships p WHERE p.seller_id = seller.id AND p.created_at >= v_month_start AND p.created_at < v_month_end),
    (SELECT count(*) FROM public.seller_appointments a WHERE a.sdr_id = seller.id AND a.source = 'sdr_handoff' AND a.status <> 'cancelado' AND a.created_at >= v_day_start AND a.created_at < v_day_end),
    (SELECT count(*) FROM public.seller_appointments a WHERE a.sdr_id = seller.id AND a.source = 'sdr_handoff' AND a.status <> 'cancelado' AND a.created_at >= v_week_start AND a.created_at < v_week_end),
    (SELECT count(*) FROM public.seller_appointments a WHERE a.sdr_id = seller.id AND a.source = 'sdr_handoff' AND a.status <> 'cancelado' AND a.created_at >= v_month_start AND a.created_at < v_month_end),
    (SELECT count(*) FROM public.seller_appointments a WHERE a.seller_id = seller.id AND a.type = 'reuniao' AND a.status = 'concluido' AND a.completed_at >= v_day_start AND a.completed_at < v_day_end),
    (SELECT count(*) FROM public.seller_appointments a WHERE a.seller_id = seller.id AND a.type = 'reuniao' AND a.status = 'concluido' AND a.completed_at >= v_week_start AND a.completed_at < v_week_end),
    (SELECT count(*) FROM public.seller_appointments a WHERE a.seller_id = seller.id AND a.type = 'reuniao' AND a.status = 'concluido' AND a.completed_at >= v_month_start AND a.completed_at < v_month_end)
  FROM public.internal_users AS seller
  LEFT JOIN public.seller_goals AS goal
    ON goal.seller_id = seller.id AND goal.month = p_month AND goal.year = p_year
  WHERE seller.role = 'vendedor' AND seller.status = 'ativo'
    AND NOT seller.exclude_from_commercial_metrics
    AND lower(seller.email) <> 'vendedornox@nox.com'
  ORDER BY seller.seller_type, seller.full_name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_seller_goal_progress() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_seller_team_goal_progress(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_seller_goal_progress() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_seller_team_goal_progress(integer, integer) TO authenticated;

COMMENT ON FUNCTION public.get_my_seller_goal_progress() IS
  'Progresso diario/semanal/mensal do vendedor autenticado: cadastros (SDR e Closer), reunioes agendadas (SDR) e reunioes realizadas (Closer).';
COMMENT ON FUNCTION public.get_seller_team_goal_progress(integer, integer) IS
  'Visao administrativa do progresso diario/semanal/mensal de toda a equipe comercial, para editar metas.';
