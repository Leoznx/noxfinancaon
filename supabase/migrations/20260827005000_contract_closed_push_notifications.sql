-- Mantém a central web e o push mobile com a mesma mensagem de comissão.
-- O envio ao Expo continua centralizado no AFTER INSERT de notificacoes,
-- portanto vale igualmente para fechamentos originados no site e no app.

CREATE OR REPLACE FUNCTION private.normalize_contract_closed_commission_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_amount text;
BEGIN
  -- generate_commissions_for_policy é a fonte canônica das comissões de
  -- corretor, imobiliária e proprietário. Normalizamos somente a mensagem de
  -- criação; liberações e demais avisos preservam seus textos próprios.
  IF NEW.tipo = 'nova_comissao'
     AND NEW.titulo = 'Nova comissão registrada' THEN
    v_amount := substring(
      NEW.mensagem
      FROM 'R\$[[:space:]]+([0-9]+[.,][0-9]{2})'
    );

    IF v_amount IS NOT NULL THEN
      NEW.titulo := 'Contrato Fechado';
      NEW.mensagem := 'Sua comissão: R$ ' || replace(v_amount, '.', ',');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_contract_closed_commission_notification
  ON public.notificacoes;
CREATE TRIGGER trg_normalize_contract_closed_commission_notification
BEFORE INSERT ON public.notificacoes
FOR EACH ROW
EXECUTE FUNCTION private.normalize_contract_closed_commission_notification();

-- A automação do vendedor cria seller_commissions com valor zero e materializa
-- o valor logo depois. O alerta deve sair nessa transição, nunca como R$ 0,00.
CREATE OR REPLACE FUNCTION public.notify_seller_commission_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_amount numeric := coalesce(NEW.commission_amount, 0) + coalesce(NEW.bonus_amount, 0);
  v_old_amount numeric := 0;
  v_is_contract_commission boolean := coalesce(NEW.contract_id, NEW.apolice_id) IS NOT NULL;
  v_contract_value_became_available boolean := false;
  v_status_changed boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old_amount := coalesce(OLD.commission_amount, 0) + coalesce(OLD.bonus_amount, 0);
    v_status_changed := NEW.status IS DISTINCT FROM OLD.status;
  END IF;

  v_contract_value_became_available :=
    v_is_contract_commission
    AND v_amount > 0
    AND (TG_OP = 'INSERT' OR v_old_amount <= 0);

  -- Inserções automáticas começam em zero: aguarde a materialização. Em
  -- updates sem mudança de valor/status não existe um novo evento a notificar.
  IF NOT v_contract_value_became_available
     AND NOT v_status_changed
     AND NOT (TG_OP = 'INSERT' AND v_amount > 0) THEN
    RETURN NEW;
  END IF;

  SELECT internal_user.auth_user_id
  INTO v_user_id
  FROM public.internal_users AS internal_user
  WHERE internal_user.id = NEW.seller_id;

  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.notification_preferences AS preference
    WHERE preference.user_id = v_user_id
      AND preference.nova_comissao = false
  ) THEN
    RETURN NEW;
  END IF;

  IF v_contract_value_became_available THEN
    -- A chave por seller_commissions.id impede um segundo alerta do mesmo
    -- fechamento caso o valor seja recalculado posteriormente.
    PERFORM public.enqueue_important_notification(
      'seller-contract-closed-commission:' || NEW.id::text,
      v_user_id,
      'Contrato Fechado',
      'Sua comissão: R$ ' || replace(to_char(v_amount, 'FM999999990D00'), '.', ','),
      'comissao_nova',
      'amarelo',
      '/vendedor/comissoes'
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.notificacoes (
      user_id, titulo, mensagem, tipo, cor_destaque, link
    ) VALUES (
      v_user_id,
      'Nova comissão gerada',
      'Uma nova comissão de R$ ' ||
        replace(to_char(v_amount, 'FM999999990D00'), '.', ',') ||
        ' foi registrada.',
      'comissao_nova',
      'amarelo',
      '/vendedor/comissoes'
    );
    RETURN NEW;
  END IF;

  INSERT INTO public.notificacoes (
    user_id, titulo, mensagem, tipo, cor_destaque, link
  ) VALUES (
    v_user_id,
    'Comissão atualizada',
    'Sua comissão agora está com status ' || replace(lower(NEW.status), '_', ' ') || '.',
    CASE
      WHEN lower(NEW.status) LIKE 'liberada%' THEN 'comissao_liberada'
      ELSE 'comissao_nova'
    END,
    CASE
      WHEN lower(NEW.status) LIKE 'liberada%' THEN 'verde'
      ELSE 'amarelo'
    END,
    '/vendedor/comissoes'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_seller_commission_change
  ON public.seller_commissions;
CREATE TRIGGER trg_notify_seller_commission_change
AFTER INSERT OR UPDATE OF status, commission_amount, bonus_amount
ON public.seller_commissions
FOR EACH ROW
EXECUTE FUNCTION public.notify_seller_commission_change();

COMMENT ON FUNCTION private.normalize_contract_closed_commission_notification() IS
  'Normaliza a criação de comissão para Contrato Fechado / Sua comissão antes de alimentar sino e push.';
COMMENT ON FUNCTION public.notify_seller_commission_change() IS
  'Notifica vendedor sobre comissão de contrato somente após o valor sair de zero, com deduplicação por fechamento.';
