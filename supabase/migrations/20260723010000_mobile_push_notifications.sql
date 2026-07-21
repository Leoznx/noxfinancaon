-- Push notifications for the NOX mobile app.
-- Every row inserted into public.notificacoes is also delivered to the user's
-- active Expo devices, so existing and future notification generators are
-- automatically covered.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expo_push_token text NOT NULL UNIQUE,
  platform text NOT NULL CHECK (platform IN ('android', 'ios')),
  device_name text,
  app_version text,
  enabled boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_tokens_expo_format CHECK (
    expo_push_token ~ '^Expo(nent)?PushToken\[[-_A-Za-z0-9]+\]$'
  )
);

CREATE INDEX IF NOT EXISTS push_tokens_user_enabled_idx
  ON public.push_tokens(user_id, enabled, last_seen_at DESC);

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
GRANT SELECT, DELETE ON public.push_tokens TO authenticated;
GRANT ALL ON public.push_tokens TO service_role;

DROP POLICY IF EXISTS "Users read own push devices" ON public.push_tokens;
CREATE POLICY "Users read own push devices"
  ON public.push_tokens FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own push devices" ON public.push_tokens;
CREATE POLICY "Users delete own push devices"
  ON public.push_tokens FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.register_push_token(
  p_token text,
  p_platform text,
  p_device_name text DEFAULT NULL,
  p_app_version text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_platform NOT IN ('android', 'ios') THEN
    RAISE EXCEPTION 'Unsupported platform';
  END IF;
  IF p_token IS NULL OR p_token !~ '^Expo(nent)?PushToken\[[-_A-Za-z0-9]+\]$' THEN
    RAISE EXCEPTION 'Invalid Expo push token';
  END IF;

  INSERT INTO public.push_tokens (
    user_id, expo_push_token, platform, device_name, app_version,
    enabled, last_seen_at, updated_at
  ) VALUES (
    v_user_id, p_token, p_platform, NULLIF(trim(p_device_name), ''),
    NULLIF(trim(p_app_version), ''), true, now(), now()
  )
  ON CONFLICT (expo_push_token) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    platform = EXCLUDED.platform,
    device_name = EXCLUDED.device_name,
    app_version = EXCLUDED.app_version,
    enabled = true,
    last_seen_at = now(),
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.register_push_token(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_token(text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.unregister_push_token(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.push_tokens
  SET enabled = false, updated_at = now()
  WHERE expo_push_token = p_token
    AND user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.unregister_push_token(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unregister_push_token(text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.push_delivery_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL UNIQUE REFERENCES public.notificacoes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_count integer NOT NULL DEFAULT 0,
  request_id bigint,
  status text NOT NULL CHECK (status IN ('queued', 'skipped', 'error')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.push_delivery_log ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.push_delivery_log TO service_role;

CREATE OR REPLACE FUNCTION public.deliver_notification_as_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_messages jsonb;
  v_token_count integer := 0;
  v_badge integer := 1;
  v_request_id bigint;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.notification_preferences p
    WHERE p.user_id = NEW.user_id
      AND p.canal_app = false
  ) THEN
    INSERT INTO public.push_delivery_log (notification_id, user_id, status)
    VALUES (NEW.id, NEW.user_id, 'skipped')
    ON CONFLICT (notification_id) DO NOTHING;
    RETURN NEW;
  END IF;

  SELECT LEAST(count(*) FILTER (WHERE n.lida = false), 99)::integer
  INTO v_badge
  FROM public.notificacoes n
  WHERE n.user_id = NEW.user_id;

  WITH active_tokens AS (
    SELECT pt.expo_push_token
    FROM public.push_tokens pt
    WHERE pt.user_id = NEW.user_id
      AND pt.enabled = true
    ORDER BY pt.last_seen_at DESC
    LIMIT 100
  )
  SELECT
    jsonb_agg(jsonb_build_object(
      'to', expo_push_token,
      'title', NEW.titulo,
      'body', NEW.mensagem,
      'sound', 'default',
      'priority', 'high',
      'channelId', 'nox-important',
      'badge', GREATEST(v_badge, 1),
      'ttl', 604800,
      'data', jsonb_build_object(
        'notificationId', NEW.id,
        'type', COALESCE(NEW.tipo, 'sistema'),
        'url', COALESCE(NEW.link, '/notificacoes')
      )
    )),
    count(*)::integer
  INTO v_messages, v_token_count
  FROM active_tokens;

  IF v_token_count = 0 OR v_messages IS NULL THEN
    INSERT INTO public.push_delivery_log (notification_id, user_id, status)
    VALUES (NEW.id, NEW.user_id, 'skipped')
    ON CONFLICT (notification_id) DO NOTHING;
    RETURN NEW;
  END IF;

  SELECT net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    headers := jsonb_build_object(
      'Accept', 'application/json',
      'Accept-Encoding', 'gzip, deflate',
      'Content-Type', 'application/json'
    ),
    body := v_messages,
    timeout_milliseconds := 5000
  ) INTO v_request_id;

  INSERT INTO public.push_delivery_log (
    notification_id, user_id, token_count, request_id, status
  ) VALUES (
    NEW.id, NEW.user_id, v_token_count, v_request_id, 'queued'
  )
  ON CONFLICT (notification_id) DO UPDATE SET
    token_count = EXCLUDED.token_count,
    request_id = EXCLUDED.request_id,
    status = EXCLUDED.status,
    last_error = NULL,
    updated_at = now();

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.push_delivery_log (
    notification_id, user_id, token_count, status, last_error
  ) VALUES (
    NEW.id, NEW.user_id, v_token_count, 'error', left(SQLERRM, 500)
  )
  ON CONFLICT (notification_id) DO UPDATE SET
    token_count = EXCLUDED.token_count,
    status = 'error',
    last_error = EXCLUDED.last_error,
    updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deliver_notification_as_push ON public.notificacoes;
CREATE TRIGGER trg_deliver_notification_as_push
AFTER INSERT ON public.notificacoes
FOR EACH ROW EXECUTE FUNCTION public.deliver_notification_as_push();

-- Claim owners receive every relevant status change.
CREATE OR REPLACE FUNCTION public.notify_claim_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_label text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.profile_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_label := CASE lower(COALESCE(NEW.status, ''))
    WHEN 'em_analise' THEN 'em anÃ¡lise'
    WHEN 'aprovado' THEN 'aprovado'
    WHEN 'reprovado' THEN 'recusado'
    WHEN 'pago' THEN 'pago'
    WHEN 'encerrado' THEN 'encerrado'
    ELSE replace(lower(COALESCE(NEW.status, 'atualizado')), '_', ' ')
  END;

  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, cor_destaque, link)
  VALUES (
    NEW.profile_id,
    'Sinistro atualizado',
    'O status do seu sinistro agora Ã© ' || v_label || '.',
    'sinistro_atualizado',
    CASE WHEN lower(NEW.status) IN ('aprovado', 'pago') THEN 'verde'
         WHEN lower(NEW.status) = 'reprovado' THEN 'vermelho'
         ELSE 'amarelo' END,
    '/sinistros'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_claim_status_change ON public.sinistros;
CREATE TRIGGER trg_notify_claim_status_change
AFTER UPDATE OF status ON public.sinistros
FOR EACH ROW EXECUTE FUNCTION public.notify_claim_status_change();

-- The tenant is notified when a policy becomes active and whenever its status changes.
CREATE OR REPLACE FUNCTION public.notify_tenant_contract_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_user_id uuid;
  v_active boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(c.tenant_user_id, i.profile_id)
  INTO v_tenant_user_id
  FROM public.consultas_credito c
  LEFT JOIN public.inquilinos i ON i.id = c.inquilino_id
  WHERE c.id = NEW.consulta_id;

  IF v_tenant_user_id IS NULL THEN RETURN NEW; END IF;
  v_active := lower(COALESCE(NEW.status, '')) IN ('ativa', 'ativo', 'active');

  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, cor_destaque, link)
  VALUES (
    v_tenant_user_id,
    CASE WHEN v_active THEN 'Seu contrato estÃ¡ ativo' ELSE 'Contrato atualizado' END,
    CASE WHEN v_active
      THEN 'O contrato ' || COALESCE(NEW.numero, '') || ' foi ativado. Consulte os detalhes no aplicativo.'
      ELSE 'O contrato ' || COALESCE(NEW.numero, '') || ' teve o status atualizado para ' ||
           replace(lower(COALESCE(NEW.status, 'atualizado')), '_', ' ') || '.'
    END,
    CASE WHEN v_active THEN 'contrato_ativo' ELSE 'atualizacao' END,
    CASE WHEN v_active THEN 'verde' ELSE 'amarelo' END,
    '/apolices'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_tenant_contract_change ON public.apolices;
CREATE TRIGGER trg_notify_tenant_contract_change
AFTER INSERT OR UPDATE OF status ON public.apolices
FOR EACH ROW EXECUTE FUNCTION public.notify_tenant_contract_change();

-- The internal seller receives commission creation and release updates.
CREATE OR REPLACE FUNCTION public.notify_seller_commission_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_amount numeric;
  v_new boolean := TG_OP = 'INSERT';
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT u.auth_user_id INTO v_user_id
  FROM public.internal_users u
  WHERE u.id = NEW.seller_id;
  IF v_user_id IS NULL THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM public.notification_preferences p
    WHERE p.user_id = v_user_id AND p.nova_comissao = false
  ) THEN RETURN NEW; END IF;

  v_amount := COALESCE(NEW.commission_amount, 0) + COALESCE(NEW.bonus_amount, 0);
  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, cor_destaque, link)
  VALUES (
    v_user_id,
    CASE WHEN v_new THEN 'Nova comissÃ£o gerada' ELSE 'ComissÃ£o atualizada' END,
    CASE WHEN v_new
      THEN 'Uma nova comissÃ£o de R$ ' || to_char(v_amount, 'FM999999990D00') || ' foi registrada.'
      ELSE 'Sua comissÃ£o agora estÃ¡ com status ' || replace(lower(NEW.status), '_', ' ') || '.'
    END,
    CASE WHEN lower(NEW.status) LIKE 'liberada%' THEN 'comissao_liberada' ELSE 'comissao_nova' END,
    CASE WHEN lower(NEW.status) LIKE 'liberada%' THEN 'verde' ELSE 'amarelo' END,
    '/vendedor/comissoes'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_seller_commission_change ON public.seller_commissions;
CREATE TRIGGER trg_notify_seller_commission_change
AFTER INSERT OR UPDATE OF status ON public.seller_commissions
FOR EACH ROW EXECUTE FUNCTION public.notify_seller_commission_change();
