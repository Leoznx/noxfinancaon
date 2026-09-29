-- Jornadas inteligentes de qualificacao para a carteira comercial.
-- Mantem os contratos legados e adiciona RPCs versionadas para web e aplicativo.

ALTER TABLE public.seller_contact_leads
  ADD COLUMN IF NOT EXISTS lead_category text NOT NULL DEFAULT 'cold',
  ADD COLUMN IF NOT EXISTS rotation_locked boolean NOT NULL DEFAULT false;

ALTER TABLE public.seller_contact_leads
  DROP CONSTRAINT IF EXISTS seller_contact_leads_lead_category_check;
ALTER TABLE public.seller_contact_leads
  ADD CONSTRAINT seller_contact_leads_lead_category_check
  CHECK (lead_category IN ('cold', 'meeting_scheduled', 'potential'));

ALTER TABLE public.seller_contact_lead_tasks
  ADD COLUMN IF NOT EXISTS lead_category text NOT NULL DEFAULT 'cold',
  ADD COLUMN IF NOT EXISTS next_step text,
  ADD COLUMN IF NOT EXISTS response_notes text;

ALTER TABLE public.seller_contact_lead_tasks
  DROP CONSTRAINT IF EXISTS seller_contact_lead_tasks_attempt_no_check,
  DROP CONSTRAINT IF EXISTS seller_contact_lead_tasks_lead_category_check,
  DROP CONSTRAINT IF EXISTS seller_contact_lead_tasks_next_step_check;
ALTER TABLE public.seller_contact_lead_tasks
  ADD CONSTRAINT seller_contact_lead_tasks_attempt_no_check
    CHECK (attempt_no BETWEEN 1 AND 4),
  ADD CONSTRAINT seller_contact_lead_tasks_lead_category_check
    CHECK (lead_category IN ('cold', 'meeting_scheduled', 'potential')),
  ADD CONSTRAINT seller_contact_lead_tasks_next_step_check
    CHECK (
      next_step IS NULL
      OR next_step IN (
        'continue_follow_up', 'cold', 'meeting_scheduled', 'potential',
        'converted', 'not_interested'
      )
    );

UPDATE public.seller_contact_leads
SET rotation_locked = (lead_category = 'meeting_scheduled')
WHERE rotation_locked IS DISTINCT FROM (lead_category = 'meeting_scheduled');

UPDATE public.seller_contact_lead_tasks AS task
SET lead_category = lead.lead_category
FROM public.seller_contact_leads AS lead
WHERE lead.id = task.lead_id
  AND task.lead_category IS DISTINCT FROM lead.lead_category;

CREATE OR REPLACE FUNCTION public.seller_contact_lead_attempt_limit(
  p_category text
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_category
    WHEN 'potential' THEN 4
    WHEN 'meeting_scheduled' THEN 1
    ELSE 2
  END;
$$;

CREATE OR REPLACE FUNCTION public.seller_contact_lead_category_label(
  p_category text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_category
    WHEN 'potential' THEN 'Lead em potencial'
    WHEN 'meeting_scheduled' THEN 'Lead marcou reunião'
    ELSE 'Lead frio'
  END;
$$;

CREATE OR REPLACE FUNCTION public.seller_contact_lead_task_at(
  p_lead_id uuid,
  p_cycle_number integer,
  p_attempt_no integer,
  p_cycle_started_at timestamptz
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_category text := 'cold';
  v_limit integer;
  v_seed bigint;
  v_offset integer;
  v_day date;
  v_hour integer;
  v_minute integer;
BEGIN
  SELECT coalesce(lead.lead_category, 'cold')
  INTO v_category
  FROM public.seller_contact_leads AS lead
  WHERE lead.id = p_lead_id;

  v_limit := public.seller_contact_lead_attempt_limit(v_category);
  IF p_attempt_no NOT BETWEEN 1 AND v_limit OR p_cycle_number < 1 THEN
    RAISE EXCEPTION 'Tentativa ou ciclo invalido para a categoria do lead.';
  END IF;

  v_seed := (
    ('x' || substr(md5(
      p_lead_id::text || ':' || p_cycle_number::text || ':' || p_attempt_no::text
    ), 1, 8))::bit(32)::bigint
  );

  v_offset := CASE v_category
    WHEN 'meeting_scheduled' THEN 15
    WHEN 'potential' THEN CASE p_attempt_no
      WHEN 1 THEN 2 + (v_seed % 4)::integer
      WHEN 2 THEN 7 + (v_seed % 5)::integer
      WHEN 3 THEN 14 + (v_seed % 5)::integer
      ELSE 22 + (v_seed % 6)::integer
    END
    ELSE CASE p_attempt_no
      WHEN 1 THEN 3 + (v_seed % 8)::integer
      ELSE 18 + (v_seed % 10)::integer
    END
  END;

  v_day := public.next_seller_business_day(
    (p_cycle_started_at AT TIME ZONE 'America/Sao_Paulo')::date + v_offset
  );
  v_hour := 8 + ((v_seed / 10) % 10)::integer;
  v_minute := (((v_seed / 100) % 4) * 15)::integer;

  RETURN (v_day + make_time(v_hour, v_minute, 0))
    AT TIME ZONE 'America/Sao_Paulo';
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_seller_contact_lead_cycle(
  p_lead_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead public.seller_contact_leads%ROWTYPE;
  v_attempt integer;
  v_limit integer;
  v_due_at timestamptz;
  v_task_id uuid;
  v_created integer := 0;
  v_title_prefix text;
  v_notes text;
BEGIN
  SELECT lead.*
  INTO v_lead
  FROM public.seller_contact_leads AS lead
  WHERE lead.id = p_lead_id
  FOR UPDATE;

  IF v_lead.id IS NULL OR v_lead.status <> 'active'
     OR v_lead.current_seller_id IS NULL THEN
    RETURN 0;
  END IF;

  v_limit := public.seller_contact_lead_attempt_limit(v_lead.lead_category);
  v_title_prefix := CASE v_lead.lead_category
    WHEN 'potential' THEN '(LEAD EM POTENCIAL) '
    WHEN 'meeting_scheduled' THEN '(REUNIÃO MARCADA) '
    ELSE '(LEAD FRIO) '
  END;
  v_notes := CASE v_lead.lead_category
    WHEN 'potential' THEN 'Lead em potencial: quatro contatos em 30 dias. Registre o resultado e defina o próximo passo.'
    WHEN 'meeting_scheduled' THEN 'Lead com reunião marcada: acompanhamento exclusivo deste vendedor a cada 15 dias.'
    ELSE 'Lead frio: dois contatos em 30 dias. Registre o resultado e defina o próximo passo.'
  END;

  PERFORM set_config('nox.contact_lead_mutation', '1', true);

  FOR v_attempt IN 1..v_limit LOOP
    v_due_at := public.seller_contact_lead_task_at(
      v_lead.id, v_lead.cycle_number, v_attempt, v_lead.cycle_started_at
    );

    INSERT INTO public.seller_contact_lead_tasks (
      lead_id, seller_id, cycle_number, attempt_no, due_at, lead_category
    ) VALUES (
      v_lead.id, v_lead.current_seller_id, v_lead.cycle_number,
      v_attempt, v_due_at, v_lead.lead_category
    )
    ON CONFLICT (lead_id, cycle_number, attempt_no) DO NOTHING
    RETURNING id INTO v_task_id;

    IF v_task_id IS NOT NULL THEN
      INSERT INTO public.seller_appointments (
        seller_id, title, type, status, priority, scheduled_at,
        reminder_minutes, notes, source, duration_minutes,
        contact_name, contact_phone, visible_from, contact_lead_task_id
      ) VALUES (
        v_lead.current_seller_id,
        v_title_prefix || v_lead.full_name,
        'follow_up',
        'agendado',
        'alta',
        v_due_at,
        30,
        v_notes,
        'rotating_lead',
        20,
        v_lead.full_name,
        v_lead.phone_display,
        date_trunc('day', v_due_at AT TIME ZONE 'America/Sao_Paulo')
          AT TIME ZONE 'America/Sao_Paulo',
        v_task_id
      );
      v_created := v_created + 1;
    END IF;

    v_task_id := NULL;
  END LOOP;

  RETURN v_created;
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_seller_contact_lead(
  p_lead_id uuid,
  p_reason text,
  p_now timestamptz DEFAULT now(),
  p_source_task_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead public.seller_contact_leads%ROWTYPE;
  v_current public.internal_users%ROWTYPE;
  v_next_seller_id uuid;
  v_local_day date := (p_now AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT lead.*
  INTO v_lead
  FROM public.seller_contact_leads AS lead
  WHERE lead.id = p_lead_id
  FOR UPDATE;

  IF v_lead.id IS NULL OR v_lead.status <> 'active' OR v_lead.is_demo
     OR v_lead.rotation_locked OR v_lead.lead_category = 'meeting_scheduled' THEN
    RETURN NULL;
  END IF;

  SELECT seller.*
  INTO v_current
  FROM public.internal_users AS seller
  WHERE seller.id = v_lead.current_seller_id;

  SELECT candidate.id
  INTO v_next_seller_id
  FROM public.internal_users AS candidate
  WHERE candidate.role = 'vendedor'
    AND candidate.status = 'ativo'
    AND NOT coalesce(candidate.exclude_from_commercial_metrics, false)
    AND lower(candidate.email) <> 'vendedornox@nox.com'
    AND candidate.id IS DISTINCT FROM v_lead.current_seller_id
  ORDER BY
    CASE
      WHEN v_current.id IS NULL THEN 0
      WHEN (candidate.created_at, candidate.id) >
           (v_current.created_at, v_current.id) THEN 0
      ELSE 1
    END,
    candidate.created_at,
    candidate.id
  LIMIT 1;

  IF v_next_seller_id IS NULL THEN
    UPDATE public.seller_contact_leads
    SET rotation_due_at = (
          public.next_seller_business_day(v_local_day + 1) + time '08:00'
        ) AT TIME ZONE 'America/Sao_Paulo',
        updated_at = p_now
    WHERE id = v_lead.id;

    INSERT INTO public.seller_contact_lead_history (
      lead_id, seller_id, from_seller_id, event_type, metadata, occurred_at
    ) VALUES (
      v_lead.id, v_lead.current_seller_id, v_lead.current_seller_id,
      'rotation_deferred',
      jsonb_build_object('reason', p_reason, 'source_task_id', p_source_task_id),
      p_now
    );
    RETURN NULL;
  END IF;

  PERFORM set_config('nox.contact_lead_mutation', '1', true);

  UPDATE public.seller_appointments AS appointment
  SET status = 'cancelado', updated_at = p_now
  FROM public.seller_contact_lead_tasks AS task
  WHERE appointment.contact_lead_task_id = task.id
    AND task.lead_id = v_lead.id
    AND task.status = 'pending';

  UPDATE public.seller_contact_lead_tasks
  SET status = 'cancelled', updated_at = p_now
  WHERE lead_id = v_lead.id
    AND status = 'pending';

  UPDATE public.seller_contact_leads
  SET current_seller_id = v_next_seller_id,
      cycle_number = cycle_number + 1,
      cycle_started_at = p_now,
      rotation_due_at = p_now + interval '30 days',
      rotation_locked = false,
      no_response_count = 0,
      updated_at = p_now
  WHERE id = v_lead.id;

  INSERT INTO public.seller_contact_lead_history (
    lead_id, seller_id, from_seller_id, to_seller_id,
    event_type, metadata, occurred_at
  ) VALUES (
    v_lead.id, v_next_seller_id, v_lead.current_seller_id, v_next_seller_id,
    'transferred',
    jsonb_build_object(
      'reason', p_reason,
      'source_task_id', p_source_task_id,
      'lead_category', v_lead.lead_category
    ),
    p_now
  );

  INSERT INTO public.seller_commercial_events (
    seller_id, event_type, subject_type, subject_id,
    dedupe_key, metadata, occurred_at, is_demo
  ) VALUES (
    v_lead.current_seller_id,
    'lead_transferred',
    'seller_contact_lead',
    v_lead.id,
    'lead-transfer:' || v_lead.id::text || ':'
      || (v_lead.cycle_number + 1)::text,
    jsonb_build_object(
      'reason', p_reason,
      'to_seller_id', v_next_seller_id,
      'source_task_id', p_source_task_id,
      'lead_category', v_lead.lead_category
    ),
    p_now,
    false
  ) ON CONFLICT (dedupe_key) DO NOTHING;

  PERFORM public.schedule_seller_contact_lead_cycle(v_lead.id);
  RETURN v_next_seller_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_my_qualified_seller_contact_lead(
  p_name text,
  p_phone text,
  p_category text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller public.internal_users%ROWTYPE;
  v_phone text;
  v_name text := trim(coalesce(p_name, ''));
  v_category text := lower(trim(coalesce(p_category, '')));
  v_lead public.seller_contact_leads%ROWTYPE;
  v_local_day date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_event_id uuid;
  v_is_demo boolean;
  v_category_changed boolean := false;
BEGIN
  IF v_category NOT IN ('cold', 'meeting_scheduled', 'potential') THEN
    RAISE EXCEPTION 'Categoria invalida para o lead.';
  END IF;

  SELECT seller.*
  INTO v_seller
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid()
    AND seller.role = 'vendedor'
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_seller.id IS NULL THEN
    RAISE EXCEPTION 'Somente vendedores ativos podem cadastrar leads.';
  END IF;
  IF v_name = '' THEN
    RAISE EXCEPTION 'Informe o nome do lead.';
  END IF;

  v_phone := public.normalize_br_phone(p_phone);
  v_is_demo := coalesce(v_seller.exclude_from_commercial_metrics, false)
    OR lower(v_seller.email) = 'vendedornox@nox.com';
  PERFORM pg_advisory_xact_lock(hashtextextended('contact-lead:' || v_phone, 71));

  SELECT lead.*
  INTO v_lead
  FROM public.seller_contact_leads AS lead
  WHERE lead.phone_normalized = v_phone
  FOR UPDATE;

  IF v_lead.id IS NOT NULL THEN
    IF v_lead.status <> 'active'
       OR v_lead.current_seller_id IS DISTINCT FROM v_seller.id THEN
      RAISE EXCEPTION 'Este telefone ja pertence a outro fluxo comercial.';
    END IF;

    v_category_changed := v_lead.lead_category IS DISTINCT FROM v_category;
    IF v_category_changed THEN
      PERFORM set_config('nox.contact_lead_mutation', '1', true);
      UPDATE public.seller_appointments AS appointment
      SET status = 'cancelado', updated_at = now()
      FROM public.seller_contact_lead_tasks AS task
      WHERE appointment.contact_lead_task_id = task.id
        AND task.lead_id = v_lead.id
        AND task.status = 'pending';
      UPDATE public.seller_contact_lead_tasks
      SET status = 'cancelled', updated_at = now()
      WHERE lead_id = v_lead.id AND status = 'pending';
      UPDATE public.seller_contact_leads
      SET full_name = v_name,
          phone_display = trim(p_phone),
          lead_category = v_category,
          rotation_locked = (v_category = 'meeting_scheduled'),
          cycle_number = cycle_number + 1,
          cycle_started_at = now(),
          rotation_due_at = CASE
            WHEN v_category = 'meeting_scheduled' THEN now() + interval '15 days'
            ELSE now() + interval '30 days'
          END,
          no_response_count = 0,
          updated_at = now()
      WHERE id = v_lead.id;
      INSERT INTO public.seller_contact_lead_history (
        lead_id, seller_id, event_type, metadata
      ) VALUES (
        v_lead.id, v_seller.id, 'category_changed',
        jsonb_build_object(
          'from_category', v_lead.lead_category,
          'to_category', v_category,
          'source', 'manual_daily_lead'
        )
      );
      PERFORM public.schedule_seller_contact_lead_cycle(v_lead.id);
    ELSE
      UPDATE public.seller_contact_leads
      SET full_name = v_name, phone_display = trim(p_phone), updated_at = now()
      WHERE id = v_lead.id;
    END IF;

    INSERT INTO public.seller_commercial_events (
      seller_id, event_type, subject_type, subject_id,
      dedupe_key, metadata, is_demo
    ) VALUES (
      v_seller.id, 'lead_contacted', 'seller_contact_lead', v_lead.id,
      'lead-contacted:' || v_lead.id::text || ':' || v_seller.id::text
        || ':' || v_local_day::text,
      jsonb_build_object('source', 'manual_daily_lead', 'lead_category', v_category),
      v_is_demo
    ) ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id INTO v_event_id;

    IF v_event_id IS NOT NULL THEN
      UPDATE public.seller_contact_leads
      SET last_contacted_at = now(), updated_at = now()
      WHERE id = v_lead.id;
      INSERT INTO public.seller_contact_lead_history (
        lead_id, seller_id, event_type, outcome, metadata
      ) VALUES (
        v_lead.id, v_seller.id, 'contact_confirmed', 'em_contato',
        jsonb_build_object('source', 'manual_daily_lead', 'lead_category', v_category)
      );
    END IF;
    RETURN v_lead.id;
  END IF;

  INSERT INTO public.seller_contact_leads (
    full_name, phone_normalized, phone_display, current_seller_id,
    created_by, cycle_started_at, rotation_due_at,
    last_contacted_at, is_demo, lead_category, rotation_locked
  ) VALUES (
    v_name, v_phone, trim(p_phone), v_seller.id,
    auth.uid(), now(), CASE
      WHEN v_category = 'meeting_scheduled' THEN now() + interval '15 days'
      ELSE now() + interval '30 days'
    END,
    now(), v_is_demo, v_category, (v_category = 'meeting_scheduled')
  )
  RETURNING * INTO v_lead;

  INSERT INTO public.seller_contact_lead_history (
    lead_id, seller_id, event_type, outcome, metadata
  ) VALUES (
    v_lead.id, v_seller.id, 'lead_created', 'em_contato',
    jsonb_build_object('source', 'manual_daily_lead', 'lead_category', v_category)
  );

  INSERT INTO public.seller_commercial_events (
    seller_id, event_type, subject_type, subject_id,
    dedupe_key, metadata, is_demo
  ) VALUES (
    v_seller.id, 'lead_contacted', 'seller_contact_lead', v_lead.id,
    'lead-contacted:' || v_lead.id::text || ':' || v_seller.id::text
      || ':' || v_local_day::text,
    jsonb_build_object('source', 'manual_daily_lead', 'lead_category', v_category),
    v_is_demo
  ) ON CONFLICT (dedupe_key) DO NOTHING;

  PERFORM public.schedule_seller_contact_lead_cycle(v_lead.id);
  RETURN v_lead.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_qualified_seller_contact_leads(
  p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_id uuid;
  v_search text := trim(coalesce(p_search, ''));
  v_phone_search text := regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g');
  v_result jsonb;
BEGIN
  SELECT seller.id
  INTO v_seller_id
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid()
    AND seller.role = 'vendedor'
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_seller_id IS NULL THEN
    RAISE EXCEPTION 'Somente vendedores ativos podem consultar seus leads.';
  END IF;

  SELECT coalesce(jsonb_agg(row_payload ORDER BY updated_at DESC, lead_name), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      lead.updated_at,
      lead.full_name AS lead_name,
      jsonb_build_object(
        'lead_id', lead.id,
        'lead_name', lead.full_name,
        'phone', lead.phone_display,
        'status', lead.status,
        'lead_category', lead.lead_category,
        'category_label', public.seller_contact_lead_category_label(lead.lead_category),
        'follow_up_limit', public.seller_contact_lead_attempt_limit(lead.lead_category),
        'rotation_locked', lead.rotation_locked,
        'cycle_number', lead.cycle_number,
        'cycle_started_at', lead.cycle_started_at,
        'rotation_due_at', lead.rotation_due_at,
        'next_task_at', task_summary.next_task_at,
        'no_response_count', lead.no_response_count,
        'created_at', lead.created_at,
        'summary', jsonb_build_object(
          'pending_tasks', task_summary.pending_tasks,
          'completed_tasks', task_summary.completed_tasks,
          'missed_tasks', task_summary.missed_tasks,
          'next_task_at', task_summary.next_task_at,
          'last_contacted_at', lead.last_contacted_at,
          'lead_category', lead.lead_category,
          'follow_up_limit', public.seller_contact_lead_attempt_limit(lead.lead_category),
          'rotation_locked', lead.rotation_locked
        ),
        'history', coalesce(history_rows.items, '[]'::jsonb)
      ) AS row_payload
    FROM public.seller_contact_leads AS lead
    CROSS JOIN LATERAL (
      SELECT
        min(task.due_at) FILTER (WHERE task.status = 'pending') AS next_task_at,
        count(*) FILTER (WHERE task.status = 'pending')::integer AS pending_tasks,
        count(*) FILTER (WHERE task.status = 'completed')::integer AS completed_tasks,
        count(*) FILTER (WHERE task.status = 'missed')::integer AS missed_tasks
      FROM public.seller_contact_lead_tasks AS task
      WHERE task.lead_id = lead.id
    ) AS task_summary
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', item.id,
          'event_type', item.event_type,
          'outcome', item.outcome,
          'seller_id', item.seller_id,
          'seller_name', seller.full_name,
          'from_seller_id', item.from_seller_id,
          'to_seller_id', item.to_seller_id,
          'appointment_id', item.appointment_id,
          'metadata', item.metadata,
          'details', coalesce(item.metadata->>'notes', item.metadata->>'reason'),
          'occurred_at', item.occurred_at
        ) ORDER BY item.occurred_at DESC, item.id DESC
      ) AS items
      FROM public.seller_contact_lead_history AS item
      LEFT JOIN public.internal_users AS seller ON seller.id = item.seller_id
      WHERE item.lead_id = lead.id
    ) AS history_rows ON true
    WHERE lead.current_seller_id = v_seller_id
      AND (
        v_search = ''
        OR lead.full_name ILIKE '%' || v_search || '%'
        OR (
          v_phone_search <> ''
          AND lead.phone_normalized LIKE '%' || v_phone_search || '%'
        )
      )
  ) AS payload;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_to_qualified_seller_contact_lead_task(
  p_seller_id uuid,
  p_appointment_id uuid,
  p_outcome text,
  p_next_step text,
  p_notes text,
  p_now timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_appointment public.seller_appointments%ROWTYPE;
  v_task public.seller_contact_lead_tasks%ROWTYPE;
  v_lead public.seller_contact_leads%ROWTYPE;
  v_seller public.internal_users%ROWTYPE;
  v_local timestamp := p_now AT TIME ZONE 'America/Sao_Paulo';
  v_event_id uuid;
  v_new_seller_id uuid;
  v_transferred boolean := false;
  v_is_demo boolean;
  v_limit integer;
  v_target_category text;
  v_status text := 'active';
BEGIN
  IF p_outcome NOT IN ('em_contato', 'sem_retorno') THEN
    RAISE EXCEPTION 'Resultado invalido. Use em_contato ou sem_retorno.';
  END IF;
  IF p_next_step NOT IN (
    'continue_follow_up', 'cold', 'meeting_scheduled', 'potential',
    'converted', 'not_interested'
  ) THEN
    RAISE EXCEPTION 'Defina um proximo passo valido.';
  END IF;

  SELECT seller.* INTO v_seller
  FROM public.internal_users AS seller
  WHERE seller.id = p_seller_id
    AND seller.role = 'vendedor'
    AND seller.status = 'ativo';
  IF v_seller.id IS NULL THEN
    RAISE EXCEPTION 'Vendedor ativo nao encontrado.';
  END IF;

  IF extract(isodow FROM v_local) NOT BETWEEN 1 AND 5
     OR public.is_seller_business_holiday(v_local::date)
     OR v_local::time < time '08:00'
     OR v_local::time >= time '18:00' THEN
    RAISE EXCEPTION 'Responda em dia util, entre 08:00 e 18:00.';
  END IF;

  SELECT appointment.* INTO v_appointment
  FROM public.seller_appointments AS appointment
  WHERE appointment.id = p_appointment_id
    AND appointment.source = 'rotating_lead'
    AND appointment.seller_id = p_seller_id
  FOR UPDATE;
  IF v_appointment.id IS NULL THEN
    RAISE EXCEPTION 'Lembrete de lead nao encontrado.';
  END IF;

  SELECT task.* INTO v_task
  FROM public.seller_contact_lead_tasks AS task
  WHERE task.id = v_appointment.contact_lead_task_id
    AND task.seller_id = p_seller_id
  FOR UPDATE;

  SELECT lead.* INTO v_lead
  FROM public.seller_contact_leads AS lead
  WHERE lead.id = v_task.lead_id
  FOR UPDATE;

  IF v_task.id IS NULL OR v_task.status <> 'pending'
     OR v_lead.id IS NULL OR v_lead.status <> 'active'
     OR v_lead.current_seller_id <> p_seller_id
     OR v_task.cycle_number <> v_lead.cycle_number THEN
    RAISE EXCEPTION 'Este lembrete nao esta mais disponivel.';
  END IF;
  IF (v_task.due_at AT TIME ZONE 'America/Sao_Paulo')::date <> v_local::date THEN
    RAISE EXCEPTION 'Este lembrete so pode ser confirmado na data programada.';
  END IF;

  PERFORM set_config('nox.contact_lead_mutation', '1', true);
  v_is_demo := v_lead.is_demo
    OR coalesce(v_seller.exclude_from_commercial_metrics, false)
    OR lower(v_seller.email) = 'vendedornox@nox.com';

  UPDATE public.seller_contact_lead_tasks
  SET status = 'completed', outcome = p_outcome,
      next_step = p_next_step,
      response_notes = nullif(trim(coalesce(p_notes, '')), ''),
      responded_at = p_now, updated_at = p_now
  WHERE id = v_task.id;

  UPDATE public.seller_appointments
  SET status = 'concluido', completed_at = p_now, updated_at = p_now
  WHERE id = v_appointment.id;

  INSERT INTO public.seller_contact_lead_history (
    lead_id, seller_id, event_type, outcome, appointment_id,
    metadata, occurred_at
  ) VALUES (
    v_lead.id, p_seller_id, 'task_responded', p_outcome,
    v_appointment.id,
    jsonb_build_object(
      'task_id', v_task.id,
      'cycle_number', v_task.cycle_number,
      'attempt_no', v_task.attempt_no,
      'lead_category', v_lead.lead_category,
      'next_step', p_next_step,
      'notes', nullif(trim(coalesce(p_notes, '')), '')
    ),
    p_now
  );

  IF p_outcome = 'em_contato' THEN
    INSERT INTO public.seller_commercial_events (
      seller_id, event_type, subject_type, subject_id,
      dedupe_key, metadata, occurred_at, is_demo
    ) VALUES (
      p_seller_id, 'lead_contacted', 'seller_contact_lead', v_lead.id,
      'lead-contacted:' || v_lead.id::text || ':' || p_seller_id::text
        || ':' || v_local::date::text,
      jsonb_build_object(
        'source', 'qualified_lead_task',
        'task_id', v_task.id,
        'appointment_id', v_appointment.id,
        'lead_category', v_lead.lead_category,
        'next_step', p_next_step
      ),
      p_now,
      v_is_demo
    ) ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id INTO v_event_id;
  END IF;

  IF p_next_step IN ('converted', 'not_interested') THEN
    v_status := CASE WHEN p_next_step = 'converted' THEN 'converted' ELSE 'archived' END;
    UPDATE public.seller_appointments AS appointment
    SET status = 'cancelado', updated_at = p_now
    FROM public.seller_contact_lead_tasks AS task
    WHERE appointment.contact_lead_task_id = task.id
      AND task.lead_id = v_lead.id
      AND task.status = 'pending';
    UPDATE public.seller_contact_lead_tasks
    SET status = 'cancelled', updated_at = p_now
    WHERE lead_id = v_lead.id AND status = 'pending';
    UPDATE public.seller_contact_leads
    SET status = v_status,
        last_contacted_at = CASE WHEN p_outcome = 'em_contato' THEN p_now ELSE last_contacted_at END,
        updated_at = p_now
    WHERE id = v_lead.id;
  ELSIF p_next_step IN ('cold', 'meeting_scheduled', 'potential') THEN
    v_target_category := p_next_step;
    UPDATE public.seller_appointments AS appointment
    SET status = 'cancelado', updated_at = p_now
    FROM public.seller_contact_lead_tasks AS task
    WHERE appointment.contact_lead_task_id = task.id
      AND task.lead_id = v_lead.id
      AND task.status = 'pending';
    UPDATE public.seller_contact_lead_tasks
    SET status = 'cancelled', updated_at = p_now
    WHERE lead_id = v_lead.id AND status = 'pending';
    UPDATE public.seller_contact_leads
    SET lead_category = v_target_category,
        rotation_locked = (v_target_category = 'meeting_scheduled'),
        cycle_number = cycle_number + 1,
        cycle_started_at = p_now,
        rotation_due_at = CASE
          WHEN v_target_category = 'meeting_scheduled' THEN p_now + interval '15 days'
          ELSE p_now + interval '30 days'
        END,
        no_response_count = 0,
        last_contacted_at = CASE WHEN p_outcome = 'em_contato' THEN p_now ELSE last_contacted_at END,
        updated_at = p_now
    WHERE id = v_lead.id;
    INSERT INTO public.seller_contact_lead_history (
      lead_id, seller_id, event_type, metadata, occurred_at
    ) VALUES (
      v_lead.id, p_seller_id, 'category_changed',
      jsonb_build_object(
        'from_category', v_lead.lead_category,
        'to_category', v_target_category,
        'source_task_id', v_task.id
      ),
      p_now
    );
    PERFORM public.schedule_seller_contact_lead_cycle(v_lead.id);
  ELSIF v_lead.lead_category = 'meeting_scheduled' THEN
    UPDATE public.seller_contact_leads
    SET cycle_number = cycle_number + 1,
        cycle_started_at = p_now,
        rotation_due_at = p_now + interval '15 days',
        rotation_locked = true,
        no_response_count = CASE WHEN p_outcome = 'sem_retorno' THEN no_response_count + 1 ELSE 0 END,
        last_contacted_at = CASE WHEN p_outcome = 'em_contato' THEN p_now ELSE last_contacted_at END,
        updated_at = p_now
    WHERE id = v_lead.id;
    PERFORM public.schedule_seller_contact_lead_cycle(v_lead.id);
  ELSIF p_outcome = 'em_contato' THEN
    UPDATE public.seller_appointments AS appointment
    SET status = 'cancelado', updated_at = p_now
    FROM public.seller_contact_lead_tasks AS task
    WHERE appointment.contact_lead_task_id = task.id
      AND task.lead_id = v_lead.id
      AND task.status = 'pending';
    UPDATE public.seller_contact_lead_tasks
    SET status = 'cancelled', updated_at = p_now
    WHERE lead_id = v_lead.id AND status = 'pending';
    UPDATE public.seller_contact_leads
    SET cycle_number = cycle_number + 1,
        cycle_started_at = p_now,
        rotation_due_at = p_now + interval '30 days',
        rotation_locked = false,
        no_response_count = 0,
        last_contacted_at = p_now,
        updated_at = p_now
    WHERE id = v_lead.id;
    PERFORM public.schedule_seller_contact_lead_cycle(v_lead.id);
  ELSE
    v_limit := public.seller_contact_lead_attempt_limit(v_lead.lead_category);
    UPDATE public.seller_contact_leads
    SET no_response_count = no_response_count + 1,
        updated_at = p_now
    WHERE id = v_lead.id
    RETURNING * INTO v_lead;

    IF v_lead.no_response_count >= v_limit THEN
      v_new_seller_id := public.transfer_seller_contact_lead(
        v_lead.id, 'category_attempts_exhausted', p_now, v_task.id
      );
      v_transferred := v_new_seller_id IS NOT NULL;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'lead_id', v_lead.id,
    'task_id', v_task.id,
    'appointment_id', v_appointment.id,
    'outcome', p_outcome,
    'next_step', p_next_step,
    'lead_category', coalesce(v_target_category, v_lead.lead_category),
    'lead_status', v_status,
    'transferred', v_transferred,
    'new_seller_id', v_new_seller_id,
    'next_tasks', (
      SELECT coalesce(jsonb_agg(
        jsonb_build_object(
          'task_id', task.id,
          'appointment_id', appointment.id,
          'due_at', task.due_at,
          'attempt_no', task.attempt_no,
          'lead_category', task.lead_category
        ) ORDER BY task.due_at
      ), '[]'::jsonb)
      FROM public.seller_contact_lead_tasks AS task
      LEFT JOIN public.seller_appointments AS appointment
        ON appointment.contact_lead_task_id = task.id
      WHERE task.lead_id = v_lead.id
        AND task.status = 'pending'
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_to_my_qualified_seller_contact_lead_task(
  p_appointment_id uuid,
  p_outcome text,
  p_next_step text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_id uuid;
BEGIN
  SELECT seller.id INTO v_seller_id
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid()
    AND seller.role = 'vendedor'
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_seller_id IS NULL THEN
    RAISE EXCEPTION 'Somente vendedores ativos podem responder lembretes.';
  END IF;

  RETURN public.respond_to_qualified_seller_contact_lead_task(
    v_seller_id, p_appointment_id, p_outcome, p_next_step, p_notes, now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.process_seller_contact_lead_automation(
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_local_day date := (p_now AT TIME ZONE 'America/Sao_Paulo')::date;
  v_task record;
  v_lead record;
  v_next uuid;
  v_missed integer := 0;
  v_transferred integer := 0;
  v_expired integer := 0;
  v_recurring integer := 0;
BEGIN
  IF extract(isodow FROM v_local_day) BETWEEN 1 AND 5
     AND NOT public.is_seller_business_holiday(v_local_day) THEN
    FOR v_task IN
      SELECT
        task.id, task.lead_id, task.seller_id, task.cycle_number,
        lead.lead_category, lead.rotation_locked,
        appointment.id AS appointment_id
      FROM public.seller_contact_lead_tasks AS task
      JOIN public.seller_contact_leads AS lead ON lead.id = task.lead_id
      LEFT JOIN public.seller_appointments AS appointment
        ON appointment.contact_lead_task_id = task.id
      WHERE task.status = 'pending'
        AND (task.due_at AT TIME ZONE 'America/Sao_Paulo')::date < v_local_day
        AND lead.status = 'active'
        AND NOT lead.is_demo
        AND lead.current_seller_id = task.seller_id
        AND lead.cycle_number = task.cycle_number
      ORDER BY task.due_at, task.id
      FOR UPDATE OF task SKIP LOCKED
    LOOP
      PERFORM set_config('nox.contact_lead_mutation', '1', true);
      UPDATE public.seller_contact_lead_tasks
      SET status = 'missed', updated_at = p_now
      WHERE id = v_task.id AND status = 'pending';
      IF NOT FOUND THEN CONTINUE; END IF;

      UPDATE public.seller_appointments
      SET status = 'nao_compareceu', updated_at = p_now
      WHERE id = v_task.appointment_id;

      INSERT INTO public.seller_contact_lead_history (
        lead_id, seller_id, event_type, appointment_id,
        metadata, occurred_at
      ) VALUES (
        v_task.lead_id, v_task.seller_id, 'task_missed',
        v_task.appointment_id,
        jsonb_build_object(
          'task_id', v_task.id,
          'lead_category', v_task.lead_category
        ),
        p_now
      );

      INSERT INTO public.seller_commercial_events (
        seller_id, event_type, subject_type, subject_id,
        dedupe_key, metadata, occurred_at, is_demo
      ) VALUES (
        v_task.seller_id, 'lead_task_missed', 'seller_contact_lead',
        v_task.lead_id,
        'lead-task-missed:' || v_task.id::text,
        jsonb_build_object(
          'task_id', v_task.id,
          'appointment_id', v_task.appointment_id,
          'lead_category', v_task.lead_category
        ),
        p_now,
        false
      ) ON CONFLICT (dedupe_key) DO NOTHING;

      v_missed := v_missed + 1;
      IF v_task.lead_category = 'meeting_scheduled' OR v_task.rotation_locked THEN
        UPDATE public.seller_contact_leads
        SET cycle_number = cycle_number + 1,
            cycle_started_at = p_now,
            rotation_due_at = p_now + interval '15 days',
            rotation_locked = true,
            no_response_count = no_response_count + 1,
            updated_at = p_now
        WHERE id = v_task.lead_id;
        PERFORM public.schedule_seller_contact_lead_cycle(v_task.lead_id);
        v_recurring := v_recurring + 1;
      ELSE
        v_next := public.transfer_seller_contact_lead(
          v_task.lead_id, 'missed_confirmation', p_now, v_task.id
        );
        IF v_next IS NOT NULL THEN v_transferred := v_transferred + 1; END IF;
      END IF;
    END LOOP;

    FOR v_lead IN
      SELECT lead.id, lead.current_seller_id
      FROM public.seller_contact_leads AS lead
      WHERE lead.status = 'active'
        AND NOT lead.is_demo
        AND NOT lead.rotation_locked
        AND lead.lead_category <> 'meeting_scheduled'
        AND (
          lead.current_seller_id IS NULL
          OR lead.rotation_due_at <= p_now
        )
      ORDER BY lead.rotation_due_at, lead.id
      FOR UPDATE SKIP LOCKED
    LOOP
      v_next := public.transfer_seller_contact_lead(
        v_lead.id,
        CASE
          WHEN v_lead.current_seller_id IS NULL THEN 'orphaned_owner'
          ELSE 'cycle_expired'
        END,
        p_now,
        NULL
      );
      IF v_next IS NOT NULL THEN
        v_expired := v_expired + 1;
        v_transferred := v_transferred + 1;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'processed_at', p_now,
    'missed_tasks', v_missed,
    'expired_leads', v_expired,
    'transferred_leads', v_transferred,
    'recurring_meeting_leads', v_recurring
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_my_qualified_seller_contact_lead(text, text, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_qualified_seller_contact_leads(text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_to_my_qualified_seller_contact_lead_task(uuid, text, text, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_to_qualified_seller_contact_lead_task(uuid, uuid, text, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_my_qualified_seller_contact_lead(text, text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_qualified_seller_contact_leads(text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.respond_to_my_qualified_seller_contact_lead_task(uuid, text, text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.respond_to_qualified_seller_contact_lead_task(uuid, uuid, text, text, text, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.create_my_qualified_seller_contact_lead(text, text, text)
  IS 'Cadastra ou requalifica lead nas jornadas frio, reuniao marcada ou potencial.';
COMMENT ON FUNCTION public.respond_to_my_qualified_seller_contact_lead_task(uuid, text, text, text)
  IS 'Registra o resultado e o proximo passo obrigatorio de um follow-up comercial.';
COMMENT ON COLUMN public.seller_contact_leads.lead_category
  IS 'cold: 2 contatos/30d; potential: 4 contatos/30d; meeting_scheduled: recorrencia exclusiva a cada 15d.';
