-- Toda consulta que cai em "em_analise" após a simulação de crédito agora vai
-- para o painel jurídico (/admin/aprovacoes) imediatamente — antes só aparecia
-- (e só notificava) depois do formulário complementar. O trigger passa a avisar
-- admin/admin_master/juridico em dois momentos, com event_key distinto para o
-- dedupe do enqueue_important_notification:
--   1. a análise chega (status vira 'em_analise'), substatus ainda NULL;
--   2. o solicitante envia a documentação complementar (comportamento antigo).

CREATE OR REPLACE FUNCTION public.notify_staff_approval_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recipient record;
  v_tenant_name text := COALESCE(NULLIF(trim(NEW.tenant_name), ''), 'Cliente não informado');
  v_docs_enviados boolean :=
    COALESCE(NEW.status::text, '') IN ('pendente', 'em_analise')
    AND NEW.substatus::text IS NOT DISTINCT FROM 'documentacao_complementar_enviada';
  v_nova_analise boolean :=
    NEW.status::text IS NOT DISTINCT FROM 'em_analise'
    AND (TG_OP = 'INSERT' OR OLD.status::text IS DISTINCT FROM 'em_analise');
  v_event_key text;
  v_message text;
BEGIN
  IF NOT v_docs_enviados AND NOT v_nova_analise THEN
    RETURN NEW;
  END IF;

  -- Update sem mudança real (ex.: outra coluna do trigger regravada com o mesmo
  -- valor) não deve reprocessar o aviso de documentação.
  IF v_docs_enviados AND NOT v_nova_analise AND TG_OP = 'UPDATE' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.substatus IS NOT DISTINCT FROM OLD.substatus THEN
      RETURN NEW;
    END IF;
  END IF;

  IF v_docs_enviados THEN
    v_event_key := 'aprovacao-pendente:' || NEW.id || ':documentacao_complementar_enviada';
    v_message := 'A documentação de ' || v_tenant_name || ' está pronta para revisão.';
  ELSE
    v_event_key := 'aprovacao-pendente:' || NEW.id || ':em_analise';
    v_message := 'A análise de ' || v_tenant_name || ' aguarda decisão do jurídico.';
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
        v_event_key,
        v_recipient.user_id,
        'Nova análise aguardando decisão',
        v_message,
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

-- Regressão do bug de NULL (ver 20260723044000): enfileirar a simulação grava
-- status='pendente' com substatus NULL e não pode disparar aviso nem quebrar.
DO $$
BEGIN
  IF NULL::text IS NOT DISTINCT FROM 'documentacao_complementar_enviada' THEN
    RAISE EXCEPTION 'Unexpected NULL-safe comparison result';
  END IF;
END;
$$;
