-- =====================================================================
-- TESTE SQL DETERMINÍSTICO: sininho -> push e texto de contrato fechado
-- Seguro: usa user_id NULL, portanto o dispatcher nunca chama o Expo, e
-- roda dentro de BEGIN ... ROLLBACK; nenhum registro persiste.
-- =====================================================================
BEGIN;

DO $$
DECLARE
  v_notification public.notificacoes%ROWTYPE;
  v_push_trigger_exists boolean;
  v_seller_trigger_definition text;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.notificacoes'::regclass
      AND tgname = 'trg_deliver_notification_as_push'
      AND tgenabled <> 'D'
  ) INTO v_push_trigger_exists;

  IF NOT v_push_trigger_exists THEN
    RAISE EXCEPTION 'Trigger geral notificacoes -> push não está ativo.';
  END IF;

  INSERT INTO public.notificacoes (
    user_id, titulo, mensagem, tipo, cor_destaque, link
  ) VALUES (
    NULL,
    'Nova comissão registrada',
    'Uma comissão de R$ 159.99 foi registrada e aguarda a primeira mensalidade.',
    'nova_comissao',
    'yellow',
    '/minhas-comissoes'
  )
  RETURNING * INTO v_notification;

  IF v_notification.titulo <> 'Contrato Fechado' THEN
    RAISE EXCEPTION 'Título inesperado: %', v_notification.titulo;
  END IF;

  IF v_notification.mensagem <> 'Sua comissão: R$ 159,99' THEN
    RAISE EXCEPTION 'Mensagem inesperada: %', v_notification.mensagem;
  END IF;

  SELECT pg_get_triggerdef(oid)
  INTO v_seller_trigger_definition
  FROM pg_trigger
  WHERE tgrelid = 'public.seller_commissions'::regclass
    AND tgname = 'trg_notify_seller_commission_change'
    AND tgenabled <> 'D';

  IF v_seller_trigger_definition IS NULL
     OR position('commission_amount' IN v_seller_trigger_definition) = 0
     OR position('bonus_amount' IN v_seller_trigger_definition) = 0 THEN
    RAISE EXCEPTION 'Trigger do vendedor não acompanha a materialização do valor.';
  END IF;

  RAISE NOTICE 'PUSH OK: % / %', v_notification.titulo, v_notification.mensagem;
END;
$$;

ROLLBACK;
