-- =============================================================================
-- Passo atual da automação local CredPago, para a barra de progresso do modal
-- "Consultando crédito" no frontend (src/components/simulacao/ModalConsultando.tsx).
-- O worker (automation/credpagoWorker.ts) atualiza esta coluna a cada etapa;
-- o frontend já escuta UPDATEs desta tabela via Realtime (REPLICA IDENTITY FULL,
-- migration 20260704180000), então nenhuma mudança de infraestrutura é necessária
-- além da coluna em si.
-- =============================================================================

ALTER TABLE public.consultas_credito
  ADD COLUMN IF NOT EXISTS automation_step TEXT;

COMMENT ON COLUMN public.consultas_credito.automation_step IS
  'Etapa atual da automação local (abrindo | preenchendo | enviando | aguardando_resultado). Nula fora do processamento.';
