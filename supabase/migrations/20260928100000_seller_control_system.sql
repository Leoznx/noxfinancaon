-- Controle comercial compartilhado entre web e aplicativo.
--
-- Esta migracao e deliberadamente aditiva: preserva os contratos de agenda,
-- metas, links e cadastros existentes e cria um dominio isolado para os leads
-- de contato que alternam automaticamente entre vendedores.

ALTER TABLE public.seller_team_goals
  ADD COLUMN IF NOT EXISTS target_calls_daily integer,
  ADD COLUMN IF NOT EXISTS target_leads_contacted_daily integer;

ALTER TABLE public.seller_team_goals
  DROP CONSTRAINT IF EXISTS seller_team_goals_target_calls_daily_check,
  DROP CONSTRAINT IF EXISTS seller_team_goals_target_leads_contacted_daily_check;

ALTER TABLE public.seller_team_goals
  ADD CONSTRAINT seller_team_goals_target_calls_daily_check
    CHECK (target_calls_daily IS NULL OR target_calls_daily >= 0),
  ADD CONSTRAINT seller_team_goals_target_leads_contacted_daily_check
    CHECK (
      target_leads_contacted_daily IS NULL
      OR target_leads_contacted_daily >= 0
    );

CREATE TABLE IF NOT EXISTS public.seller_contact_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL CHECK (nullif(trim(full_name), '') IS NOT NULL),
  phone_normalized text NOT NULL UNIQUE,
  phone_display text NOT NULL,
  current_seller_id uuid REFERENCES public.internal_users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'converted', 'archived')),
  cycle_number integer NOT NULL DEFAULT 1 CHECK (cycle_number >= 1),
  cycle_started_at timestamptz NOT NULL DEFAULT now(),
  rotation_due_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  no_response_count integer NOT NULL DEFAULT 0 CHECK (no_response_count >= 0),
  last_contacted_at timestamptz,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seller_contact_leads_owner_status_idx
  ON public.seller_contact_leads (current_seller_id, status, rotation_due_at);
CREATE INDEX IF NOT EXISTS seller_contact_leads_rotation_idx
  ON public.seller_contact_leads (rotation_due_at)
  WHERE status = 'active' AND NOT is_demo;

CREATE TABLE IF NOT EXISTS public.seller_contact_lead_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL
    REFERENCES public.seller_contact_leads(id) ON DELETE CASCADE,
  seller_id uuid REFERENCES public.internal_users(id) ON DELETE SET NULL,
  cycle_number integer NOT NULL CHECK (cycle_number >= 1),
  attempt_no integer NOT NULL CHECK (attempt_no IN (1, 2)),
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'missed', 'cancelled')),
  outcome text CHECK (outcome IS NULL OR outcome IN ('em_contato', 'sem_retorno')),
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, cycle_number, attempt_no)
);

CREATE INDEX IF NOT EXISTS seller_contact_lead_tasks_due_idx
  ON public.seller_contact_lead_tasks (due_at, status)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS seller_contact_lead_tasks_owner_idx
  ON public.seller_contact_lead_tasks (seller_id, status, due_at);

CREATE TABLE IF NOT EXISTS public.seller_contact_lead_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL
    REFERENCES public.seller_contact_leads(id) ON DELETE CASCADE,
  seller_id uuid REFERENCES public.internal_users(id) ON DELETE SET NULL,
  from_seller_id uuid REFERENCES public.internal_users(id) ON DELETE SET NULL,
  to_seller_id uuid REFERENCES public.internal_users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  outcome text CHECK (outcome IS NULL OR outcome IN ('em_contato', 'sem_retorno')),
  appointment_id uuid REFERENCES public.seller_appointments(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seller_contact_lead_history_lead_idx
  ON public.seller_contact_lead_history (lead_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS seller_contact_lead_history_seller_idx
  ON public.seller_contact_lead_history (seller_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.seller_commercial_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Mantem o identificador no log mesmo se a conta interna for removida.
  -- Nao ha FK aqui para que a trilha append-only nao bloqueie o purge admin.
  seller_id uuid,
  event_type text NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid,
  dedupe_key text NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seller_commercial_events_seller_period_idx
  ON public.seller_commercial_events (seller_id, occurred_at DESC, event_type);

ALTER TABLE public.seller_appointments
  ADD COLUMN IF NOT EXISTS contact_lead_task_id uuid
    REFERENCES public.seller_contact_lead_tasks(id) ON DELETE RESTRICT;

ALTER TABLE public.seller_appointments
  DROP CONSTRAINT IF EXISTS seller_appointments_source_check;
ALTER TABLE public.seller_appointments
  ADD CONSTRAINT seller_appointments_source_check
  CHECK (
    source IN (
      'manual', 'admin', 'lead_follow_up', 'sdr_handoff',
      'meeting_follow_up', 'rotating_lead'
    )
  );

ALTER TABLE public.seller_appointments
  DROP CONSTRAINT IF EXISTS seller_appointments_contact_lead_task_check;
ALTER TABLE public.seller_appointments
  ADD CONSTRAINT seller_appointments_contact_lead_task_check
  CHECK (
    (source = 'rotating_lead' AND contact_lead_task_id IS NOT NULL)
    OR (source <> 'rotating_lead' AND contact_lead_task_id IS NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS seller_appointments_contact_lead_task_key
  ON public.seller_appointments (contact_lead_task_id)
  WHERE contact_lead_task_id IS NOT NULL;

ALTER TABLE public.seller_contact_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_contact_lead_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_contact_lead_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_commercial_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.seller_contact_leads FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.seller_contact_lead_tasks FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.seller_contact_lead_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.seller_commercial_events FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.seller_contact_leads TO authenticated;
GRANT SELECT ON public.seller_contact_lead_tasks TO authenticated;
GRANT SELECT ON public.seller_contact_lead_history TO authenticated;
GRANT SELECT ON public.seller_commercial_events TO authenticated;
GRANT ALL ON public.seller_contact_leads TO service_role;
GRANT ALL ON public.seller_contact_lead_tasks TO service_role;
GRANT ALL ON public.seller_contact_lead_history TO service_role;
GRANT ALL ON public.seller_commercial_events TO service_role;

DROP POLICY IF EXISTS "seller contact leads owner or admin read"
  ON public.seller_contact_leads;
CREATE POLICY "seller contact leads owner or admin read"
  ON public.seller_contact_leads FOR SELECT TO authenticated
  USING (
    current_seller_id = public.internal_user_id(auth.uid())
    OR public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  );

DROP POLICY IF EXISTS "seller contact tasks owner or admin read"
  ON public.seller_contact_lead_tasks;
CREATE POLICY "seller contact tasks owner or admin read"
  ON public.seller_contact_lead_tasks FOR SELECT TO authenticated
  USING (
    seller_id = public.internal_user_id(auth.uid())
    OR public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  );

DROP POLICY IF EXISTS "seller contact history current owner or admin read"
  ON public.seller_contact_lead_history;
CREATE POLICY "seller contact history current owner or admin read"
  ON public.seller_contact_lead_history FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.seller_contact_leads AS lead
      WHERE lead.id = seller_contact_lead_history.lead_id
        AND lead.current_seller_id = public.internal_user_id(auth.uid())
    )
    OR public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  );

DROP POLICY IF EXISTS "seller commercial events owner or admin read"
  ON public.seller_commercial_events;
CREATE POLICY "seller commercial events owner or admin read"
  ON public.seller_commercial_events FOR SELECT TO authenticated
  USING (
    seller_id = public.internal_user_id(auth.uid())
    OR public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  );

CREATE OR REPLACE FUNCTION public.guard_seller_commercial_event_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Eventos comerciais sao imutaveis.';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_seller_commercial_event_immutability
  ON public.seller_commercial_events;
CREATE TRIGGER trg_guard_seller_commercial_event_immutability
BEFORE UPDATE OR DELETE ON public.seller_commercial_events
FOR EACH ROW EXECUTE FUNCTION public.guard_seller_commercial_event_immutability();

CREATE OR REPLACE FUNCTION public.guard_rotating_lead_appointment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- O purge administrativo usa service_role (auth.uid nulo) e precisa
  -- continuar removendo a agenda da conta excluida.
  IF TG_OP = 'DELETE'
     AND (
       auth.uid() IS NULL
       OR public.is_admin(auth.uid())
       OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
     ) THEN
    RETURN OLD;
  END IF;

  IF (
    (TG_OP = 'INSERT' AND NEW.source = 'rotating_lead')
    OR (TG_OP IN ('UPDATE', 'DELETE') AND OLD.source = 'rotating_lead')
  ) AND coalesce(current_setting('nox.contact_lead_mutation', true), '') <> '1' THEN
    RAISE EXCEPTION
      'Use os comandos do lead em contato para alterar este lembrete.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_rotating_lead_appointment
  ON public.seller_appointments;
CREATE TRIGGER trg_guard_rotating_lead_appointment
BEFORE INSERT OR UPDATE OR DELETE ON public.seller_appointments
FOR EACH ROW EXECUTE FUNCTION public.guard_rotating_lead_appointment();

CREATE OR REPLACE FUNCTION public.record_seller_appointment_reschedule_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor public.internal_users%ROWTYPE;
BEGIN
  IF NEW.scheduled_at IS NOT DISTINCT FROM OLD.scheduled_at THEN
    RETURN NEW;
  END IF;

  SELECT seller.*
  INTO v_actor
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid()
    AND seller.role = 'vendedor'
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_actor.id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.seller_commercial_events (
    seller_id, event_type, subject_type, subject_id, dedupe_key,
    metadata, occurred_at, is_demo
  ) VALUES (
    v_actor.id,
    'meeting_rescheduled',
    'seller_appointment',
    NEW.id,
    'reschedule:' || NEW.id::text || ':' || txid_current()::text || ':'
      || statement_timestamp()::text,
    jsonb_build_object(
      'old_scheduled_at', OLD.scheduled_at,
      'new_scheduled_at', NEW.scheduled_at,
      'source', NEW.source,
      'type', NEW.type
    ),
    statement_timestamp(),
    coalesce(v_actor.exclude_from_commercial_metrics, false)
      OR lower(v_actor.email) = 'vendedornox@nox.com'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_seller_appointment_reschedule_event
  ON public.seller_appointments;
CREATE TRIGGER trg_record_seller_appointment_reschedule_event
AFTER UPDATE OF scheduled_at ON public.seller_appointments
FOR EACH ROW
WHEN (NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at)
EXECUTE FUNCTION public.record_seller_appointment_reschedule_event();

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
  v_seed bigint;
  v_offset integer;
  v_day date;
  v_hour integer;
  v_minute integer;
BEGIN
  IF p_attempt_no NOT IN (1, 2) OR p_cycle_number < 1 THEN
    RAISE EXCEPTION 'Tentativa ou ciclo invalido.';
  END IF;

  v_seed := (
    ('x' || substr(md5(
      p_lead_id::text || ':' || p_cycle_number::text || ':' || p_attempt_no::text
    ), 1, 8))::bit(32)::bigint
  );
  v_offset := CASE
    WHEN p_attempt_no = 1 THEN 2 + (v_seed % 10)::integer
    ELSE 15 + (v_seed % 11)::integer
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
  v_due_at timestamptz;
  v_task_id uuid;
  v_created integer := 0;
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

  PERFORM set_config('nox.contact_lead_mutation', '1', true);

  FOR v_attempt IN 1..2 LOOP
    v_due_at := public.seller_contact_lead_task_at(
      v_lead.id, v_lead.cycle_number, v_attempt, v_lead.cycle_started_at
    );

    INSERT INTO public.seller_contact_lead_tasks (
      lead_id, seller_id, cycle_number, attempt_no, due_at
    ) VALUES (
      v_lead.id, v_lead.current_seller_id, v_lead.cycle_number,
      v_attempt, v_due_at
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
        '(LEAD NOVO) ' || v_lead.full_name,
        'follow_up',
        'agendado',
        'alta',
        v_due_at,
        30,
        'Lead em rotacao. Confirme no mesmo dia como em contato ou sem retorno.',
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

  IF v_lead.id IS NULL OR v_lead.status <> 'active' OR v_lead.is_demo THEN
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
      no_response_count = 0,
      updated_at = p_now
  WHERE id = v_lead.id;

  INSERT INTO public.seller_contact_lead_history (
    lead_id, seller_id, from_seller_id, to_seller_id,
    event_type, metadata, occurred_at
  ) VALUES (
    v_lead.id, v_next_seller_id, v_lead.current_seller_id, v_next_seller_id,
    'transferred',
    jsonb_build_object('reason', p_reason, 'source_task_id', p_source_task_id),
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
      'source_task_id', p_source_task_id
    ),
    p_now,
    false
  ) ON CONFLICT (dedupe_key) DO NOTHING;

  PERFORM public.schedule_seller_contact_lead_cycle(v_lead.id);
  RETURN v_next_seller_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_seller_control_goals(
  p_seller_type text,
  p_month integer,
  p_year integer,
  p_target_calls_daily integer,
  p_target_leads_contacted_daily integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_goal public.seller_team_goals%ROWTYPE;
BEGIN
  IF NOT (
    public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  ) THEN
    RAISE EXCEPTION 'Apenas administradores podem definir estas metas.';
  END IF;

  IF p_seller_type NOT IN ('sdr', 'closer') THEN
    RAISE EXCEPTION 'Equipe comercial invalida.';
  END IF;
  IF p_month NOT BETWEEN 1 AND 12 OR p_year NOT BETWEEN 2000 AND 9999 THEN
    RAISE EXCEPTION 'Mes ou ano invalido.';
  END IF;
  IF p_target_calls_daily IS NULL OR p_target_calls_daily < 0
     OR p_target_leads_contacted_daily IS NULL
     OR p_target_leads_contacted_daily < 0 THEN
    RAISE EXCEPTION 'As metas devem ser numeros inteiros maiores ou iguais a zero.';
  END IF;

  INSERT INTO public.seller_team_goals (
    seller_type, month, year,
    target_calls_daily, target_leads_contacted_daily, updated_at
  ) VALUES (
    p_seller_type, p_month, p_year,
    p_target_calls_daily, p_target_leads_contacted_daily, now()
  )
  ON CONFLICT (seller_type, month, year) DO UPDATE
  SET target_calls_daily = EXCLUDED.target_calls_daily,
      target_leads_contacted_daily = EXCLUDED.target_leads_contacted_daily,
      updated_at = now()
  RETURNING * INTO v_goal;

  RETURN jsonb_build_object(
    'seller_type', v_goal.seller_type,
    'month', v_goal.month,
    'year', v_goal.year,
    'calls_daily', v_goal.target_calls_daily,
    'leads_contacted_daily', v_goal.target_leads_contacted_daily,
    'updated_at', v_goal.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_my_seller_contact_lead(
  p_name text,
  p_phone text
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
  v_lead public.seller_contact_leads%ROWTYPE;
  v_local_day date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_event_id uuid;
  v_is_demo boolean;
BEGIN
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

    INSERT INTO public.seller_commercial_events (
      seller_id, event_type, subject_type, subject_id,
      dedupe_key, metadata, is_demo
    ) VALUES (
      v_seller.id, 'lead_contacted', 'seller_contact_lead', v_lead.id,
      'lead-contacted:' || v_lead.id::text || ':' || v_seller.id::text
        || ':' || v_local_day::text,
      jsonb_build_object('source', 'manual_daily_lead'),
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
        jsonb_build_object('source', 'manual_daily_lead')
      );
    END IF;
    RETURN v_lead.id;
  END IF;

  INSERT INTO public.seller_contact_leads (
    full_name, phone_normalized, phone_display, current_seller_id,
    created_by, cycle_started_at, rotation_due_at,
    last_contacted_at, is_demo
  ) VALUES (
    v_name, v_phone, trim(p_phone), v_seller.id,
    auth.uid(), now(), now() + interval '30 days', now(), v_is_demo
  )
  RETURNING * INTO v_lead;

  INSERT INTO public.seller_contact_lead_history (
    lead_id, seller_id, event_type, outcome, metadata
  ) VALUES (
    v_lead.id, v_seller.id, 'lead_created', 'em_contato',
    jsonb_build_object('source', 'manual_daily_lead')
  );

  INSERT INTO public.seller_commercial_events (
    seller_id, event_type, subject_type, subject_id,
    dedupe_key, metadata, is_demo
  ) VALUES (
    v_seller.id, 'lead_contacted', 'seller_contact_lead', v_lead.id,
    'lead-contacted:' || v_lead.id::text || ':' || v_seller.id::text
      || ':' || v_local_day::text,
    jsonb_build_object('source', 'manual_daily_lead'),
    v_is_demo
  ) ON CONFLICT (dedupe_key) DO NOTHING;

  PERFORM public.schedule_seller_contact_lead_cycle(v_lead.id);
  RETURN v_lead.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_seller_contact_leads(
  p_search text DEFAULT NULL
)
RETURNS TABLE (
  lead_id uuid,
  lead_name text,
  phone text,
  status text,
  cycle_number integer,
  cycle_started_at timestamptz,
  rotation_due_at timestamptz,
  next_task_at timestamptz,
  no_response_count integer,
  created_at timestamptz,
  summary jsonb,
  history jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_id uuid;
  v_search text := trim(coalesce(p_search, ''));
  v_phone_search text := regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g');
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

  RETURN QUERY
  SELECT
    lead.id,
    lead.full_name,
    lead.phone_display,
    lead.status,
    lead.cycle_number,
    lead.cycle_started_at,
    lead.rotation_due_at,
    task_summary.next_task_at,
    lead.no_response_count,
    lead.created_at,
    jsonb_build_object(
      'pending_tasks', task_summary.pending_tasks,
      'completed_tasks', task_summary.completed_tasks,
      'missed_tasks', task_summary.missed_tasks,
      'next_task_at', task_summary.next_task_at,
      'last_contacted_at', lead.last_contacted_at
    ),
    coalesce(history_rows.items, '[]'::jsonb)
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
  ORDER BY lead.updated_at DESC, lead.full_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_to_seller_contact_lead_task(
  p_seller_id uuid,
  p_appointment_id uuid,
  p_outcome text,
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
BEGIN
  IF p_outcome NOT IN ('em_contato', 'sem_retorno') THEN
    RAISE EXCEPTION 'Resultado invalido. Use em_contato ou sem_retorno.';
  END IF;

  SELECT seller.*
  INTO v_seller
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

  SELECT appointment.*
  INTO v_appointment
  FROM public.seller_appointments AS appointment
  WHERE appointment.id = p_appointment_id
    AND appointment.source = 'rotating_lead'
    AND appointment.seller_id = p_seller_id
  FOR UPDATE;

  IF v_appointment.id IS NULL THEN
    RAISE EXCEPTION 'Lembrete de lead nao encontrado.';
  END IF;

  SELECT task.*
  INTO v_task
  FROM public.seller_contact_lead_tasks AS task
  WHERE task.id = v_appointment.contact_lead_task_id
    AND task.seller_id = p_seller_id
  FOR UPDATE;

  SELECT lead.*
  INTO v_lead
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
      'attempt_no', v_task.attempt_no
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
        'source', 'rotating_lead_task',
        'task_id', v_task.id,
        'appointment_id', v_appointment.id
      ),
      p_now,
      v_is_demo
    ) ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id INTO v_event_id;

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
    SET cycle_number = cycle_number + 1,
        cycle_started_at = p_now,
        rotation_due_at = p_now + interval '30 days',
        no_response_count = 0,
        last_contacted_at = p_now,
        updated_at = p_now
    WHERE id = v_lead.id;

    PERFORM public.schedule_seller_contact_lead_cycle(v_lead.id);
  ELSE
    UPDATE public.seller_contact_leads
    SET no_response_count = no_response_count + 1,
        updated_at = p_now
    WHERE id = v_lead.id
    RETURNING * INTO v_lead;

    IF v_lead.no_response_count >= 2 THEN
      v_new_seller_id := public.transfer_seller_contact_lead(
        v_lead.id, 'second_no_response', p_now, v_task.id
      );
      v_transferred := v_new_seller_id IS NOT NULL;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'lead_id', v_lead.id,
    'task_id', v_task.id,
    'appointment_id', v_appointment.id,
    'outcome', p_outcome,
    'transferred', v_transferred,
    'new_seller_id', v_new_seller_id,
    'next_tasks', (
      SELECT coalesce(jsonb_agg(
        jsonb_build_object(
          'task_id', task.id,
          'appointment_id', appointment.id,
          'due_at', task.due_at,
          'attempt_no', task.attempt_no
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

CREATE OR REPLACE FUNCTION public.respond_to_my_seller_contact_lead_task(
  p_appointment_id uuid,
  p_outcome text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_id uuid;
BEGIN
  SELECT seller.id
  INTO v_seller_id
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid()
    AND seller.role = 'vendedor'
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_seller_id IS NULL THEN
    RAISE EXCEPTION 'Somente vendedores ativos podem responder lembretes.';
  END IF;

  RETURN public.respond_to_seller_contact_lead_task(
    v_seller_id, p_appointment_id, p_outcome, now()
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
BEGIN
  -- A virada so ocorre em dia util. Assim, um lembrete de sexta-feira
  -- continua com o vendedor ate a segunda-feira seguinte.
  IF extract(isodow FROM v_local_day) BETWEEN 1 AND 5
     AND NOT public.is_seller_business_holiday(v_local_day) THEN
    FOR v_task IN
      SELECT
        task.id, task.lead_id, task.seller_id, task.cycle_number,
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
      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      UPDATE public.seller_appointments
      SET status = 'nao_compareceu', updated_at = p_now
      WHERE id = v_task.appointment_id;

      INSERT INTO public.seller_contact_lead_history (
        lead_id, seller_id, event_type, appointment_id,
        metadata, occurred_at
      ) VALUES (
        v_task.lead_id, v_task.seller_id, 'task_missed',
        v_task.appointment_id,
        jsonb_build_object('task_id', v_task.id),
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
          'appointment_id', v_task.appointment_id
        ),
        p_now,
        false
      ) ON CONFLICT (dedupe_key) DO NOTHING;

      v_missed := v_missed + 1;
      v_next := public.transfer_seller_contact_lead(
        v_task.lead_id, 'missed_confirmation', p_now, v_task.id
      );
      IF v_next IS NOT NULL THEN
        v_transferred := v_transferred + 1;
      END IF;
    END LOOP;

    FOR v_lead IN
      SELECT lead.id, lead.current_seller_id
      FROM public.seller_contact_leads AS lead
      WHERE lead.status = 'active'
        AND NOT lead.is_demo
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
    'transferred_leads', v_transferred
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_control_period_bounds(
  p_period text,
  p_anchor date
)
RETURNS TABLE (
  period_start date,
  period_end_exclusive date,
  starts_at timestamptz,
  ends_at timestamptz
)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_anchor date := coalesce(
    p_anchor,
    (now() AT TIME ZONE 'America/Sao_Paulo')::date
  );
BEGIN
  IF p_period NOT IN ('daily', 'weekly', 'monthly') THEN
    RAISE EXCEPTION 'Periodo invalido. Use daily, weekly ou monthly.';
  END IF;

  period_start := CASE p_period
    WHEN 'daily' THEN v_anchor
    WHEN 'weekly' THEN v_anchor - (extract(isodow FROM v_anchor)::integer - 1)
    ELSE date_trunc('month', v_anchor::timestamp)::date
  END;
  period_end_exclusive := CASE p_period
    WHEN 'daily' THEN period_start + 1
    WHEN 'weekly' THEN period_start + 7
    ELSE (period_start + interval '1 month')::date
  END;
  starts_at := period_start::timestamp AT TIME ZONE 'America/Sao_Paulo';
  ends_at := period_end_exclusive::timestamp AT TIME ZONE 'America/Sao_Paulo';
  RETURN NEXT;
END;
$$;

-- Algumas instalacoes antigas ainda nao possuem send_group_id. O evento e
-- convertido em JSON para que a chave opcional possa ser lida sem referenciar
-- uma coluna inexistente no catalogo. Quando ela nao existe ou esta vazia, o
-- proprio id do evento continua sendo a unidade contabilizada.
CREATE OR REPLACE FUNCTION public.seller_signup_link_send_event_key(
  p_event jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(
    nullif(trim(p_event->>'send_group_id'), ''),
    nullif(trim(p_event->>'id'), '')
  );
$$;

CREATE OR REPLACE FUNCTION public.seller_control_dashboard_for(
  p_seller_id uuid,
  p_period text,
  p_anchor date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller public.internal_users%ROWTYPE;
  v_start_date date;
  v_end_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_goals jsonb;
  v_metrics jsonb;
  v_daily jsonb;
  v_recent jsonb;
  v_include_demo boolean;
BEGIN
  SELECT seller.*
  INTO v_seller
  FROM public.internal_users AS seller
  WHERE seller.id = p_seller_id
    AND seller.role = 'vendedor';
  IF v_seller.id IS NULL THEN
    RAISE EXCEPTION 'Vendedor nao encontrado.';
  END IF;

  -- A conta de demonstracao precisa enxergar os proprios exemplos no painel.
  -- O relatorio administrativo continua removendo esta conta antes de chamar
  -- este helper, portanto dados demo nunca entram no consolidado real.
  v_include_demo := coalesce(
    v_seller.exclude_from_commercial_metrics,
    false
  );

  SELECT bounds.period_start, bounds.period_end_exclusive,
         bounds.starts_at, bounds.ends_at
  INTO v_start_date, v_end_date, v_start, v_end
  FROM public.seller_control_period_bounds(p_period, p_anchor) AS bounds;

  SELECT jsonb_build_object(
    'calls_daily', goal.target_calls_daily,
    'leads_contacted_daily', goal.target_leads_contacted_daily
  )
  INTO v_goals
  FROM (SELECT 1) AS singleton
  LEFT JOIN public.seller_team_goals AS goal
    ON goal.seller_type = coalesce(v_seller.seller_type, 'sdr')
   AND goal.month = extract(month FROM coalesce(p_anchor, current_date))::integer
   AND goal.year = extract(year FROM coalesce(p_anchor, current_date))::integer;

  SELECT jsonb_build_object(
    'leads_contacted', (
      SELECT count(*)::bigint
      FROM public.seller_commercial_events AS event
      WHERE event.seller_id = v_seller.id
        AND event.event_type = 'lead_contacted'
        AND event.occurred_at >= v_start AND event.occurred_at < v_end
        AND (v_include_demo OR NOT event.is_demo)
    ),
    'links_sent', (
      SELECT count(DISTINCT public.seller_signup_link_send_event_key(
        to_jsonb(send)
      ))::bigint
      FROM public.seller_signup_link_send_events AS send
      WHERE (send.seller_id = v_seller.id OR send.source_sdr_id = v_seller.id)
        AND send.created_at >= v_start AND send.created_at < v_end
    ),
    'registrations', public.count_seller_goal_registrations(
      v_seller.id, v_start, v_end
    ),
    'reschedules', (
      SELECT count(*)::bigint
      FROM public.seller_commercial_events AS event
      WHERE event.seller_id = v_seller.id
        AND event.event_type = 'meeting_rescheduled'
        AND event.occurred_at >= v_start AND event.occurred_at < v_end
        AND (v_include_demo OR NOT event.is_demo)
    ),
    'active_leads', (
      SELECT count(*)::bigint
      FROM public.seller_contact_leads AS lead
      WHERE lead.current_seller_id = v_seller.id
        AND lead.status = 'active'
        AND (v_include_demo OR NOT lead.is_demo)
    ),
    'missed_leads', (
      SELECT count(*)::bigint
      FROM public.seller_commercial_events AS event
      WHERE event.seller_id = v_seller.id
        AND event.event_type = 'lead_task_missed'
        AND event.occurred_at >= v_start AND event.occurred_at < v_end
        AND (v_include_demo OR NOT event.is_demo)
    )
  ) INTO v_metrics;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'date', series.day,
      'leads_contacted', (
        SELECT count(*)::bigint
        FROM public.seller_commercial_events AS event
        WHERE event.seller_id = v_seller.id
          AND event.event_type = 'lead_contacted'
          AND event.occurred_at >= series.day_start
          AND event.occurred_at < series.day_end
          AND (v_include_demo OR NOT event.is_demo)
      ),
      'links_sent', (
        SELECT count(DISTINCT public.seller_signup_link_send_event_key(
          to_jsonb(send)
        ))::bigint
        FROM public.seller_signup_link_send_events AS send
        WHERE (send.seller_id = v_seller.id OR send.source_sdr_id = v_seller.id)
          AND send.created_at >= series.day_start
          AND send.created_at < series.day_end
      ),
      'registrations', public.count_seller_goal_registrations(
        v_seller.id, series.day_start, series.day_end
      ),
      'reschedules', (
        SELECT count(*)::bigint
        FROM public.seller_commercial_events AS event
        WHERE event.seller_id = v_seller.id
          AND event.event_type = 'meeting_rescheduled'
          AND event.occurred_at >= series.day_start
          AND event.occurred_at < series.day_end
          AND (v_include_demo OR NOT event.is_demo)
      ),
      'missed_leads', (
        SELECT count(*)::bigint
        FROM public.seller_commercial_events AS event
        WHERE event.seller_id = v_seller.id
          AND event.event_type = 'lead_task_missed'
          AND event.occurred_at >= series.day_start
          AND event.occurred_at < series.day_end
          AND (v_include_demo OR NOT event.is_demo)
      )
    ) ORDER BY series.day
  ), '[]'::jsonb)
  INTO v_daily
  FROM (
    SELECT
      day_value::date AS day,
      day_value::date::timestamp AT TIME ZONE 'America/Sao_Paulo' AS day_start,
      (day_value::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo' AS day_end
    FROM generate_series(
      v_start_date::timestamp,
      (v_end_date - 1)::timestamp,
      interval '1 day'
    ) AS day_value
  ) AS series;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', recent.id,
      'event_type', recent.event_type,
      'subject_type', recent.subject_type,
      'subject_id', recent.subject_id,
      'metadata', recent.metadata,
      'occurred_at', recent.occurred_at
    ) ORDER BY recent.occurred_at DESC, recent.id DESC
  ), '[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT event.*
    FROM public.seller_commercial_events AS event
    WHERE event.seller_id = v_seller.id
      AND event.occurred_at >= v_start AND event.occurred_at < v_end
      AND (v_include_demo OR NOT event.is_demo)
    ORDER BY event.occurred_at DESC, event.id DESC
    LIMIT 20
  ) AS recent;

  RETURN jsonb_build_object(
    'period', jsonb_build_object(
      'kind', p_period,
      'start', v_start_date,
      'end', v_end_date - 1,
      'anchor', coalesce(p_anchor, current_date)
    ),
    'period_start', v_start_date,
    'period_end', v_end_date - 1,
    'anchor', coalesce(p_anchor, current_date),
    'seller', jsonb_build_object(
      'id', v_seller.id,
      'name', v_seller.full_name,
      'seller_type', coalesce(v_seller.seller_type, 'sdr')
    ),
    'goals', coalesce(v_goals, jsonb_build_object(
      'calls_daily', NULL, 'leads_contacted_daily', NULL
    )),
    'metrics', v_metrics,
    'daily_series', v_daily,
    'recent_events', v_recent
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_seller_control_dashboard(
  p_period text DEFAULT 'daily',
  p_anchor date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller public.internal_users%ROWTYPE;
BEGIN
  SELECT seller.*
  INTO v_seller
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid()
    AND seller.role = 'vendedor'
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_seller.id IS NULL THEN
    RAISE EXCEPTION 'Somente vendedores ativos podem consultar este painel.';
  END IF;

  RETURN public.seller_control_dashboard_for(
    v_seller.id, p_period, p_anchor
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_seller_control_report(
  p_period text DEFAULT 'daily',
  p_anchor date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller record;
  v_payload jsonb;
  v_sellers jsonb := '[]'::jsonb;
  v_totals jsonb;
  v_daily jsonb;
  v_start_date date;
  v_end_date date;
  v_unused_start timestamptz;
  v_unused_end timestamptz;
BEGIN
  IF NOT (
    public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  ) THEN
    RAISE EXCEPTION 'Apenas administradores podem consultar este relatorio.';
  END IF;

  SELECT bounds.period_start, bounds.period_end_exclusive,
         bounds.starts_at, bounds.ends_at
  INTO v_start_date, v_end_date, v_unused_start, v_unused_end
  FROM public.seller_control_period_bounds(p_period, p_anchor) AS bounds;

  FOR v_seller IN
    SELECT seller.id
    FROM public.internal_users AS seller
    WHERE seller.role = 'vendedor'
      AND seller.status = 'ativo'
      AND NOT coalesce(seller.exclude_from_commercial_metrics, false)
      AND lower(seller.email) <> 'vendedornox@nox.com'
    ORDER BY seller.full_name, seller.id
  LOOP
    v_payload := public.seller_control_dashboard_for(
      v_seller.id, p_period, p_anchor
    );
    v_sellers := v_sellers || jsonb_build_array(v_payload);
  END LOOP;

  SELECT jsonb_build_object(
    'leads_contacted', coalesce(sum(
      (seller_item->'metrics'->>'leads_contacted')::bigint
    ), 0),
    'links_sent', coalesce(sum(
      (seller_item->'metrics'->>'links_sent')::bigint
    ), 0),
    'registrations', coalesce(sum(
      (seller_item->'metrics'->>'registrations')::bigint
    ), 0),
    'reschedules', coalesce(sum(
      (seller_item->'metrics'->>'reschedules')::bigint
    ), 0),
    'active_leads', coalesce(sum(
      (seller_item->'metrics'->>'active_leads')::bigint
    ), 0),
    'missed_leads', coalesce(sum(
      (seller_item->'metrics'->>'missed_leads')::bigint
    ), 0)
  )
  INTO v_totals
  FROM jsonb_array_elements(v_sellers) AS seller_item;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'date', daily.date_value,
      'leads_contacted', daily.leads_contacted,
      'links_sent', daily.links_sent,
      'registrations', daily.registrations,
      'reschedules', daily.reschedules,
      'missed_leads', daily.missed_leads
    ) ORDER BY daily.date_value
  ), '[]'::jsonb)
  INTO v_daily
  FROM (
    SELECT
      day_item->>'date' AS date_value,
      sum((day_item->>'leads_contacted')::bigint) AS leads_contacted,
      sum((day_item->>'links_sent')::bigint) AS links_sent,
      sum((day_item->>'registrations')::bigint) AS registrations,
      sum((day_item->>'reschedules')::bigint) AS reschedules,
      sum((day_item->>'missed_leads')::bigint) AS missed_leads
    FROM jsonb_array_elements(v_sellers) AS seller_item
    CROSS JOIN LATERAL jsonb_array_elements(
      seller_item->'daily_series'
    ) AS day_item
    GROUP BY day_item->>'date'
  ) AS daily;

  RETURN jsonb_build_object(
    'period', jsonb_build_object(
      'kind', p_period,
      'start', v_start_date,
      'end', v_end_date - 1,
      'anchor', coalesce(p_anchor, current_date)
    ),
    'period_start', v_start_date,
    'period_end', v_end_date - 1,
    'anchor', coalesce(p_anchor, current_date),
    'totals', coalesce(v_totals, jsonb_build_object(
      'leads_contacted', 0,
      'links_sent', 0,
      'registrations', 0,
      'reschedules', 0,
      'active_leads', 0,
      'missed_leads', 0
    )),
    'sellers', v_sellers,
    'daily_series', coalesce(v_daily, '[]'::jsonb)
  );
END;
$$;

DROP TRIGGER IF EXISTS seller_contact_leads_updated_at
  ON public.seller_contact_leads;
CREATE TRIGGER seller_contact_leads_updated_at
BEFORE UPDATE ON public.seller_contact_leads
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS seller_contact_lead_tasks_updated_at
  ON public.seller_contact_lead_tasks;
CREATE TRIGGER seller_contact_lead_tasks_updated_at
BEFORE UPDATE ON public.seller_contact_lead_tasks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

REVOKE ALL ON FUNCTION public.seller_contact_lead_task_at(
  uuid, integer, integer, timestamptz
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.schedule_seller_contact_lead_cycle(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transfer_seller_contact_lead(
  uuid, text, timestamptz, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.respond_to_seller_contact_lead_task(
  uuid, uuid, text, timestamptz
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_control_period_bounds(text, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_signup_link_send_event_key(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_control_dashboard_for(
  uuid, text, date
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.upsert_seller_control_goals(
  text, integer, integer, integer, integer
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_my_seller_contact_lead(text, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_seller_contact_leads(text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_to_my_seller_contact_lead_task(uuid, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.process_seller_contact_lead_automation(timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_seller_control_dashboard(text, date)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_admin_seller_control_report(text, date)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.upsert_seller_control_goals(
  text, integer, integer, integer, integer
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_my_seller_contact_lead(text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_seller_contact_leads(text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_my_seller_contact_lead_task(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_seller_control_dashboard(text, date)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_seller_control_report(text, date)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_seller_contact_lead_automation(timestamptz)
  TO service_role;

DO $$
DECLARE
  v_table text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    FOREACH v_table IN ARRAY ARRAY[
      'seller_contact_leads',
      'seller_contact_lead_tasks',
      'seller_contact_lead_history',
      'seller_commercial_events'
    ] LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = v_table
      ) THEN
        EXECUTE format(
          'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
          v_table
        );
      END IF;
    END LOOP;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('nox-seller-contact-lead-automation')
    WHERE EXISTS (
      SELECT 1 FROM cron.job
      WHERE jobname = 'nox-seller-contact-lead-automation'
    );
    PERFORM cron.schedule(
      'nox-seller-contact-lead-automation',
      '0 * * * *',
      'SELECT public.process_seller_contact_lead_automation();'
    );
  ELSE
    RAISE NOTICE 'Cron de rotacao de leads nao agendado: pg_cron indisponivel.';
  END IF;
END;
$$;

-- Exemplos isolados para o login de demonstracao. Eles aparecem somente no
-- painel da propria conta e nunca entram no relatorio administrativo nem na
-- fila de rotacao real.
DO $$
DECLARE
  v_demo_seller public.internal_users%ROWTYPE;
  v_lead_id uuid;
  v_example record;
  v_local_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_demo_day date;
  v_first_due timestamptz;
  v_second_due timestamptz;
  v_cycle_number integer;
  v_cycle_started_at timestamptz;
BEGIN
  SELECT seller.*
  INTO v_demo_seller
  FROM public.internal_users AS seller
  WHERE lower(seller.email) = 'vendedornox@nox.com'
    AND seller.role = 'vendedor'
  LIMIT 1;

  IF v_demo_seller.id IS NULL THEN
    RETURN;
  END IF;

  v_demo_day := public.next_seller_business_day(v_local_today);
  v_first_due := (v_demo_day + time '10:00')
    AT TIME ZONE 'America/Sao_Paulo';

  FOR v_example IN
    SELECT * FROM (VALUES
      ('90000000-0000-4000-8000-000000000001'::uuid,
       'Mariana Exemplo', '11900009001', '(11) 90000-9001'),
      ('90000000-0000-4000-8000-000000000002'::uuid,
       'Rafael Exemplo', '11900009002', '(11) 90000-9002')
    ) AS example(id, full_name, phone_normalized, phone_display)
  LOOP
    INSERT INTO public.seller_contact_leads (
      id, full_name, phone_normalized, phone_display,
      current_seller_id, created_by, status, cycle_number,
      cycle_started_at, rotation_due_at, last_contacted_at, is_demo
    ) VALUES (
      v_example.id, v_example.full_name, v_example.phone_normalized,
      v_example.phone_display, v_demo_seller.id, v_demo_seller.auth_user_id,
      'active', 1, now(), now() + interval '30 days', now(), true
    )
    ON CONFLICT (phone_normalized) DO NOTHING;

    SELECT lead.id
    INTO v_lead_id
    FROM public.seller_contact_leads AS lead
    WHERE lead.phone_normalized = v_example.phone_normalized
      AND lead.current_seller_id = v_demo_seller.id
      AND lead.is_demo;

    IF v_lead_id IS NOT NULL THEN
      INSERT INTO public.seller_contact_lead_history (
        lead_id, seller_id, event_type, outcome, metadata
      )
      SELECT
        v_lead_id, v_demo_seller.id, 'lead_created', 'em_contato',
        jsonb_build_object('source', 'demo_seed')
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.seller_contact_lead_history AS history
        WHERE history.lead_id = v_lead_id
          AND history.event_type = 'lead_created'
          AND history.metadata->>'source' = 'demo_seed'
      );

      INSERT INTO public.seller_commercial_events (
        seller_id, event_type, subject_type, subject_id,
        dedupe_key, metadata, occurred_at, is_demo
      )
      SELECT
        v_demo_seller.id, 'lead_contacted', 'seller_contact_lead', v_lead_id,
        'demo:lead-contacted:' || v_lead_id::text || ':'
          || to_char(v_local_today, 'YYYY-MM-DD'),
        jsonb_build_object('source', 'demo_seed'), now(), true
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.seller_commercial_events AS event
        WHERE event.seller_id = v_demo_seller.id
          AND event.event_type = 'lead_contacted'
          AND event.subject_id = v_lead_id
          AND event.is_demo
          AND (event.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date
              = v_local_today
      )
      ON CONFLICT (dedupe_key) DO NOTHING;

      IF v_lead_id = '90000000-0000-4000-8000-000000000001'::uuid THEN
        -- Reaplicar a migracao restaura o exemplo sem criar outro ciclo. O
        -- primeiro lembrete fica visivel hoje (ou no proximo dia util), e a
        -- segunda tentativa continua deterministica e futura.
        UPDATE public.seller_contact_leads
        SET current_seller_id = v_demo_seller.id,
            created_by = v_demo_seller.auth_user_id,
            status = 'active',
            cycle_started_at = now(),
            rotation_due_at = now() + interval '30 days',
            no_response_count = 0,
            last_contacted_at = now(),
            is_demo = true,
            updated_at = now()
        WHERE id = v_lead_id
        RETURNING cycle_number, cycle_started_at
        INTO v_cycle_number, v_cycle_started_at;

        PERFORM set_config('nox.contact_lead_mutation', '1', true);

        UPDATE public.seller_appointments AS appointment
        SET status = 'cancelado', updated_at = now()
        FROM public.seller_contact_lead_tasks AS task
        WHERE appointment.contact_lead_task_id = task.id
          AND task.lead_id = v_lead_id
          AND task.cycle_number <> v_cycle_number
          AND task.status = 'pending';

        UPDATE public.seller_contact_lead_tasks
        SET status = 'cancelled', updated_at = now()
        WHERE lead_id = v_lead_id
          AND cycle_number <> v_cycle_number
          AND status = 'pending';

        PERFORM public.schedule_seller_contact_lead_cycle(v_lead_id);
        v_second_due := public.seller_contact_lead_task_at(
          v_lead_id, v_cycle_number, 2, v_cycle_started_at
        );

        UPDATE public.seller_contact_lead_tasks
        SET seller_id = v_demo_seller.id,
            due_at = CASE attempt_no
              WHEN 1 THEN v_first_due
              ELSE v_second_due
            END,
            status = 'pending',
            outcome = NULL,
            responded_at = NULL,
            updated_at = now()
        WHERE lead_id = v_lead_id
          AND cycle_number = v_cycle_number
          AND attempt_no IN (1, 2);

        INSERT INTO public.seller_appointments (
          seller_id, title, type, status, priority, scheduled_at,
          reminder_minutes, notes, source, duration_minutes,
          contact_name, contact_phone, visible_from, contact_lead_task_id
        )
        SELECT
          v_demo_seller.id,
          '(LEAD NOVO) ' || v_example.full_name,
          'follow_up',
          'agendado',
          'alta',
          task.due_at,
          30,
          'Lead em rotacao. Confirme no mesmo dia como em contato ou sem retorno.',
          'rotating_lead',
          20,
          v_example.full_name,
          v_example.phone_display,
          date_trunc(
            'day', task.due_at AT TIME ZONE 'America/Sao_Paulo'
          ) AT TIME ZONE 'America/Sao_Paulo',
          task.id
        FROM public.seller_contact_lead_tasks AS task
        WHERE task.lead_id = v_lead_id
          AND task.cycle_number = v_cycle_number
          AND task.attempt_no IN (1, 2)
        ON CONFLICT (contact_lead_task_id)
          WHERE contact_lead_task_id IS NOT NULL
        DO UPDATE SET
          seller_id = EXCLUDED.seller_id,
          title = EXCLUDED.title,
          type = EXCLUDED.type,
          status = EXCLUDED.status,
          priority = EXCLUDED.priority,
          scheduled_at = EXCLUDED.scheduled_at,
          reminder_minutes = EXCLUDED.reminder_minutes,
          notes = EXCLUDED.notes,
          source = EXCLUDED.source,
          duration_minutes = EXCLUDED.duration_minutes,
          contact_name = EXCLUDED.contact_name,
          contact_phone = EXCLUDED.contact_phone,
          visible_from = EXCLUDED.visible_from,
          completed_at = NULL,
          updated_at = now();
      ELSE
        PERFORM public.schedule_seller_contact_lead_cycle(v_lead_id);
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.seller_commercial_events (
    seller_id, event_type, subject_type, subject_id,
    dedupe_key, metadata, occurred_at, is_demo
  )
  SELECT
    v_demo_seller.id, 'meeting_rescheduled', 'seller_appointment', NULL,
    'demo:meeting-rescheduled:vendedornox:'
      || to_char(v_local_today, 'YYYY-MM-DD'),
    jsonb_build_object('source', 'demo_seed'), now(), true
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.seller_commercial_events AS event
    WHERE event.seller_id = v_demo_seller.id
      AND event.event_type = 'meeting_rescheduled'
      AND event.is_demo
      AND (event.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date
          = v_local_today
  )
  ON CONFLICT (dedupe_key) DO NOTHING;
END;
$$;

COMMENT ON TABLE public.seller_contact_leads IS
  'Leads de contato manual que alternam entre vendedores a cada ciclo de 30 dias.';
COMMENT ON TABLE public.seller_contact_lead_tasks IS
  'Duas tentativas uteis por ciclo; cada tarefa possui um follow-up correspondente na agenda.';
COMMENT ON TABLE public.seller_contact_lead_history IS
  'Historico auditavel de contato, ausencia de retorno e transferencia dos leads.';
COMMENT ON TABLE public.seller_commercial_events IS
  'Eventos imutaveis usados pelos relatorios comerciais diarios, semanais e mensais.';
COMMENT ON COLUMN public.seller_appointments.contact_lead_task_id IS
  'Tarefa do lead rotativo quando source = rotating_lead.';
COMMENT ON FUNCTION public.get_my_seller_control_dashboard(text, date) IS
  'Painel do vendedor com metas visuais, contatos, links, cadastros e reagendamentos.';
COMMENT ON FUNCTION public.get_admin_seller_control_report(text, date) IS
  'Relatorio administrativo consolidado e individual por periodo, excluindo dados demo.';
