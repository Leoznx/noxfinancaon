-- Recupera o SDR de origem quando um Closer usa, dentro de uma reuniao,
-- um link direto que ainda nao carregava o contexto do handoff. O telefone e
-- comparado de forma exata com Leads do Dia e o vinculo encontrado passa a
-- alimentar atribuicao, agenda, follow-ups e metricas compartilhadas.

BEGIN;

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
  v_link_source_sdr_id uuid;
  v_recovered_sdr_id uuid;
  v_recovered_sdr public.internal_users%ROWTYPE;
  v_profile_phone text;
  v_role_label text;
  v_inserted integer := 0;
  v_sdr_credited boolean := false;
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
    AND link.active
  ORDER BY event.created_at DESC
  LIMIT 1
  FOR UPDATE OF event;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'Este link nao foi enviado pela reuniao informada.';
  END IF;

  SELECT link.source_sdr_id
  INTO v_link_source_sdr_id
  FROM public.seller_signup_links AS link
  WHERE link.id = v_event.link_id;

  -- Mantem o credito normal do link para o Closer e para o SDR quando o
  -- proprio link ja nasceu com o contexto compartilhado.
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
  SET claimed_profile_id = coalesce(claimed_profile_id, p_profile_id),
      claimed_at = coalesce(claimed_at, now())
  WHERE id = v_event.id;

  UPDATE public.seller_appointments
  SET tracked_profile_id = coalesce(tracked_profile_id, p_profile_id),
      partnership_id = coalesce(partnership_id, v_closer_partnership_id),
      updated_at = now()
  WHERE id = v_meeting.id;

  UPDATE public.seller_appointments
  SET tracked_profile_id = coalesce(tracked_profile_id, p_profile_id),
      partnership_id = coalesce(
        partnership_id,
        CASE follow_up_owner_type
          WHEN 'sdr' THEN v_sdr_partnership_id
          ELSE v_closer_partnership_id
        END
      ),
      updated_at = now()
  WHERE origin_appointment_id = v_meeting.id
    AND source = 'meeting_follow_up';

  -- Um link direto nao conhece o SDR. Nesse caso recuperamos primeiro o
  -- contexto ja persistido na reuniao/evento e, se ele estiver ausente, o SDR
  -- ativo dono (ou criador) do Lead do Dia com o mesmo telefone do cadastro.
  IF v_link_source_sdr_id IS NULL THEN
    v_recovered_sdr_id := coalesce(v_meeting.sdr_id, v_event.source_sdr_id);

    IF v_recovered_sdr_id IS NULL THEN
      SELECT regexp_replace(coalesce(profile.telefone, ''), '[^0-9]', '', 'g')
      INTO v_profile_phone
      FROM public.profiles AS profile
      WHERE profile.id = p_profile_id;

      IF length(v_profile_phone) IN (12, 13)
         AND left(v_profile_phone, 2) = '55' THEN
        v_profile_phone := substring(v_profile_phone FROM 3);
      END IF;

      IF length(v_profile_phone) IN (10, 11)
         AND left(v_profile_phone, 1) <> '0' THEN
        SELECT coalesce(
          CASE
            WHEN current_seller.role = 'vendedor'
             AND current_seller.seller_type = 'sdr'
             AND current_seller.status = 'ativo'
            THEN current_seller.id
          END,
          CASE
            WHEN creator_seller.role = 'vendedor'
             AND creator_seller.seller_type = 'sdr'
             AND creator_seller.status = 'ativo'
            THEN creator_seller.id
          END
        )
        INTO v_recovered_sdr_id
        FROM public.seller_contact_leads AS lead
        LEFT JOIN public.internal_users AS current_seller
          ON current_seller.id = lead.current_seller_id
        LEFT JOIN public.internal_users AS creator_seller
          ON creator_seller.auth_user_id = lead.created_by
        WHERE lead.phone_normalized = v_profile_phone
          AND lead.status IN ('active', 'converted')
        ORDER BY lead.created_at DESC
        LIMIT 1;
      END IF;
    END IF;

    SELECT seller.*
    INTO v_recovered_sdr
    FROM public.internal_users AS seller
    WHERE seller.id = v_recovered_sdr_id
      AND seller.id IS DISTINCT FROM v_closer_id
      AND seller.role = 'vendedor'
      AND seller.seller_type = 'sdr'
      AND seller.status = 'ativo';

    IF v_recovered_sdr.id IS NOT NULL THEN
      INSERT INTO public.seller_signup_attributions (
        link_id,
        seller_id,
        seller_type,
        registered_profile_id,
        profile_role,
        registered_email,
        source
      ) VALUES (
        v_event.link_id,
        v_recovered_sdr.id,
        'sdr',
        p_profile_id,
        p_profile_role,
        lower(trim(p_email)),
        'link'
      )
      ON CONFLICT (registered_profile_id, seller_id, seller_type) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;

      v_sdr_partnership_id := public.ensure_seller_signup_partnership(
        v_recovered_sdr.id,
        p_profile_id,
        p_profile_role,
        p_email
      );

      v_role_label := CASE p_profile_role
        WHEN 'proprietario' THEN 'proprietario'
        WHEN 'imobiliaria' THEN 'imobiliaria'
        ELSE 'corretor'
      END;

      IF v_inserted > 0 THEN
        INSERT INTO public.notificacoes (
          user_id, titulo, mensagem, tipo, icone, cor_destaque, link
        ) VALUES (
          v_recovered_sdr.auth_user_id,
          'Novo cadastro compartilhado',
          trim(coalesce(p_display_name, 'Um novo cliente')) ||
            ' concluiu o cadastro como ' || v_role_label ||
            '. O SDR de origem foi reconhecido automaticamente pelo telefone do Lead do Dia.',
          'cadastro_link', 'user-plus', 'amarelo', '/vendedor/ranking'
        );
      END IF;

      -- O reparo fica persistido para que novas aberturas da reuniao gerem os
      -- links compartilhados corretos, sem depender de uma nova inferencia.
      UPDATE public.seller_appointments
      SET sdr_id = coalesce(sdr_id, v_recovered_sdr.id),
          assigned_closer_id = coalesce(assigned_closer_id, v_closer_id),
          source = CASE WHEN source = 'manual' THEN 'sdr_handoff' ELSE source END,
          updated_at = now()
      WHERE id = v_meeting.id;

      UPDATE public.seller_signup_link_send_events
      SET source_sdr_id = v_recovered_sdr.id
      WHERE appointment_id = v_meeting.id
        AND source_sdr_id IS NULL;

      -- A cadencia e exclusiva de quem originou a reuniao. Somente lembretes
      -- ainda pendentes mudam de dono; o historico concluido e preservado.
      UPDATE public.seller_appointments AS follow_up
      SET seller_id = v_recovered_sdr.id,
          follow_up_owner_type = 'sdr',
          partnership_id = coalesce(v_sdr_partnership_id, follow_up.partnership_id),
          tracked_profile_id = coalesce(follow_up.tracked_profile_id, p_profile_id),
          updated_at = now()
      WHERE follow_up.origin_appointment_id = v_meeting.id
        AND follow_up.source = 'meeting_follow_up'
        AND follow_up.status NOT IN ('concluido', 'cancelado');

      SELECT EXISTS (
        SELECT 1
        FROM public.seller_signup_attributions AS attribution
        WHERE attribution.registered_profile_id = p_profile_id
          AND attribution.seller_id = v_recovered_sdr.id
          AND attribution.seller_type = 'sdr'
      )
      INTO v_sdr_credited;

      IF v_sdr_credited THEN
        RETURN QUERY
        SELECT
          v_recovered_sdr.email::text,
          v_recovered_sdr.full_name::text,
          'sdr'::text;
      END IF;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_seller_signup_link_for_meeting(
  uuid, text, uuid, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_seller_signup_link_for_meeting(
  uuid, text, uuid, text, text, text
) TO service_role;

COMMENT ON FUNCTION public.claim_seller_signup_link_for_meeting(
  uuid, text, uuid, text, text, text
) IS
  'Credita Closer e SDR na reuniao; quando um link direto perde a origem, recupera o SDR ativo por telefone exato do Lead do Dia e reorganiza os follow-ups pendentes.';

-- Corrige os cadastros ja confirmados que satisfazem exatamente a mesma regra.
-- A consulta e intencionalmente restrita a reunioes sem SDR, evento sem SDR e
-- telefone unico presente em Leads do Dia de um SDR ativo.
DO $$
DECLARE
  v_candidate record;
BEGIN
  FOR v_candidate IN
    SELECT DISTINCT ON (event.appointment_id, event.claimed_profile_id)
      event.appointment_id,
      link.token,
      event.claimed_profile_id,
      profile.role::text AS profile_role,
      profile.email,
      profile.nome AS display_name
    FROM public.seller_signup_link_send_events AS event
    JOIN public.seller_appointments AS meeting
      ON meeting.id = event.appointment_id
    JOIN public.seller_signup_links AS link
      ON link.id = event.link_id
    JOIN public.profiles AS profile
      ON profile.id = event.claimed_profile_id
    JOIN public.seller_contact_leads AS lead
      ON lead.phone_normalized = CASE
        WHEN length(regexp_replace(coalesce(profile.telefone, ''), '[^0-9]', '', 'g')) IN (12, 13)
         AND left(regexp_replace(coalesce(profile.telefone, ''), '[^0-9]', '', 'g'), 2) = '55'
        THEN substring(regexp_replace(coalesce(profile.telefone, ''), '[^0-9]', '', 'g') FROM 3)
        ELSE regexp_replace(coalesce(profile.telefone, ''), '[^0-9]', '', 'g')
      END
    LEFT JOIN public.internal_users AS current_seller
      ON current_seller.id = lead.current_seller_id
    LEFT JOIN public.internal_users AS creator_seller
      ON creator_seller.auth_user_id = lead.created_by
    WHERE event.claimed_profile_id IS NOT NULL
      AND event.source_sdr_id IS NULL
      AND meeting.sdr_id IS NULL
      AND link.source_sdr_id IS NULL
      AND lead.status IN ('active', 'converted')
      AND coalesce(
        CASE
          WHEN current_seller.role = 'vendedor'
           AND current_seller.seller_type = 'sdr'
           AND current_seller.status = 'ativo'
          THEN current_seller.id
        END,
        CASE
          WHEN creator_seller.role = 'vendedor'
           AND creator_seller.seller_type = 'sdr'
           AND creator_seller.status = 'ativo'
          THEN creator_seller.id
        END
      ) IS NOT NULL
    ORDER BY
      event.appointment_id,
      event.claimed_profile_id,
      event.claimed_at DESC NULLS LAST,
      event.created_at DESC
  LOOP
    PERFORM *
    FROM public.claim_seller_signup_link_for_meeting(
      v_candidate.appointment_id,
      v_candidate.token,
      v_candidate.claimed_profile_id,
      v_candidate.profile_role,
      v_candidate.email,
      v_candidate.display_name
    );
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
