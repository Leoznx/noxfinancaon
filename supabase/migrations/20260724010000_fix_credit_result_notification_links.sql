-- Credit-result notifications must use the canonical web route. The mobile
-- client translates this path to its native `/consulta/:id` screen.
CREATE OR REPLACE FUNCTION public.notify_credit_result()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result text;
  v_old_result text;
  v_tenant_name text := COALESCE(NULLIF(trim(NEW.tenant_name), ''), 'seu cliente');
BEGIN
  IF NEW.profile_id_solicitante IS NULL THEN RETURN NEW; END IF;
  v_result := lower(COALESCE(NULLIF(NEW.resultado::text, ''), NULLIF(NEW.status::text, ''), ''));
  IF v_result NOT IN ('aprovado', 'recusado', 'reprovado', 'em_analise') THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old_result := lower(COALESCE(NULLIF(OLD.resultado::text, ''), NULLIF(OLD.status::text, ''), ''));
    IF v_result = v_old_result THEN RETURN NEW; END IF;
  END IF;

  IF v_result = 'aprovado' AND EXISTS (
    SELECT 1 FROM public.notification_preferences preference
    WHERE preference.user_id = NEW.profile_id_solicitante
      AND preference.consulta_pre_aprovada = false
  ) THEN RETURN NEW; END IF;

  PERFORM public.enqueue_important_notification(
    'consulta-resultado:' || NEW.id || ':' || v_result,
    NEW.profile_id_solicitante,
    CASE
      WHEN v_result = 'aprovado' THEN 'Consulta aprovada'
      WHEN v_result IN ('recusado', 'reprovado') THEN 'Consulta recusada'
      ELSE 'Consulta em análise'
    END,
    CASE
      WHEN v_result = 'aprovado' THEN 'A consulta de ' || v_tenant_name || ' foi aprovada.'
      WHEN v_result IN ('recusado', 'reprovado') THEN 'A consulta de ' || v_tenant_name || ' não foi aprovada.'
      ELSE 'A consulta de ' || v_tenant_name || ' precisa de análise complementar.'
    END,
    CASE
      WHEN v_result = 'aprovado' THEN 'consulta_aprovada'
      WHEN v_result IN ('recusado', 'reprovado') THEN 'consulta_recusada'
      ELSE 'consulta_em_analise'
    END,
    CASE WHEN v_result = 'aprovado' THEN 'verde'
         WHEN v_result IN ('recusado', 'reprovado') THEN 'vermelho'
         ELSE 'amarelo' END,
    '/consultas/' || NEW.id || '/resultado'
  );
  RETURN NEW;
END;
$$;

-- Repair notifications that are already visible in the bell/list so they also
-- work for clients that do not yet have link normalization.
UPDATE public.notificacoes
SET link = '/consultas/' || substring(link FROM '^/consulta/([^/?#]+)') || '/resultado'
WHERE tipo IN ('consulta_aprovada', 'consulta_recusada', 'consulta_em_analise')
  AND link ~ '^/consulta/[^/?#]+';
