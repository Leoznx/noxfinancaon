-- Permite que o vendedor conclua um follow-up perdido enquanto o lead ainda
-- pertence a ele. Leads de reuniao marcada avancam automaticamente de ciclo
-- na virada do dia; nesse caso aceitamos somente o ciclo imediatamente
-- anterior e cancelamos o lembrete futuro antes de aplicar o proximo passo.

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
  v_is_late_response boolean := false;
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

  v_is_late_response := v_task.status = 'missed'
    AND (
      v_task.cycle_number = v_lead.cycle_number
      OR (
        v_lead.lead_category = 'meeting_scheduled'
        AND v_lead.rotation_locked
        AND v_task.cycle_number = v_lead.cycle_number - 1
      )
    );

  IF v_task.id IS NULL
     OR v_lead.id IS NULL
     OR v_lead.status <> 'active'
     OR v_lead.current_seller_id <> p_seller_id
     OR NOT (
       (
         v_task.status = 'pending'
         AND v_task.cycle_number = v_lead.cycle_number
       )
       OR v_is_late_response
     ) THEN
    RAISE EXCEPTION 'Este lembrete nao esta mais disponivel.';
  END IF;

  IF v_task.status = 'pending'
     AND (v_task.due_at AT TIME ZONE 'America/Sao_Paulo')::date <> v_local::date THEN
    RAISE EXCEPTION 'Este lembrete so pode ser confirmado na data programada.';
  END IF;
  IF v_is_late_response
     AND (v_task.due_at AT TIME ZONE 'America/Sao_Paulo')::date > v_local::date THEN
    RAISE EXCEPTION 'Este lembrete ainda nao esta disponivel para confirmacao.';
  END IF;

  PERFORM set_config('nox.contact_lead_mutation', '1', true);
  v_is_demo := v_lead.is_demo
    OR coalesce(v_seller.exclude_from_commercial_metrics, false)
    OR lower(v_seller.email) = 'vendedornox@nox.com';

  -- A automacao de reuniao marcada cria o ciclo seguinte ao registrar a
  -- falta. Se o vendedor responder o lembrete anterior, o ciclo provisório
  -- precisa ser removido para nao deixar dois proximos contatos concorrentes.
  IF v_is_late_response AND v_task.cycle_number <> v_lead.cycle_number THEN
    UPDATE public.seller_appointments AS appointment
    SET status = 'cancelado', updated_at = p_now
    FROM public.seller_contact_lead_tasks AS task
    WHERE appointment.contact_lead_task_id = task.id
      AND task.lead_id = v_lead.id
      AND task.status = 'pending';

    UPDATE public.seller_contact_lead_tasks
    SET status = 'cancelled', updated_at = p_now
    WHERE lead_id = v_lead.id AND status = 'pending';
  END IF;

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
      'notes', nullif(trim(coalesce(p_notes, '')), ''),
      'late_response', v_is_late_response
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
        'next_step', p_next_step,
        'late_response', v_is_late_response
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
    'late_response', v_is_late_response,
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

REVOKE ALL ON FUNCTION public.respond_to_qualified_seller_contact_lead_task(
  uuid, uuid, text, text, text, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_qualified_seller_contact_lead_task(
  uuid, uuid, text, text, text, timestamptz
) TO service_role;

COMMENT ON FUNCTION public.respond_to_qualified_seller_contact_lead_task(
  uuid, uuid, text, text, text, timestamptz
) IS 'Registra o resultado do follow-up atual ou do ultimo lembrete perdido que continua sob responsabilidade do mesmo vendedor.';
