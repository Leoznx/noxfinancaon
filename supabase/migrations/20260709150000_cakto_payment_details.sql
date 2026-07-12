-- Detalhes retornados pela Cakto para exibição no frontend.
ALTER TABLE public.cakto_payments
  ADD COLUMN IF NOT EXISTS payment_url TEXT,
  ADD COLUMN IF NOT EXISTS pix_qr_code TEXT,
  ADD COLUMN IF NOT EXISTS pix_copy_paste TEXT,
  ADD COLUMN IF NOT EXISTS boleto_url TEXT,
  ADD COLUMN IF NOT EXISTS boleto_barcode TEXT,
  ADD COLUMN IF NOT EXISTS webhook_payload JSONB;

COMMENT ON COLUMN public.cakto_payments.payment_url IS 'URL de checkout/pagamento retornada pela Cakto quando existir.';
COMMENT ON COLUMN public.cakto_payments.pix_qr_code IS 'QR Code Pix retornado pela Cakto, geralmente em base64/data URL.';
COMMENT ON COLUMN public.cakto_payments.pix_copy_paste IS 'Código Pix copia e cola retornado pela Cakto.';
COMMENT ON COLUMN public.cakto_payments.boleto_url IS 'URL/PDF do boleto retornado pela Cakto.';
COMMENT ON COLUMN public.cakto_payments.boleto_barcode IS 'Linha digitável/código de barras do boleto retornado pela Cakto.';
COMMENT ON COLUMN public.cakto_payments.webhook_payload IS 'Último payload bruto recebido no webhook da Cakto.';
