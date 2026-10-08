-- A carteira inteligente e individual durante todo o prazo da jornada.
-- Tentativas sem retorno continuam auditadas, mas nunca antecipam a troca.
-- Ao vencer o prazo, o handoff alterna obrigatoriamente SDR <-> Closer e
-- escolhe o profissional ativo com a menor carteira para equilibrar a fila.

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
  v_target_seller_type text;
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

  -- Regra de propriedade: enquanto houver responsavel e o prazo estiver no
  -- futuro, nenhuma falta ou quantidade de tentativas pode retirar o lead da
  -- carteira particular. Donos orfaos continuam recuperaveis imediatamente.
  IF v_lead.current_seller_id IS NOT NULL
     AND v_lead.rotation_due_at > p_now THEN
    RETURN NULL;
  END IF;

  SELECT seller.*
  INTO v_current
  FROM public.internal_users AS seller
  WHERE seller.id = v_lead.current_seller_id;

  v_target_seller_type := CASE v_current.seller_type
    WHEN 'sdr' THEN 'closer'
    WHEN 'closer' THEN 'sdr'
    ELSE NULL
  END;

  SELECT candidate.id
  INTO v_next_seller_id
  FROM public.internal_users AS candidate
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS active_leads
    FROM public.seller_contact_leads AS owned_lead
    WHERE owned_lead.current_seller_id = candidate.id
      AND owned_lead.status = 'active'
      AND NOT owned_lead.is_demo
  ) AS workload ON true
  WHERE candidate.role = 'vendedor'
    AND candidate.status = 'ativo'
    AND NOT coalesce(candidate.exclude_from_commercial_metrics, false)
    AND lower(candidate.email) <> 'vendedornox@nox.com'
    AND candidate.id IS DISTINCT FROM v_lead.current_seller_id
    AND (
      v_target_seller_type IS NULL
      OR candidate.seller_type = v_target_seller_type
    )
  ORDER BY workload.active_leads, candidate.created_at, candidate.id
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
      jsonb_build_object(
        'reason', p_reason,
        'source_task_id', p_source_task_id,
        'required_seller_type', v_target_seller_type
      ),
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
      'lead_category', v_lead.lead_category,
      'from_seller_type', v_current.seller_type,
      'to_seller_type', v_target_seller_type
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
      'lead_category', v_lead.lead_category,
      'from_seller_type', v_current.seller_type,
      'to_seller_type', v_target_seller_type
    ),
    p_now,
    false
  ) ON CONFLICT (dedupe_key) DO NOTHING;

  PERFORM public.schedule_seller_contact_lead_cycle(v_lead.id);
  RETURN v_next_seller_id;
END;
$$;

COMMENT ON FUNCTION public.transfer_seller_contact_lead(uuid, text, timestamptz, uuid)
  IS 'Transfere somente no vencimento da carteira individual e alterna SDR e Closer com balanceamento de carga.';

-- Repara somente handoffs antecipados ainda reversiveis: origem ativa, prazo
-- original em aberto e nenhum contato feito pelo destinatario. A trilha antiga
-- permanece imutavel e recebe um evento compensatorio explicito.
DO $repair_premature_handoffs$
DECLARE
  v_repair record;
  v_no_response_count integer;
BEGIN
  PERFORM set_config('nox.contact_lead_mutation', '1', true);

  FOR v_repair IN
    WITH latest_transfer AS (
      SELECT DISTINCT ON (history.lead_id)
        history.id,
        history.lead_id,
        history.from_seller_id,
        history.to_seller_id,
        history.occurred_at,
        history.metadata->>'reason' AS reason
      FROM public.seller_contact_lead_history AS history
      WHERE history.event_type = 'transferred'
      ORDER BY history.lead_id, history.occurred_at DESC, history.id DESC
    )
    SELECT
      lead.id AS lead_id,
      lead.cycle_number AS current_cycle_number,
      lead.cycle_number - 1 AS previous_cycle_number,
      transfer.id AS transfer_id,
      transfer.reason,
      transfer.from_seller_id AS original_seller_id,
      transfer.to_seller_id AS premature_recipient_id,
      previous_cycle.started_at AS previous_cycle_started_at,
      previous_cycle.started_at + interval '30 days' AS previous_deadline
    FROM public.seller_contact_leads AS lead
    JOIN latest_transfer AS transfer ON transfer.lead_id = lead.id
    JOIN public.internal_users AS original_seller
      ON original_seller.id = transfer.from_seller_id
     AND original_seller.role = 'vendedor'
     AND original_seller.status = 'ativo'
    CROSS JOIN LATERAL (
      SELECT min(task.created_at) AS started_at
      FROM public.seller_contact_lead_tasks AS task
      WHERE task.lead_id = lead.id
        AND task.cycle_number = lead.cycle_number - 1
    ) AS previous_cycle
    WHERE lead.status = 'active'
      AND NOT lead.is_demo
      AND NOT lead.rotation_locked
      AND lead.lead_category <> 'meeting_scheduled'
      AND lead.current_seller_id = transfer.to_seller_id
      AND transfer.reason IN ('missed_confirmation', 'category_attempts_exhausted')
      AND previous_cycle.started_at IS NOT NULL
      AND transfer.occurred_at < previous_cycle.started_at + interval '30 days'
      AND previous_cycle.started_at + interval '30 days' > now()
      AND NOT EXISTS (
        SELECT 1
        FROM public.seller_contact_lead_tasks AS current_task
        WHERE current_task.lead_id = lead.id
          AND current_task.cycle_number = lead.cycle_number
          AND current_task.status IN ('completed', 'missed')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.seller_contact_lead_history AS later_event
        WHERE later_event.lead_id = lead.id
          AND later_event.occurred_at > transfer.occurred_at
          AND later_event.event_type IN (
            'task_responded', 'contact_confirmed', 'category_changed'
          )
      )
    ORDER BY lead.id
    FOR UPDATE OF lead
  LOOP
    UPDATE public.seller_appointments AS appointment
    SET status = 'cancelado', updated_at = now()
    FROM public.seller_contact_lead_tasks AS task
    WHERE appointment.contact_lead_task_id = task.id
      AND task.lead_id = v_repair.lead_id
      AND task.cycle_number = v_repair.current_cycle_number
      AND task.status = 'pending';

    UPDATE public.seller_contact_lead_tasks
    SET status = 'cancelled', updated_at = now()
    WHERE lead_id = v_repair.lead_id
      AND cycle_number = v_repair.current_cycle_number
      AND status = 'pending';

    UPDATE public.seller_contact_lead_tasks
    SET seller_id = v_repair.original_seller_id,
        status = 'pending',
        updated_at = now()
    WHERE lead_id = v_repair.lead_id
      AND cycle_number = v_repair.previous_cycle_number
      AND status = 'cancelled'
      AND due_at >= now();

    UPDATE public.seller_appointments AS appointment
    SET seller_id = v_repair.original_seller_id,
        status = 'agendado',
        completed_at = NULL,
        updated_at = now()
    FROM public.seller_contact_lead_tasks AS task
    WHERE appointment.contact_lead_task_id = task.id
      AND task.lead_id = v_repair.lead_id
      AND task.cycle_number = v_repair.previous_cycle_number
      AND task.status = 'pending';

    SELECT count(*)::integer
    INTO v_no_response_count
    FROM public.seller_contact_lead_tasks AS task
    WHERE task.lead_id = v_repair.lead_id
      AND task.cycle_number = v_repair.previous_cycle_number
      AND (
        task.status = 'missed'
        OR (task.status = 'completed' AND task.outcome = 'sem_retorno')
      );

    UPDATE public.seller_contact_leads
    SET current_seller_id = v_repair.original_seller_id,
        cycle_number = v_repair.previous_cycle_number,
        cycle_started_at = v_repair.previous_cycle_started_at,
        rotation_due_at = v_repair.previous_deadline,
        no_response_count = v_no_response_count,
        updated_at = now()
    WHERE id = v_repair.lead_id;

    INSERT INTO public.seller_contact_lead_history (
      lead_id, seller_id, from_seller_id, to_seller_id,
      event_type, metadata, occurred_at
    ) VALUES (
      v_repair.lead_id,
      v_repair.original_seller_id,
      v_repair.premature_recipient_id,
      v_repair.original_seller_id,
      'premature_transfer_reverted',
      jsonb_build_object(
        'reason', 'deadline_not_reached',
        'reverted_transfer_id', v_repair.transfer_id,
        'original_transfer_reason', v_repair.reason,
        'restored_deadline', v_repair.previous_deadline
      ),
      now()
    );

    INSERT INTO public.seller_commercial_events (
      seller_id, event_type, subject_type, subject_id,
      dedupe_key, metadata, occurred_at, is_demo
    ) VALUES (
      v_repair.original_seller_id,
      'lead_transfer_reverted',
      'seller_contact_lead',
      v_repair.lead_id,
      'lead-transfer-reverted:' || v_repair.transfer_id::text,
      jsonb_build_object(
        'reason', 'deadline_not_reached',
        'from_seller_id', v_repair.premature_recipient_id,
        'restored_deadline', v_repair.previous_deadline
      ),
      now(),
      false
    ) ON CONFLICT (dedupe_key) DO NOTHING;
  END LOOP;
END;
$repair_premature_handoffs$;
