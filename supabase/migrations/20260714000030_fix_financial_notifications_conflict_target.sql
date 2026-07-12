-- 20260714000010 criou uq_financial_notification_invoice/uq_financial_notification_batch
-- como indices UNICOS PARCIAIS (WHERE invoice_id/batch_id IS NOT NULL). Testado
-- ponta a ponta em producao (12 boletos reais via asaas-create-installment-plan):
-- o upsert de logFinancialNotification (.upsert(..., { onConflict:
-- "invoice_id,channel,notification_type" })) falhava silenciosamente em 100%
-- das chamadas - Postgres exige que a clausula ON CONFLICT (colunas) repita o
-- WHERE do indice quando ele e parcial, e o PostgREST (usado pelo supabase-js)
-- nao tem como expressar isso; sem WHERE, ele nao acha nenhum indice/constraint
-- compativel e o INSERT falha (erro engolido porque o codigo nao checava
-- .error do upsert). Resultado real observado: 12 faturas criadas com sucesso
-- no Asaas, mas 0 linhas em financial_notifications.
--
-- Fix: trocar para UNIQUE constraints normais (nao parciais). Semantica identica
-- pro nosso caso - cada linha usa OU invoice_id OU batch_id (nunca os dois), e
-- o Postgres ja trata cada NULL como distinto dentro de uma UNIQUE constraint
-- comum, entao multiplas linhas com invoice_id NULL (as batch-scoped) nunca
-- colidem entre si, exatamente como o indice parcial pretendia.

DROP INDEX IF EXISTS public.uq_financial_notification_invoice;
DROP INDEX IF EXISTS public.uq_financial_notification_batch;

ALTER TABLE public.financial_notifications
  DROP CONSTRAINT IF EXISTS uq_financial_notification_invoice,
  DROP CONSTRAINT IF EXISTS uq_financial_notification_batch;

ALTER TABLE public.financial_notifications
  ADD CONSTRAINT uq_financial_notification_invoice UNIQUE (invoice_id, channel, notification_type),
  ADD CONSTRAINT uq_financial_notification_batch UNIQUE (batch_id, channel, notification_type);
