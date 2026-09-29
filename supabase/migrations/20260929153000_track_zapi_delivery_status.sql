-- Distingue mensagem aceita pela fila da Z-API de envio, entrega e leitura
-- efetivos. Os webhooks de delivery e message-status atualizam estas colunas.

ALTER TABLE public.contract_notification_deliveries
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

ALTER TABLE public.contract_notification_deliveries
  DROP CONSTRAINT IF EXISTS contract_notification_deliveries_status_check;

ALTER TABLE public.contract_notification_deliveries
  ADD CONSTRAINT contract_notification_deliveries_status_check
  CHECK (
    status IN (
      'pending',
      'queued',
      'sent',
      'delivered',
      'read',
      'failed',
      'not_configured'
    )
  );

CREATE INDEX IF NOT EXISTS contract_notification_deliveries_provider_message_idx
  ON public.contract_notification_deliveries (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Recupera o identificador das mensagens antigas, que era guardado apenas no
-- evento técnico e não na linha de entrega.
UPDATE public.contract_notification_deliveries delivery
SET provider_message_id = (
  SELECT event.payload ->> 'provider_message_id'
  FROM public.contract_signature_events event
  WHERE event.contract_signature_id = delivery.contract_signature_id
    AND event.event_type IN ('zapi_message_sent', 'zapi_signature_invite_sent')
    AND coalesce(event.payload ->> 'notification_type', 'insurance_active') =
      delivery.notification_type
    AND nullif(event.payload ->> 'provider_message_id', '') IS NOT NULL
  ORDER BY event.created_at DESC
  LIMIT 1
)
WHERE delivery.channel = 'whatsapp'
  AND delivery.provider_message_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.contract_signature_events event
    WHERE event.contract_signature_id = delivery.contract_signature_id
      AND event.event_type IN ('zapi_message_sent', 'zapi_signature_invite_sent')
      AND nullif(event.payload ->> 'provider_message_id', '') IS NOT NULL
  );

ALTER TABLE public.financial_notifications
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

ALTER TABLE public.financial_notifications
  DROP CONSTRAINT IF EXISTS financial_notifications_status_check;

ALTER TABLE public.financial_notifications
  ADD CONSTRAINT financial_notifications_status_check
  CHECK (
    status IN (
      'pending',
      'queued',
      'sent',
      'delivered',
      'read',
      'failed',
      'not_configured'
    )
  );

CREATE INDEX IF NOT EXISTS financial_notifications_provider_message_idx
  ON public.financial_notifications (provider_message_id)
  WHERE provider_message_id IS NOT NULL;
