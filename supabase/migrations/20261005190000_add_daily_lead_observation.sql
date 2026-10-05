-- Permite que o vendedor registre uma observacao opcional no cadastro manual
-- de um lead. A observacao fica na trilha imutavel do lead, compartilhada
-- entre site e aplicativo, sem interferir na cadencia automatica.

DROP FUNCTION IF EXISTS public.create_my_qualified_seller_contact_lead(text, text, text);

CREATE OR REPLACE FUNCTION public.create_my_qualified_seller_contact_lead(
  p_name text,
  p_phone text,
  p_category text,
  p_notes text DEFAULT NULL
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
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
  v_lead public.seller_contact_leads%ROWTYPE;
  v_local_day date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_event_id uuid;
  v_is_demo boolean;
  v_category_changed boolean := false;
BEGIN
  IF v_category NOT IN ('cold', 'meeting_scheduled', 'potential') THEN
    RAISE EXCEPTION 'Categoria invalida para o lead.';
  END IF;
  IF char_length(coalesce(v_notes, '')) > 1000 THEN
    RAISE EXCEPTION 'A observacao deve ter no maximo 1000 caracteres.';
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

    IF v_notes IS NOT NULL THEN
      INSERT INTO public.seller_contact_lead_history (
        lead_id, seller_id, event_type, metadata
      ) VALUES (
        v_lead.id, v_seller.id, 'lead_observation',
        jsonb_build_object('source', 'manual_daily_lead', 'notes', v_notes)
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

  IF v_notes IS NOT NULL THEN
    INSERT INTO public.seller_contact_lead_history (
      lead_id, seller_id, event_type, metadata
    ) VALUES (
      v_lead.id, v_seller.id, 'lead_observation',
      jsonb_build_object('source', 'manual_daily_lead', 'notes', v_notes)
    );
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
  ) ON CONFLICT (dedupe_key) DO NOTHING;

  PERFORM public.schedule_seller_contact_lead_cycle(v_lead.id);
  RETURN v_lead.id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_my_qualified_seller_contact_lead(text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_my_qualified_seller_contact_lead(text, text, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.create_my_qualified_seller_contact_lead(text, text, text, text)
  IS 'Cadastra ou requalifica lead com jornada e observacao inicial opcional.';
