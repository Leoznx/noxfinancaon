-- Redistribui automaticamente a carteira operacional quando um SDR ou Closer
-- deixa a equipe. A funcao e chamada pela Edge Function de desligamento e pode
-- ser reutilizada pelo backend para reconciliar desligamentos anteriores.

CREATE TABLE IF NOT EXISTS public.seller_departure_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  departed_seller_id uuid NOT NULL
    REFERENCES public.internal_users(id) ON DELETE RESTRICT,
  recipient_seller_id uuid NOT NULL
    REFERENCES public.internal_users(id) ON DELETE RESTRICT,
  seller_type text NOT NULL CHECK (seller_type IN ('sdr', 'closer')),
  work_item_kind text NOT NULL
    CHECK (work_item_kind IN ('appointment', 'contact_lead', 'sales_lead')),
  work_item_id uuid NOT NULL,
  marker text NOT NULL DEFAULT 'LEAD COLABORADOR QUE SAIU',
  transferred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (departed_seller_id, work_item_kind, work_item_id)
);

CREATE INDEX IF NOT EXISTS seller_departure_transfers_departed_idx
  ON public.seller_departure_transfers (departed_seller_id, transferred_at DESC);
CREATE INDEX IF NOT EXISTS seller_departure_transfers_recipient_idx
  ON public.seller_departure_transfers (recipient_seller_id, transferred_at DESC);

ALTER TABLE public.seller_departure_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_departure_transfers FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.seller_departure_transfers TO service_role;

CREATE OR REPLACE FUNCTION public.redistribute_departed_seller_workload(
  p_employee_id uuid,
  p_seller_type_override text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target public.internal_users%ROWTYPE;
  v_seller_type text;
  v_recipient_id uuid;
  v_recipient_ids uuid[] := ARRAY[]::uuid[];
  v_contact_lead record;
  v_sales_lead record;
  v_group record;
  v_changed integer := 0;
  v_appointment_count integer := 0;
  v_contact_lead_count integer := 0;
  v_sales_lead_count integer := 0;
  v_marker constant text := 'LEAD COLABORADOR QUE SAIU';
BEGIN
  IF p_employee_id IS NULL THEN
    RAISE EXCEPTION 'Colaborador invalido.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_employee_id::text, 20261005));

  SELECT employee.*
  INTO v_target
  FROM public.internal_users AS employee
  WHERE employee.id = p_employee_id
  FOR UPDATE;

  IF v_target.id IS NULL THEN
    RAISE EXCEPTION 'Colaborador nao encontrado.';
  END IF;

  v_seller_type := coalesce(nullif(trim(p_seller_type_override), ''), v_target.seller_type);

  IF v_target.role <> 'vendedor' OR v_seller_type NOT IN ('sdr', 'closer') THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'seller_type', v_seller_type,
      'appointment_count', 0,
      'contact_lead_count', 0,
      'sales_lead_count', 0,
      'recipient_count', 0,
      'recipient_ids', '[]'::jsonb,
      'total_items', 0
    );
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM public.seller_contact_leads AS lead
       WHERE lead.current_seller_id = p_employee_id
         AND lead.status = 'active'
     )
     AND NOT EXISTS (
       SELECT 1
       FROM public.sales_leads AS lead
       WHERE lead.assigned_seller_id = p_employee_id
         AND lower(coalesce(lead.status, 'pendente')) NOT IN
           ('atendido', 'convertido', 'perdido', 'cancelado', 'concluido', 'arquivado')
     )
     AND NOT EXISTS (
       SELECT 1
       FROM public.seller_appointments AS appointment
       WHERE appointment.status NOT IN ('concluido', 'cancelado', 'nao_compareceu')
         AND appointment.source <> 'admin'
         AND (
           appointment.seller_id = p_employee_id
           OR (v_seller_type = 'sdr' AND appointment.sdr_id = p_employee_id)
           OR (v_seller_type = 'closer' AND appointment.assigned_closer_id = p_employee_id)
         )
     ) THEN
    UPDATE public.lead_distribution_queue
    SET ativo = false,
        updated_at = now()
    WHERE vendedor_id = p_employee_id
      AND ativo;

    RETURN jsonb_build_object(
      'eligible', true,
      'seller_type', v_seller_type,
      'appointment_count', 0,
      'contact_lead_count', 0,
      'sales_lead_count', 0,
      'recipient_count', 0,
      'recipient_ids', '[]'::jsonb,
      'total_items', 0
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.internal_users AS candidate
    WHERE candidate.role = 'vendedor'
      AND candidate.seller_type = v_seller_type
      AND candidate.status = 'ativo'
      AND candidate.id <> p_employee_id
      AND NOT coalesce(candidate.exclude_from_commercial_metrics, false)
  ) THEN
    RAISE EXCEPTION 'Nao existe outro % ativo para receber os leads deste colaborador.',
      CASE WHEN v_seller_type = 'closer' THEN 'Closer' ELSE 'Vendedor' END;
  END IF;

  -- O trigger protege os lembretes rotativos contra alteracoes diretas. Esta
  -- flag limita a excecao a esta transacao privilegiada e auditada.
  PERFORM set_config('nox.contact_lead_mutation', '1', true);

  -- Leads da cadencia inteligente continuam no mesmo ciclo, nas mesmas datas.
  -- Cada lead inteiro (tarefas + agenda) vai para um unico substituto.
  FOR v_contact_lead IN
    SELECT lead.id, lead.created_at
    FROM public.seller_contact_leads AS lead
    WHERE lead.current_seller_id = p_employee_id
      AND lead.status = 'active'
    ORDER BY lead.created_at, lead.id
    FOR UPDATE
  LOOP
    SELECT candidate.id
    INTO v_recipient_id
    FROM public.internal_users AS candidate
    WHERE candidate.role = 'vendedor'
      AND candidate.seller_type = v_seller_type
      AND candidate.status = 'ativo'
      AND candidate.id <> p_employee_id
      AND NOT coalesce(candidate.exclude_from_commercial_metrics, false)
    ORDER BY
      (
        SELECT count(*)
        FROM public.seller_contact_leads AS owned
        WHERE owned.current_seller_id = candidate.id
          AND owned.status = 'active'
      ) + (
        SELECT count(*)
        FROM public.sales_leads AS legacy
        WHERE legacy.assigned_seller_id = candidate.id
          AND lower(coalesce(legacy.status, 'pendente')) NOT IN
            ('atendido', 'convertido', 'perdido', 'cancelado', 'concluido', 'arquivado')
      ) + (
        SELECT count(*)
        FROM public.seller_appointments AS appointment
        WHERE candidate.id IN (
          appointment.seller_id,
          appointment.sdr_id,
          appointment.assigned_closer_id
        )
          AND appointment.status NOT IN ('concluido', 'cancelado', 'nao_compareceu')
      ),
      candidate.full_name,
      candidate.id
    LIMIT 1;

    UPDATE public.seller_contact_leads
    SET current_seller_id = v_recipient_id,
        updated_at = now()
    WHERE id = v_contact_lead.id;

    UPDATE public.seller_contact_lead_tasks
    SET seller_id = v_recipient_id,
        updated_at = now()
    WHERE lead_id = v_contact_lead.id
      AND status = 'pending';

    UPDATE public.seller_appointments AS appointment
    SET seller_id = v_recipient_id,
        notes = CASE
          WHEN position(v_marker IN upper(coalesce(appointment.notes, ''))) > 0
            THEN appointment.notes
          ELSE concat_ws(E'\n', nullif(btrim(appointment.notes), ''), v_marker)
        END,
        updated_at = now()
    FROM public.seller_contact_lead_tasks AS task
    WHERE appointment.contact_lead_task_id = task.id
      AND task.lead_id = v_contact_lead.id
      AND appointment.status NOT IN ('concluido', 'cancelado', 'nao_compareceu');
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    v_appointment_count := v_appointment_count + v_changed;

    INSERT INTO public.seller_contact_lead_history (
      lead_id, seller_id, from_seller_id, to_seller_id,
      event_type, metadata, occurred_at
    ) VALUES (
      v_contact_lead.id, v_recipient_id, p_employee_id, v_recipient_id,
      'employee_departure_transfer',
      jsonb_build_object('reason', 'employee_departure', 'marker', v_marker),
      now()
    );

    INSERT INTO public.seller_departure_transfers (
      departed_seller_id, recipient_seller_id, seller_type,
      work_item_kind, work_item_id, marker
    ) VALUES (
      p_employee_id, v_recipient_id, v_seller_type,
      'contact_lead', v_contact_lead.id, v_marker
    ) ON CONFLICT (departed_seller_id, work_item_kind, work_item_id) DO NOTHING;

    v_contact_lead_count := v_contact_lead_count + 1;
    IF NOT (v_recipient_id = ANY(v_recipient_ids)) THEN
      v_recipient_ids := array_append(v_recipient_ids, v_recipient_id);
    END IF;
  END LOOP;

  -- Leads do CRM legado tambem preservam o horario atual. O trigger canonico
  -- sincroniza assigned_seller_id, notes e a agenda lead_follow_up.
  FOR v_sales_lead IN
    SELECT lead.id, lead.created_at
    FROM public.sales_leads AS lead
    WHERE lead.assigned_seller_id = p_employee_id
      AND lower(coalesce(lead.status, 'pendente')) NOT IN
        ('atendido', 'convertido', 'perdido', 'cancelado', 'concluido', 'arquivado')
    ORDER BY lead.created_at, lead.id
    FOR UPDATE
  LOOP
    SELECT candidate.id
    INTO v_recipient_id
    FROM public.internal_users AS candidate
    WHERE candidate.role = 'vendedor'
      AND candidate.seller_type = v_seller_type
      AND candidate.status = 'ativo'
      AND candidate.id <> p_employee_id
      AND NOT coalesce(candidate.exclude_from_commercial_metrics, false)
    ORDER BY
      (
        SELECT count(*)
        FROM public.seller_contact_leads AS owned
        WHERE owned.current_seller_id = candidate.id
          AND owned.status = 'active'
      ) + (
        SELECT count(*)
        FROM public.sales_leads AS legacy
        WHERE legacy.assigned_seller_id = candidate.id
          AND lower(coalesce(legacy.status, 'pendente')) NOT IN
            ('atendido', 'convertido', 'perdido', 'cancelado', 'concluido', 'arquivado')
      ) + (
        SELECT count(*)
        FROM public.seller_appointments AS appointment
        WHERE candidate.id IN (
          appointment.seller_id,
          appointment.sdr_id,
          appointment.assigned_closer_id
        )
          AND appointment.status NOT IN ('concluido', 'cancelado', 'nao_compareceu')
      ),
      candidate.full_name,
      candidate.id
    LIMIT 1;

    UPDATE public.sales_leads
    SET assigned_seller_id = v_recipient_id,
        notes = CASE
          WHEN position(v_marker IN upper(coalesce(notes, ''))) > 0 THEN notes
          ELSE concat_ws(E'\n', nullif(btrim(notes), ''), v_marker)
        END,
        updated_at = now()
    WHERE id = v_sales_lead.id;

    UPDATE public.lead_followups
    SET vendedor_id = v_recipient_id,
        observacao = CASE
          WHEN position(v_marker IN upper(coalesce(observacao, ''))) > 0 THEN observacao
          ELSE concat_ws(E'\n', nullif(btrim(observacao), ''), v_marker)
        END,
        updated_at = now()
    WHERE lead_id = v_sales_lead.id
      AND status_followup = 'pendente';

    INSERT INTO public.lead_history (
      lead_id, user_id, acao, observacao, created_at
    ) VALUES (
      v_sales_lead.id, NULL, 'transferencia_desligamento', v_marker, now()
    );

    INSERT INTO public.seller_departure_transfers (
      departed_seller_id, recipient_seller_id, seller_type,
      work_item_kind, work_item_id, marker
    ) VALUES (
      p_employee_id, v_recipient_id, v_seller_type,
      'sales_lead', v_sales_lead.id, v_marker
    ) ON CONFLICT (departed_seller_id, work_item_kind, work_item_id) DO NOTHING;

    v_sales_lead_count := v_sales_lead_count + 1;
    IF NOT (v_recipient_id = ANY(v_recipient_ids)) THEN
      v_recipient_ids := array_append(v_recipient_ids, v_recipient_id);
    END IF;
  END LOOP;

  -- Reuniao e todos os seus follow-ups formam uma unica unidade. Assim a
  -- jornada de um cliente nunca e dividida entre dois substitutos.
  FOR v_group IN
    SELECT
      coalesce(appointment.origin_appointment_id, appointment.id) AS root_id,
      min(appointment.scheduled_at) AS scheduled_at,
      bool_or(appointment.type = 'reuniao') AS has_meeting,
      max(public.seller_appointment_effective_duration_minutes(
        appointment.type,
        appointment.duration_minutes
      )) AS duration_minutes
    FROM public.seller_appointments AS appointment
    WHERE appointment.status NOT IN ('concluido', 'cancelado', 'nao_compareceu')
      AND appointment.source <> 'admin'
      AND appointment.contact_lead_task_id IS NULL
      AND (
        appointment.seller_id = p_employee_id
        OR (v_seller_type = 'sdr' AND appointment.sdr_id = p_employee_id)
        OR (v_seller_type = 'closer' AND appointment.assigned_closer_id = p_employee_id)
      )
    GROUP BY coalesce(appointment.origin_appointment_id, appointment.id)
    ORDER BY min(appointment.scheduled_at),
      coalesce(appointment.origin_appointment_id, appointment.id)
  LOOP
    SELECT candidate.id
    INTO v_recipient_id
    FROM public.internal_users AS candidate
    WHERE candidate.role = 'vendedor'
      AND candidate.seller_type = v_seller_type
      AND candidate.status = 'ativo'
      AND candidate.id <> p_employee_id
      AND NOT coalesce(candidate.exclude_from_commercial_metrics, false)
    ORDER BY
      CASE
        WHEN v_seller_type = 'closer' AND v_group.has_meeting THEN (
          SELECT count(*)
          FROM public.seller_appointments AS busy
          WHERE candidate.id IN (busy.seller_id, busy.assigned_closer_id)
            AND busy.id <> v_group.root_id
            AND busy.origin_appointment_id IS DISTINCT FROM v_group.root_id
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
                ) && tstzrange(
                  v_group.scheduled_at,
                  v_group.scheduled_at + make_interval(mins => v_group.duration_minutes),
                  '[)'
                )
        )
        ELSE 0
      END,
      (
        SELECT count(*)
        FROM public.seller_contact_leads AS owned
        WHERE owned.current_seller_id = candidate.id
          AND owned.status = 'active'
      ) + (
        SELECT count(*)
        FROM public.sales_leads AS legacy
        WHERE legacy.assigned_seller_id = candidate.id
          AND lower(coalesce(legacy.status, 'pendente')) NOT IN
            ('atendido', 'convertido', 'perdido', 'cancelado', 'concluido', 'arquivado')
      ) + (
        SELECT count(*)
        FROM public.seller_appointments AS appointment
        WHERE candidate.id IN (
          appointment.seller_id,
          appointment.sdr_id,
          appointment.assigned_closer_id
        )
          AND appointment.status NOT IN ('concluido', 'cancelado', 'nao_compareceu')
      ),
      candidate.full_name,
      candidate.id
    LIMIT 1;

    UPDATE public.seller_appointments AS appointment
    SET seller_id = CASE
          WHEN appointment.seller_id = p_employee_id THEN v_recipient_id
          ELSE appointment.seller_id
        END,
        sdr_id = CASE
          WHEN v_seller_type = 'sdr' AND appointment.sdr_id = p_employee_id
            THEN v_recipient_id
          ELSE appointment.sdr_id
        END,
        assigned_closer_id = CASE
          WHEN v_seller_type = 'closer'
               AND appointment.assigned_closer_id = p_employee_id
            THEN v_recipient_id
          ELSE appointment.assigned_closer_id
        END,
        notes = CASE
          WHEN position(v_marker IN upper(coalesce(appointment.notes, ''))) > 0
            THEN appointment.notes
          ELSE concat_ws(E'\n', nullif(btrim(appointment.notes), ''), v_marker)
        END,
        updated_at = now()
    WHERE (
        appointment.id = v_group.root_id
        OR appointment.origin_appointment_id = v_group.root_id
      )
      AND appointment.status NOT IN ('concluido', 'cancelado', 'nao_compareceu')
      AND appointment.source <> 'admin'
      AND appointment.contact_lead_task_id IS NULL
      AND (
        appointment.seller_id = p_employee_id
        OR (v_seller_type = 'sdr' AND appointment.sdr_id = p_employee_id)
        OR (v_seller_type = 'closer' AND appointment.assigned_closer_id = p_employee_id)
      );
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    v_appointment_count := v_appointment_count + v_changed;

    INSERT INTO public.seller_departure_transfers (
      departed_seller_id, recipient_seller_id, seller_type,
      work_item_kind, work_item_id, marker
    ) VALUES (
      p_employee_id, v_recipient_id, v_seller_type,
      'appointment', v_group.root_id, v_marker
    ) ON CONFLICT (departed_seller_id, work_item_kind, work_item_id) DO NOTHING;

    IF NOT (v_recipient_id = ANY(v_recipient_ids)) THEN
      v_recipient_ids := array_append(v_recipient_ids, v_recipient_id);
    END IF;
  END LOOP;

  UPDATE public.lead_distribution_queue
  SET ativo = false,
      updated_at = now()
  WHERE vendedor_id = p_employee_id
    AND ativo;

  RETURN jsonb_build_object(
    'eligible', true,
    'seller_type', v_seller_type,
    'appointment_count', v_appointment_count,
    'contact_lead_count', v_contact_lead_count,
    'sales_lead_count', v_sales_lead_count,
    'recipient_count', cardinality(v_recipient_ids),
    'recipient_ids', to_jsonb(v_recipient_ids),
    'total_items', v_appointment_count + v_contact_lead_count + v_sales_lead_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.redistribute_departed_seller_workload(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redistribute_departed_seller_workload(uuid, text)
  TO service_role;

COMMENT ON TABLE public.seller_departure_transfers IS
  'Trilha idempotente de leads e cadeias de agenda redistribuidos apos desligamento comercial.';
COMMENT ON FUNCTION public.redistribute_departed_seller_workload(uuid, text) IS
  'Redistribui, um a um e somente dentro da mesma funcao, leads e agenda ativa de um SDR ou Closer desligado.';
