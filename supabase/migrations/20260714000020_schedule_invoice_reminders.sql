-- Agenda a execucao diaria da Edge Function process-scheduled-invoice-
-- notifications (lembretes de 10/5/0 dias antes do vencimento de cada
-- mensalidade). Segue o mesmo padrao defensivo ja usado em
-- 20260604203413_...sql pra atualizar_niveis_diariamente(): so tenta
-- agendar se pg_cron estiver disponivel no projeto, sem quebrar a migration
-- caso nao esteja (alguns planos/projetos Supabase nao habilitam
-- pg_cron/pg_net por padrao).
--
-- Seguranca: a chamada usa um segredo guardado no Supabase Vault (nunca em
-- texto puro num arquivo versionado). Antes desse job rodar de verdade, é
-- preciso criar o segredo uma vez via SQL Editor do painel Supabase:
--   select vault.create_secret('SEU_VALOR_SECRETO_AQUI', 'cron_notifications_secret');
-- e configurar a mesma string como CRON_NOTIFICATIONS_SECRET nas secrets da
-- Edge Function (painel > Edge Functions > Secrets), que é quem valida esse
-- header antes de processar.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    CREATE EXTENSION IF NOT EXISTS pg_net;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron/pg_net nao puderam ser habilitados automaticamente: %', SQLERRM;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    PERFORM cron.unschedule('lembretes-faturas-inquilino')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lembretes-faturas-inquilino');

    PERFORM cron.schedule(
      'lembretes-faturas-inquilino',
      '0 12 * * *', -- 12:00 UTC = 09:00 America/Sao_Paulo (sem horario de verao)
      $cron$
      SELECT net.http_post(
        url := 'https://njheoytyidsghittjilr.supabase.co/functions/v1/process-scheduled-invoice-notifications',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_notifications_secret')
        ),
        body := '{}'::jsonb
      );
      $cron$
    );
  ELSE
    RAISE NOTICE 'pg_cron/pg_net indisponiveis neste projeto — agende process-scheduled-invoice-notifications manualmente (Dashboard > Database > Cron, ou um scheduler externo).';
  END IF;
END $$;
