-- Torna todos os links comerciais permanentes e recupera o credito mesmo se
-- a chamada da aplicacao for interrompida depois da criacao da conta.

CREATE OR REPLACE FUNCTION public.claim_seller_signup_link(
  p_token text,
  p_profile_id uuid,
  p_profile_role text,
  p_email text,
  p_display_name text
)
RETURNS TABLE (recipient_email text, recipient_name text, credited_seller_type text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_link record;
  v_profile_email text;
  v_profile_role text;
  v_role_label text;
  v_inserted integer := 0;
  v_any_inserted boolean := false;
  v_seller_credited boolean := false;
  v_sdr_credited boolean := false;
BEGIN
  SELECT lower(profile.email), profile.role::text
    INTO v_profile_email, v_profile_role
  FROM public.profiles AS profile
  WHERE profile.id = p_profile_id;

  IF v_profile_email IS NULL
     OR v_profile_email <> lower(trim(p_email))
     OR v_profile_role <> p_profile_role
     OR p_profile_role NOT IN ('proprietario', 'imobiliaria', 'corretor') THEN
    RAISE EXCEPTION 'Os dados do cadastro nao correspondem ao perfil criado.';
  END IF;

  SELECT link.id, link.seller_id, link.source_sdr_id,
    seller.seller_type, seller.auth_user_id, seller.email, seller.full_name,
    source_sdr.auth_user_id AS source_auth_user_id,
    source_sdr.email AS source_email,
    source_sdr.full_name AS source_name
  INTO v_link
  FROM public.seller_signup_links AS link
  JOIN public.internal_users AS seller ON seller.id = link.seller_id
  LEFT JOIN public.internal_users AS source_sdr ON source_sdr.id = link.source_sdr_id
  WHERE link.token = trim(p_token)
    AND link.profile_role = p_profile_role
    AND link.active
    AND seller.role = 'vendedor'
    AND seller.seller_type IN ('sdr', 'closer')
    AND seller.status = 'ativo'
    AND (
      link.source_sdr_id IS NULL
      OR (
        seller.seller_type = 'closer'
        AND source_sdr.role = 'vendedor'
        AND source_sdr.seller_type = 'sdr'
        AND source_sdr.status = 'ativo'
        AND EXISTS (
          SELECT 1 FROM public.seller_appointments AS appointment
          WHERE appointment.assigned_closer_id = seller.id
            AND appointment.sdr_id = source_sdr.id
            AND appointment.source = 'sdr_handoff'
        )
      )
    )
  LIMIT 1
  FOR UPDATE OF link;

  IF v_link.id IS NULL THEN
    RAISE EXCEPTION 'Link de cadastro invalido ou inativo.';
  END IF;

  v_role_label := CASE p_profile_role
    WHEN 'proprietario' THEN 'proprietario'
    WHEN 'imobiliaria' THEN 'imobiliaria'
    ELSE 'corretor'
  END;

  INSERT INTO public.seller_signup_attributions (
    link_id, seller_id, seller_type, registered_profile_id, profile_role, registered_email
  ) VALUES (
    v_link.id, v_link.seller_id, v_link.seller_type,
    p_profile_id, p_profile_role, lower(trim(p_email))
  )
  ON CONFLICT (registered_profile_id, seller_type) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  PERFORM public.ensure_seller_signup_partnership(
    v_link.seller_id, p_profile_id, p_profile_role, p_email
  );

  IF v_inserted > 0 THEN
    v_any_inserted := true;
    INSERT INTO public.notificacoes (
      user_id, titulo, mensagem, tipo, icone, cor_destaque, link
    ) VALUES (
      v_link.auth_user_id,
      'Novo cadastro pelo seu link',
      trim(coalesce(p_display_name, 'Um novo cliente')) || ' concluiu o cadastro como ' ||
        v_role_label || '. O cadastro ja entrou no seu ranking e na sua carteira.',
      'cadastro_link', 'user-plus', 'amarelo', '/vendedor/ranking'
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.seller_signup_attributions AS attribution
    WHERE attribution.registered_profile_id = p_profile_id
      AND attribution.seller_id = v_link.seller_id
      AND attribution.link_id = v_link.id
  ) INTO v_seller_credited;

  IF v_link.source_sdr_id IS NOT NULL THEN
    INSERT INTO public.seller_signup_attributions (
      link_id, seller_id, seller_type, registered_profile_id, profile_role, registered_email
    ) VALUES (
      v_link.id, v_link.source_sdr_id, 'sdr',
      p_profile_id, p_profile_role, lower(trim(p_email))
    )
    ON CONFLICT (registered_profile_id, seller_type) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    PERFORM public.ensure_seller_signup_partnership(
      v_link.source_sdr_id, p_profile_id, p_profile_role, p_email
    );

    IF v_inserted > 0 THEN
      v_any_inserted := true;
      INSERT INTO public.notificacoes (
        user_id, titulo, mensagem, tipo, icone, cor_destaque, link
      ) VALUES (
        v_link.source_auth_user_id,
        'Novo cadastro compartilhado',
        trim(coalesce(p_display_name, 'Um novo cliente')) || ' concluiu o cadastro como ' ||
          v_role_label || ' apos sua reuniao. O cliente esta vinculado ao SDR e ao Closer.',
        'cadastro_link', 'user-plus', 'amarelo', '/vendedor/ranking'
      );
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.seller_signup_attributions AS attribution
      WHERE attribution.registered_profile_id = p_profile_id
        AND attribution.seller_id = v_link.source_sdr_id
        AND attribution.link_id = v_link.id
    ) INTO v_sdr_credited;
  END IF;

  IF v_any_inserted THEN
    UPDATE public.seller_signup_links
    SET usage_count = usage_count + 1, last_used_at = now(), updated_at = now()
    WHERE id = v_link.id;
  END IF;

  -- A primeira chamada pode acontecer pelo gatilho do perfil e a segunda pelo
  -- servidor. Devolver os responsaveis tambem na repeticao preserva o e-mail
  -- de aviso, sem duplicar ranking, notificacao nem contador de uso.
  IF v_seller_credited THEN
    RETURN QUERY SELECT v_link.email::text, v_link.full_name::text, v_link.seller_type::text;
  END IF;
  IF v_sdr_credited THEN
    RETURN QUERY SELECT v_link.source_email::text, v_link.source_name::text, 'sdr'::text;
  END IF;
END;
$$;

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

  -- O evento prova a origem da reuniao, mas nao e um cupom de uso unico.
  -- Cada perfil distinto pode usar o mesmo link permanente.
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

  -- O evento conserva o primeiro cliente como referencia de auditoria, sem
  -- bloquear os proximos. Todas as conversoes ficam nas atribuicoes.
  UPDATE public.seller_signup_link_send_events
  SET claimed_profile_id = coalesce(claimed_profile_id, p_profile_id),
      claimed_at = coalesce(claimed_at, now())
  WHERE id = v_event.id;

  -- Uma reuniao representa um cliente. Se o link for reutilizado, nao trocamos
  -- o cliente e os follow-ups que ja pertencem a reuniao original.
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
END;
$$;

-- O token e o contexto de reuniao chegam no metadata criado pelo backend.
-- Assim, a atribuicao e feita na mesma transacao que cria o perfil e nunca
-- depende apenas de uma segunda chamada HTTP que pode ser interrompida.
CREATE OR REPLACE FUNCTION public.auto_claim_seller_signup_from_auth_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_metadata jsonb;
  v_token text;
  v_meeting_text text;
BEGIN
  SELECT coalesce(auth_user.raw_user_meta_data, '{}'::jsonb)
  INTO v_metadata
  FROM auth.users AS auth_user
  WHERE auth_user.id = NEW.id;

  v_token := nullif(trim(v_metadata ->> 'seller_link_token'), '');
  v_meeting_text := nullif(trim(v_metadata ->> 'seller_meeting_id'), '');

  IF v_token IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_token !~ '^[a-fA-F0-9]{48}$'
     OR NEW.role::text NOT IN ('proprietario', 'imobiliaria', 'corretor') THEN
    RAISE EXCEPTION 'Contexto comercial de cadastro invalido.';
  END IF;

  IF v_meeting_text IS NOT NULL THEN
    PERFORM 1
    FROM public.claim_seller_signup_link_for_meeting(
      v_meeting_text::uuid,
      v_token,
      NEW.id,
      NEW.role::text,
      NEW.email,
      NEW.nome
    );
  ELSE
    PERFORM 1
    FROM public.claim_seller_signup_link(
      v_token,
      NEW.id,
      NEW.role::text,
      NEW.email,
      NEW.nome
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_claim_seller_signup_from_auth_metadata
  ON public.profiles;
CREATE TRIGGER trg_auto_claim_seller_signup_from_auth_metadata
AFTER INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.auto_claim_seller_signup_from_auth_metadata();

REVOKE ALL ON FUNCTION public.auto_claim_seller_signup_from_auth_metadata()
  FROM PUBLIC, anon, authenticated;

-- Repara o segundo cadastro confirmado pelo usuario na auditoria do Closer
-- Carlos. Os UUIDs tornam a operacao idempotente e evitam heuristica por data.
DO $$
DECLARE
  v_seller_id constant uuid := '9acee7ff-1060-46da-8e93-2a73b29c4f06';
  v_profile_id constant uuid := '35ee6f0f-475e-47ef-9ec9-92355cb3eecb';
  v_link_id constant uuid := '590ace36-fb30-4479-bf82-d9de93823a8c';
  v_inserted integer := 0;
  v_auth_user_id uuid;
  v_profile_name text;
BEGIN
  INSERT INTO public.seller_signup_attributions (
    link_id,
    seller_id,
    seller_type,
    registered_profile_id,
    profile_role,
    registered_email,
    source
  )
  SELECT
    link.id,
    seller.id,
    'closer',
    profile.id,
    'imobiliaria',
    lower(profile.email),
    'link'
  FROM public.seller_signup_links AS link
  JOIN public.internal_users AS seller ON seller.id = link.seller_id
  JOIN public.profiles AS profile ON profile.id = v_profile_id
  WHERE link.id = v_link_id
    AND link.seller_id = v_seller_id
    AND link.source_sdr_id IS NULL
    AND link.profile_role = 'imobiliaria'
    AND link.active
    AND seller.role = 'vendedor'
    AND seller.seller_type = 'closer'
    AND seller.status = 'ativo'
    AND profile.role::text = 'imobiliaria'
  ON CONFLICT (registered_profile_id, seller_type) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted > 0 THEN
    UPDATE public.seller_signup_links
    SET usage_count = usage_count + 1,
        last_used_at = greatest(coalesce(last_used_at, '-infinity'::timestamptz), now()),
        updated_at = now()
    WHERE id = v_link_id;

    PERFORM public.ensure_seller_signup_partnership(
      v_seller_id,
      v_profile_id,
      'imobiliaria',
      (SELECT profile.email FROM public.profiles AS profile WHERE profile.id = v_profile_id)
    );

    SELECT seller.auth_user_id, profile.nome
    INTO v_auth_user_id, v_profile_name
    FROM public.internal_users AS seller
    CROSS JOIN public.profiles AS profile
    WHERE seller.id = v_seller_id
      AND profile.id = v_profile_id;

    INSERT INTO public.notificacoes (
      user_id, titulo, mensagem, tipo, icone, cor_destaque, link
    ) VALUES (
      v_auth_user_id,
      'Cadastro recuperado pelo seu link',
      coalesce(nullif(trim(v_profile_name), ''), 'Um cliente') ||
        ' foi vinculado ao seu ranking e a sua carteira.',
      'cadastro_link', 'user-plus', 'amarelo', '/vendedor/clientes'
    );
  END IF;
END;
$$;

COMMENT ON FUNCTION public.claim_seller_signup_link(text, uuid, text, text, text) IS
  'Atribui cada perfil distinto usando links permanentes; repeticoes sao idempotentes e preservam os destinatarios de e-mail.';
COMMENT ON FUNCTION public.claim_seller_signup_link_for_meeting(uuid, text, uuid, text, text, text) IS
  'Atribui cada perfil distinto ao Closer e ao SDR da reuniao sem consumir o link ou trocar o cliente original da agenda.';
COMMENT ON FUNCTION public.auto_claim_seller_signup_from_auth_metadata() IS
  'Garante o credito comercial na mesma transacao em que o perfil e criado pelo backend.';
