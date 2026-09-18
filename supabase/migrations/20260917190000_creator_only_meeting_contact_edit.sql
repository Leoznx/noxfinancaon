-- Permite alterar somente os dados cadastrais da reuniao e somente pelo
-- colaborador que a originou. Data, horario, Closer, status e demais campos
-- permanecem fora deste contrato.
CREATE OR REPLACE FUNCTION public.update_seller_meeting_contact(
  p_appointment_id uuid,
  p_contact_name text,
  p_contact_phone text,
  p_contact_profile text,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_meeting public.seller_appointments%ROWTYPE;
  v_actor uuid := public.internal_user_id(auth.uid());
  v_creator uuid;
  v_name text := regexp_replace(btrim(coalesce(p_contact_name, '')), '[[:space:]]+', ' ', 'g');
  v_phone text := regexp_replace(coalesce(p_contact_phone, ''), '[^0-9]', '', 'g');
  v_profile text := lower(btrim(coalesce(p_contact_profile, '')));
  v_profile_label text;
  v_notes text;
BEGIN
  SELECT appointment.*
  INTO v_meeting
  FROM public.seller_appointments AS appointment
  WHERE appointment.id = p_appointment_id
  FOR UPDATE;

  IF v_meeting.id IS NULL
     OR v_meeting.type <> 'reuniao'
     OR v_meeting.source = 'meeting_follow_up' THEN
    RAISE EXCEPTION 'Reuniao nao encontrada para edicao.';
  END IF;

  v_creator := CASE
    WHEN v_meeting.source = 'sdr_handoff' AND v_meeting.sdr_id IS NOT NULL
      THEN v_meeting.sdr_id
    ELSE v_meeting.seller_id
  END;

  IF v_actor IS NULL OR v_actor <> v_creator THEN
    RAISE EXCEPTION 'Somente quem cadastrou a reuniao pode alterar os dados do cliente.';
  END IF;

  IF p_expected_updated_at IS NOT NULL
     AND v_meeting.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Esta reuniao foi atualizada em outro login. Recarregue e tente novamente.';
  END IF;

  IF char_length(v_name) < 2 OR char_length(v_name) > 160 THEN
    RAISE EXCEPTION 'Informe um nome valido.';
  END IF;

  IF left(v_phone, 2) = '55' AND char_length(v_phone) IN (12, 13) THEN
    v_phone := substring(v_phone FROM 3);
  END IF;
  IF char_length(v_phone) NOT IN (10, 11) THEN
    RAISE EXCEPTION 'Informe um telefone valido com DDD.';
  END IF;

  v_profile_label := CASE v_profile
    WHEN 'autonomo' THEN 'Autônomo'
    WHEN 'corretor' THEN 'Corretor'
    WHEN 'imobiliaria' THEN 'Imobiliária'
    ELSE NULL
  END;
  IF v_profile_label IS NULL THEN
    RAISE EXCEPTION 'Escolha Autonomo, Corretor ou Imobiliaria.';
  END IF;

  -- O trigger de protecao aceita mudancas cadastrais somente dentro deste RPC.
  PERFORM set_config('nox.meeting_update_scope', 'contact', true);

  v_notes := coalesce(v_meeting.notes, '');
  IF v_notes ~* '(^|[\r\n])Tipo de cliente:[[:space:]]*[^\r\n]*' THEN
    v_notes := regexp_replace(
      v_notes,
      '(^|[\r\n])Tipo de cliente:[[:space:]]*[^\r\n]*',
      E'\\1Tipo de cliente: ' || v_profile_label,
      'i'
    );
  ELSE
    v_notes := 'Tipo de cliente: ' || v_profile_label
      || CASE WHEN btrim(v_notes) <> '' THEN E'\n' || v_notes ELSE '' END;
  END IF;

  UPDATE public.seller_appointments
  SET contact_name = v_name,
      contact_phone = v_phone,
      notes = nullif(btrim(v_notes), ''),
      title = v_profile_label || ' — ' || v_name,
      updated_at = now()
  WHERE id = v_meeting.id;

  -- Follow-ups ja criados continuam apontando para o mesmo cliente.
  UPDATE public.seller_appointments
  SET contact_name = v_name,
      contact_phone = v_phone,
      updated_at = now()
  WHERE origin_appointment_id = v_meeting.id;

  RETURN v_meeting.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_seller_meeting_contact_edits()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_creator uuid;
BEGIN
  IF OLD.type <> 'reuniao'
     OR auth.uid() IS NULL
     OR NOT (
       NEW.contact_name IS DISTINCT FROM OLD.contact_name
       OR NEW.contact_phone IS DISTINCT FROM OLD.contact_phone
       OR NEW.notes IS DISTINCT FROM OLD.notes
       OR NEW.title IS DISTINCT FROM OLD.title
     ) THEN
    RETURN NEW;
  END IF;

  IF current_setting('nox.meeting_update_scope', true) IS DISTINCT FROM 'contact' THEN
    RAISE EXCEPTION 'Use a edicao segura de dados da reuniao.';
  END IF;

  v_actor := public.internal_user_id(auth.uid());
  v_creator := CASE
    WHEN OLD.source = 'sdr_handoff' AND OLD.sdr_id IS NOT NULL THEN OLD.sdr_id
    ELSE OLD.seller_id
  END;
  IF v_actor IS NULL OR v_actor <> v_creator THEN
    RAISE EXCEPTION 'Somente quem cadastrou a reuniao pode alterar os dados do cliente.';
  END IF;

  IF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.seller_id IS DISTINCT FROM OLD.seller_id
     OR NEW.sdr_id IS DISTINCT FROM OLD.sdr_id
     OR NEW.assigned_closer_id IS DISTINCT FROM OLD.assigned_closer_id
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes THEN
    RAISE EXCEPTION 'Dados cadastrais e reagendamento devem ser alterados separadamente.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_01_guard_seller_meeting_contact_edits
  ON public.seller_appointments;
CREATE TRIGGER trg_01_guard_seller_meeting_contact_edits
BEFORE UPDATE ON public.seller_appointments
FOR EACH ROW
EXECUTE FUNCTION public.guard_seller_meeting_contact_edits();

REVOKE ALL ON FUNCTION public.guard_seller_meeting_contact_edits()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.update_seller_meeting_contact(uuid, text, text, text, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_seller_meeting_contact(uuid, text, text, text, timestamptz)
  TO authenticated;

COMMENT ON FUNCTION public.update_seller_meeting_contact(uuid, text, text, text, timestamptz) IS
  'Atualiza apenas nome, telefone e perfil da reuniao; somente o SDR/Closer que a cadastrou pode executar.';
