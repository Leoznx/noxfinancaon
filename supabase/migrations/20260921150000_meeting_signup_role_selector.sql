-- Um unico envio da reuniao pode levar o cliente para a escolha do perfil.
-- Os tres tokens profissionais continuam sendo registrados para que a
-- atribuicao existente (Closer, SDR, ranking, carteira e comissao) permaneça
-- inalterada. send_group_id permite contabilizar a acao como um unico envio.

ALTER TABLE public.seller_signup_link_send_events
  ADD COLUMN IF NOT EXISTS send_group_id uuid;

CREATE INDEX IF NOT EXISTS seller_signup_link_send_events_group_idx
  ON public.seller_signup_link_send_events (send_group_id)
  WHERE send_group_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.record_meeting_signup_selector_send(
  p_appointment_id uuid,
  p_proprietario_token text,
  p_imobiliaria_token text,
  p_corretor_token text,
  p_channel text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_group_id uuid := gen_random_uuid();
  v_event_id uuid;
BEGIN
  v_event_id := public.record_meeting_signup_link_send(
    p_appointment_id,
    p_proprietario_token,
    'proprietario',
    p_channel
  );
  UPDATE public.seller_signup_link_send_events
  SET send_group_id = v_group_id
  WHERE id = v_event_id;

  v_event_id := public.record_meeting_signup_link_send(
    p_appointment_id,
    p_imobiliaria_token,
    'imobiliaria',
    p_channel
  );
  UPDATE public.seller_signup_link_send_events
  SET send_group_id = v_group_id
  WHERE id = v_event_id;

  v_event_id := public.record_meeting_signup_link_send(
    p_appointment_id,
    p_corretor_token,
    'corretor',
    p_channel
  );
  UPDATE public.seller_signup_link_send_events
  SET send_group_id = v_group_id
  WHERE id = v_event_id;

  RETURN v_group_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_meeting_signup_selector_send(
  uuid, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_meeting_signup_selector_send(
  uuid, text, text, text, text
) TO authenticated;

COMMENT ON FUNCTION public.record_meeting_signup_selector_send(uuid, text, text, text, text) IS
  'Registra um unico compartilhamento da reuniao para a tela de escolha, preservando os tokens e creditos de cada perfil profissional.';
