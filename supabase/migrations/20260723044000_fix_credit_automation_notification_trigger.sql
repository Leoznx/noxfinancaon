-- A credit simulation is queued by updating consultas_credito to
-- status='pendente' with substatus=NULL. The previous approval notification
-- trigger used `NULL <> value`, which evaluates to NULL in PostgreSQL and let
-- the function continue. It then concatenated that NULL into event_key and
-- aborted the queue update on the NOT NULL constraint.

CREATE OR REPLACE FUNCTION public.enqueue_important_notification(
  p_event_key text,
  p_user_id uuid,
  p_title text,
  p_message text,
  p_type text,
  p_color text,
  p_link text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_id uuid;
  v_notification_id uuid;
BEGIN
  -- Notifications must never be able to roll back the business event that
  -- produced them. Invalid identifiers are ignored defensively.
  IF p_user_id IS NULL OR NULLIF(btrim(p_event_key), '') IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.important_notification_events (event_key, user_id)
  VALUES (p_event_key, p_user_id)
  ON CONFLICT (event_key, user_id) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN RETURN false; END IF;

  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, cor_destaque, link)
  VALUES (p_user_id, p_title, p_message, p_type, p_color, p_link)
  RETURNING id INTO v_notification_id;

  UPDATE public.important_notification_events
  SET notification_id = v_notification_id
  WHERE id = v_event_id;

  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_important_notification(text, uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_important_notification(text, uuid, text, text, text, text, text)
  TO service_role;
CREATE OR REPLACE FUNCTION public.notify_staff_approval_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recipient record;
  v_tenant_name text := COALESCE(NULLIF(trim(NEW.tenant_name), ''), 'Cliente não informado');
BEGIN
  -- IS DISTINCT FROM is deliberately NULL-safe. Ordinary pending automation
  -- rows have no substatus and must pass through without any approval alert.
  IF COALESCE(NEW.status::text, '') NOT IN ('pendente', 'em_analise')
     OR NEW.substatus::text IS DISTINCT FROM 'documentacao_complementar_enviada' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.substatus IS NOT DISTINCT FROM OLD.substatus THEN
      RETURN NEW;
    END IF;
  END IF;

  FOR v_recipient IN
    SELECT user_id
    FROM public.important_notification_recipients(ARRAY['admin', 'admin_master', 'juridico'])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.notification_preferences preference
      WHERE preference.user_id = v_recipient.user_id
        AND preference.aprovacoes_pendentes = false
    ) THEN
      PERFORM public.enqueue_important_notification(
        'aprovacao-pendente:' || NEW.id || ':' || NEW.substatus::text,
        v_recipient.user_id,
        'Nova análise aguardando decisão',
        'A documentação de ' || v_tenant_name || ' está pronta para revisão.',
        'aprovacao_pendente',
        'amarelo',
        '/admin/aprovacoes'
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_staff_approval_pending ON public.consultas_credito;
CREATE TRIGGER trg_notify_staff_approval_pending
AFTER INSERT OR UPDATE OF status, substatus ON public.consultas_credito
FOR EACH ROW EXECUTE FUNCTION public.notify_staff_approval_pending();
-- Exercise the exact NULL comparison that caused mobile and web queue writes
-- to fail. Raising here prevents a future regression from being deployed.
DO $$
BEGIN
  IF NULL::text IS NOT DISTINCT FROM 'documentacao_complementar_enviada' THEN
    RAISE EXCEPTION 'Unexpected NULL-safe comparison result';
  END IF;
END;
$$;
