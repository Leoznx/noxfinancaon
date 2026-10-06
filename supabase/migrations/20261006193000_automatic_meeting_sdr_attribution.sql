-- Torna a origem SDR da reuniao uma informacao estruturada antes de gerar ou
-- consumir o link de cadastro. Reunioes antigas podem ser recuperadas pelo
-- evento, telefone ou por uma mencao inequivoca ao nome do SDR; quando nao ha
-- sinal confiavel, o Closer pode confirmar a origem explicitamente na UI.

BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_seller_meeting_source_sdr(
  p_appointment_id uuid,
  p_profile_id uuid DEFAULT NULL,
  p_preferred_sdr_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_meeting public.seller_appointments%ROWTYPE;
  v_closer_id uuid;
  v_resolved_sdr_id uuid;
  v_meeting_phone text;
  v_profile_phone text;
  v_context text;
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

  SELECT seller.id
  INTO v_resolved_sdr_id
  FROM public.internal_users AS seller
  WHERE seller.id = v_meeting.sdr_id
    AND seller.id IS DISTINCT FROM v_closer_id
    AND seller.role = 'vendedor'
    AND seller.seller_type = 'sdr'
    AND seller.status = 'ativo';

  IF p_preferred_sdr_id IS NOT NULL THEN
    SELECT seller.id
    INTO v_resolved_sdr_id
    FROM public.internal_users AS seller
    WHERE seller.id = p_preferred_sdr_id
      AND seller.id IS DISTINCT FROM v_closer_id
      AND seller.role = 'vendedor'
      AND seller.seller_type = 'sdr'
      AND seller.status = 'ativo';

    IF v_resolved_sdr_id IS NULL THEN
      RAISE EXCEPTION 'Selecione um Vendedor ativo para esta reuniao.';
    END IF;
    IF v_meeting.sdr_id IS NOT NULL
       AND v_meeting.sdr_id IS DISTINCT FROM v_resolved_sdr_id THEN
      RAISE EXCEPTION 'Esta reuniao ja pertence a outro Vendedor.';
    END IF;
  END IF;

  IF v_resolved_sdr_id IS NULL THEN
    SELECT CASE WHEN count(DISTINCT event.source_sdr_id) = 1
      THEN min(event.source_sdr_id)
    END
    INTO v_resolved_sdr_id
    FROM public.seller_signup_link_send_events AS event
    JOIN public.internal_users AS seller ON seller.id = event.source_sdr_id
    WHERE event.appointment_id = v_meeting.id
      AND seller.id IS DISTINCT FROM v_closer_id
      AND seller.role = 'vendedor'
      AND seller.seller_type = 'sdr'
      AND seller.status = 'ativo';
  END IF;

  v_meeting_phone := regexp_replace(
    coalesce(v_meeting.contact_phone, ''), '[^0-9]', '', 'g'
  );
  IF length(v_meeting_phone) IN (12, 13) AND left(v_meeting_phone, 2) = '55' THEN
    v_meeting_phone := substring(v_meeting_phone FROM 3);
  END IF;

  IF p_profile_id IS NOT NULL THEN
    SELECT regexp_replace(coalesce(profile.telefone, ''), '[^0-9]', '', 'g')
    INTO v_profile_phone
    FROM public.profiles AS profile
    WHERE profile.id = p_profile_id;

    IF length(v_profile_phone) IN (12, 13) AND left(v_profile_phone, 2) = '55' THEN
      v_profile_phone := substring(v_profile_phone FROM 3);
    END IF;
  END IF;

  IF v_resolved_sdr_id IS NULL THEN
    SELECT candidate.sdr_id
    INTO v_resolved_sdr_id
    FROM (
      SELECT
        coalesce(
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
        ) AS sdr_id,
        CASE
          WHEN length(v_meeting_phone) IN (10, 11)
           AND lead.phone_normalized = v_meeting_phone THEN 0
          ELSE 1
        END AS phone_priority,
        lead.created_at
      FROM public.seller_contact_leads AS lead
      LEFT JOIN public.internal_users AS current_seller
        ON current_seller.id = lead.current_seller_id
      LEFT JOIN public.internal_users AS creator_seller
        ON creator_seller.auth_user_id = lead.created_by
      WHERE lead.status IN ('active', 'converted')
        AND (
          (
            length(v_meeting_phone) IN (10, 11)
            AND lead.phone_normalized = v_meeting_phone
          )
          OR (
            length(v_profile_phone) IN (10, 11)
            AND lead.phone_normalized = v_profile_phone
          )
        )
    ) AS candidate
    WHERE candidate.sdr_id IS NOT NULL
      AND candidate.sdr_id IS DISTINCT FROM v_closer_id
    ORDER BY candidate.phone_priority, candidate.created_at DESC
    LIMIT 1;
  END IF;

  -- Reunioes manuais antigas frequentemente guardaram apenas textos como
  -- "Marcacao da Simone". Aceitamos o nome somente quando ele identifica um
  -- unico SDR ativo, evitando atribuir credito por uma mencao ambigua.
  IF v_resolved_sdr_id IS NULL THEN
    v_context := ' ' || trim(regexp_replace(
      translate(
        lower(coalesce(v_meeting.title, '') || ' ' || coalesce(v_meeting.notes, '')),
        'áàãâäéèêëíìîïóòõôöúùûüç',
        'aaaaaeeeeiiiiooooouuuuc'
      ),
      '[^a-z0-9]+', ' ', 'g'
    )) || ' ';

    WITH matching_sdrs AS (
      SELECT seller.id
      FROM public.internal_users AS seller
      CROSS JOIN LATERAL (
        SELECT
          trim(regexp_replace(
            translate(
              lower(seller.full_name),
              'áàãâäéèêëíìîïóòõôöúùûüç',
              'aaaaaeeeeiiiiooooouuuuc'
            ),
            '[^a-z0-9]+', ' ', 'g'
          )) AS full_name,
          split_part(
            trim(regexp_replace(
              translate(
                lower(seller.full_name),
                'áàãâäéèêëíìîïóòõôöúùûüç',
                'aaaaaeeeeiiiiooooouuuuc'
              ),
              '[^a-z0-9]+', ' ', 'g'
            )),
            ' ', 1
          ) AS first_name
      ) AS normalized
      WHERE seller.role = 'vendedor'
        AND seller.seller_type = 'sdr'
        AND seller.status = 'ativo'
        AND seller.id IS DISTINCT FROM v_closer_id
        AND (
          (length(normalized.full_name) >= 4 AND strpos(v_context, ' ' || normalized.full_name || ' ') > 0)
          OR (length(normalized.first_name) >= 4 AND strpos(v_context, ' ' || normalized.first_name || ' ') > 0)
        )
    )
    SELECT CASE WHEN count(DISTINCT id) = 1 THEN min(id) END
    INTO v_resolved_sdr_id
    FROM matching_sdrs;
  END IF;

  IF v_resolved_sdr_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.seller_appointments
  SET sdr_id = v_resolved_sdr_id,
      assigned_closer_id = coalesce(assigned_closer_id, v_closer_id),
      source = CASE WHEN source = 'manual' THEN 'sdr_handoff' ELSE source END,
      updated_at = now()
  WHERE id = v_meeting.id;

  UPDATE public.seller_signup_link_send_events
  SET source_sdr_id = v_resolved_sdr_id
  WHERE appointment_id = v_meeting.id
    AND source_sdr_id IS NULL;

  RETURN v_resolved_sdr_id;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_seller_meeting_source_sdr(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_seller_meeting_source_sdr(uuid, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_meeting_source_sdr_options(
  p_appointment_id uuid
)
RETURNS TABLE (sdr_id uuid, sdr_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_closer_id uuid;
BEGIN
  SELECT seller.id
  INTO v_closer_id
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid()
    AND seller.role = 'vendedor'
    AND seller.seller_type = 'closer'
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_closer_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.seller_appointments AS appointment
    WHERE appointment.id = p_appointment_id
      AND appointment.type = 'reuniao'
      AND coalesce(appointment.assigned_closer_id, appointment.seller_id) = v_closer_id
  ) THEN
    RAISE EXCEPTION 'Reuniao nao encontrada na agenda deste Closer.';
  END IF;

  RETURN QUERY
  SELECT seller.id, seller.full_name
  FROM public.internal_users AS seller
  WHERE seller.role = 'vendedor'
    AND seller.seller_type = 'sdr'
    AND seller.status = 'ativo'
    AND seller.id IS DISTINCT FROM v_closer_id
  ORDER BY seller.full_name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_meeting_source_sdr_options(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_meeting_source_sdr_options(uuid)
  TO authenticated;

DROP FUNCTION IF EXISTS public.get_meeting_signup_links(uuid);

CREATE FUNCTION public.get_meeting_signup_links(
  p_appointment_id uuid,
  p_source_sdr_id uuid DEFAULT NULL
)
RETURNS TABLE (
  profile_role text,
  token text,
  source_sdr_id uuid,
  source_sdr_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_closer_id uuid;
  v_meeting_closer_id uuid;
  v_sdr_id uuid;
BEGIN
  SELECT seller.id
  INTO v_closer_id
  FROM public.internal_users AS seller
  WHERE seller.auth_user_id = auth.uid()
    AND seller.role = 'vendedor'
    AND seller.seller_type = 'closer'
    AND seller.status = 'ativo'
  LIMIT 1;

  IF v_closer_id IS NULL THEN
    RAISE EXCEPTION 'Somente Closers ativos podem gerar o link desta reuniao.';
  END IF;

  SELECT coalesce(appointment.assigned_closer_id, appointment.seller_id)
  INTO v_meeting_closer_id
  FROM public.seller_appointments AS appointment
  WHERE appointment.id = p_appointment_id
    AND appointment.type = 'reuniao';

  IF v_meeting_closer_id IS DISTINCT FROM v_closer_id THEN
    RAISE EXCEPTION 'Reuniao nao encontrada na agenda deste Closer.';
  END IF;

  v_sdr_id := public.resolve_seller_meeting_source_sdr(
    p_appointment_id,
    NULL,
    p_source_sdr_id
  );

  RETURN QUERY
  SELECT generated.profile_role, generated.token,
    generated.source_sdr_id, generated.source_sdr_name
  FROM public.get_my_seller_signup_links(v_sdr_id) AS generated;
END;
$$;

REVOKE ALL ON FUNCTION public.get_meeting_signup_links(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_meeting_signup_links(uuid, uuid)
  TO authenticated;

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
  v_sdr public.internal_users%ROWTYPE;
  v_role_label text;
  v_inserted integer := 0;
  v_sdr_credited boolean := false;
BEGIN
  PERFORM public.resolve_seller_meeting_source_sdr(
    p_appointment_id,
    p_profile_id,
    NULL
  );

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

  SELECT event, link.source_sdr_id
  INTO v_event, v_link_source_sdr_id
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
    SELECT seller.*
    INTO v_sdr
    FROM public.internal_users AS seller
    WHERE seller.id = v_meeting.sdr_id
      AND seller.role = 'vendedor'
      AND seller.seller_type = 'sdr'
      AND seller.status = 'ativo';

    IF v_sdr.id IS NOT NULL THEN
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
        v_sdr.id,
        'sdr',
        p_profile_id,
        p_profile_role,
        lower(trim(p_email)),
        'link'
      )
      ON CONFLICT (registered_profile_id, seller_id, seller_type) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;

      v_sdr_partnership_id := public.ensure_seller_signup_partnership(
        v_sdr.id,
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
          v_sdr.auth_user_id,
          'Novo cadastro compartilhado',
          trim(coalesce(p_display_name, 'Um novo cliente')) ||
            ' concluiu o cadastro como ' || v_role_label ||
            '. A origem da reuniao foi reconhecida automaticamente.',
          'cadastro_link', 'user-plus', 'amarelo', '/vendedor/ranking'
        );
      END IF;
    END IF;
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

  UPDATE public.seller_appointments AS follow_up
  SET seller_id = CASE
        WHEN follow_up.follow_up_owner_type = 'sdr' AND v_sdr.id IS NOT NULL
          THEN v_sdr.id
        ELSE follow_up.seller_id
      END,
      tracked_profile_id = coalesce(follow_up.tracked_profile_id, p_profile_id),
      partnership_id = coalesce(
        follow_up.partnership_id,
        CASE follow_up.follow_up_owner_type
          WHEN 'sdr' THEN v_sdr_partnership_id
          ELSE v_closer_partnership_id
        END
      ),
      updated_at = now()
  WHERE follow_up.origin_appointment_id = v_meeting.id
    AND follow_up.source = 'meeting_follow_up'
    AND follow_up.status NOT IN ('concluido', 'cancelado');

  IF v_sdr.id IS NOT NULL AND v_link_source_sdr_id IS NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.seller_signup_attributions AS attribution
      WHERE attribution.registered_profile_id = p_profile_id
        AND attribution.seller_id = v_sdr.id
        AND attribution.seller_type = 'sdr'
    )
    INTO v_sdr_credited;

    IF v_sdr_credited THEN
      RETURN QUERY
      SELECT v_sdr.email::text, v_sdr.full_name::text, 'sdr'::text;
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

-- Recupera todos os cadastros com contexto de reuniao persistido no Auth.
-- Diferentemente do reparo anterior, isso inclui reutilizacoes do mesmo evento,
-- pois cada perfil conserva seu proprio seller_meeting_id nos metadados.
DO $$
DECLARE
  v_candidate record;
BEGIN
  FOR v_candidate IN
    SELECT
      profile.id AS profile_id,
      profile.role::text AS profile_role,
      profile.email,
      profile.nome AS display_name,
      account.raw_user_meta_data ->> 'seller_meeting_id' AS appointment_id,
      account.raw_user_meta_data ->> 'seller_link_token' AS token
    FROM public.profiles AS profile
    JOIN auth.users AS account ON account.id = profile.id
    WHERE profile.role::text IN ('proprietario', 'imobiliaria', 'corretor')
      AND coalesce(account.raw_user_meta_data ->> 'seller_meeting_id', '')
        ~ '^[0-9a-fA-F-]{36}$'
      AND coalesce(account.raw_user_meta_data ->> 'seller_link_token', '')
        ~ '^[a-fA-F0-9]{48}$'
      AND NOT EXISTS (
        SELECT 1
        FROM public.seller_signup_attributions AS attribution
        JOIN public.internal_users AS seller ON seller.id = attribution.seller_id
        WHERE attribution.registered_profile_id = profile.id
          AND attribution.seller_type = 'sdr'
          AND seller.status = 'ativo'
      )
    ORDER BY profile.created_at
  LOOP
    BEGIN
      PERFORM *
      FROM public.claim_seller_signup_link_for_meeting(
        v_candidate.appointment_id::uuid,
        v_candidate.token,
        v_candidate.profile_id,
        v_candidate.profile_role,
        v_candidate.email,
        v_candidate.display_name
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Nao foi possivel recuperar o cadastro %: %',
        v_candidate.profile_id, SQLERRM;
    END;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.resolve_seller_meeting_source_sdr(uuid, uuid, uuid) IS
  'Resolve e persiste o SDR da reuniao por vinculo existente, telefone, nome inequivoco ou escolha confirmada pelo Closer.';
COMMENT ON FUNCTION public.get_meeting_source_sdr_options(uuid) IS
  'Lista SDRs ativos somente para o Closer dono da reuniao, como fallback quando a origem nao pode ser inferida.';
COMMENT ON FUNCTION public.get_meeting_signup_links(uuid, uuid) IS
  'Gera links da reuniao e estrutura automaticamente o SDR de origem; aceita confirmacao explicita apenas como fallback.';
COMMENT ON FUNCTION public.claim_seller_signup_link_for_meeting(uuid, text, uuid, text, text, text) IS
  'Credita Closer e SDR da reuniao de modo idempotente, inclusive quando um link direto antigo nao carregava source_sdr_id.';

NOTIFY pgrst, 'reload schema';

COMMIT;
