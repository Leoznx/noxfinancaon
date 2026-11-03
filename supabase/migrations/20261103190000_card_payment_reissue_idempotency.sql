-- Permite trocar uma cobranca existente para cartao e torna cada pedido de
-- reconfiguracao identificavel. A chave e opcional para preservar o historico
-- anterior, mas unica quando informada para bloquear repeticoes de transporte.
ALTER TABLE public.payment_reissue_requests
  DROP CONSTRAINT IF EXISTS payment_reissue_requests_requested_method_check;

ALTER TABLE public.payment_reissue_requests
  ADD CONSTRAINT payment_reissue_requests_requested_method_check
  CHECK (requested_method IN ('boleto', 'pix', 'credit_card'));

ALTER TABLE public.payment_reissue_requests
  ADD COLUMN IF NOT EXISTS request_key text;

CREATE UNIQUE INDEX IF NOT EXISTS payment_reissue_requests_request_key_uidx
  ON public.payment_reissue_requests(request_key)
  WHERE request_key IS NOT NULL;
