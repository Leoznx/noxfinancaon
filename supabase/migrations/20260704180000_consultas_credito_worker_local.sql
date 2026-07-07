-- =============================================================================
-- Automação local CredPago (worker Playwright)
-- Prepara public.consultas_credito para o fluxo:
--   frontend cria consulta (status = 'pendente', origem = 'nox_financa')
--   worker local marca 'processando', executa a simulação no portal CredPago
--   worker grava resultado final: aprovado | recusado | em_analise | erro
-- Esta migration é idempotente e funciona tanto em banco vazio quanto em banco
-- que já possui a tabela criada pelas migrations anteriores.
-- =============================================================================

-- 1. Tabela base (banco vazio). Em banco existente, nada acontece.
CREATE TABLE IF NOT EXISTS public.consultas_credito (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Colunas usadas pelo formulário "Nova Consulta" e pelo worker local.
ALTER TABLE public.consultas_credito
  ADD COLUMN IF NOT EXISTS corretor_id UUID,
  ADD COLUMN IF NOT EXISTS tipo_pessoa TEXT,                 -- 'PF' | 'PJ'
  ADD COLUMN IF NOT EXISTS documento TEXT,                   -- CPF/CNPJ só dígitos
  ADD COLUMN IF NOT EXISTS documento_masked TEXT,            -- ex.: 018.***.***-16 (para exibição/logs)
  ADD COLUMN IF NOT EXISTS tipo_imovel TEXT,                 -- 'Residencial' | 'Comercial'
  ADD COLUMN IF NOT EXISTS cep TEXT,
  ADD COLUMN IF NOT EXISTS valor_aluguel NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS valor_condominio NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS valor_taxas NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS resultado TEXT,                   -- aprovado | recusado | em_analise | erro
  ADD COLUMN IF NOT EXISTS mensagem TEXT,                    -- mensagem legível vinda da automação
  ADD COLUMN IF NOT EXISTS origem TEXT DEFAULT 'painel_interno',
  ADD COLUMN IF NOT EXISTS automation_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS automation_finished_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS raw_response JSONB,               -- resumo bruto da tela de resultado
  ADD COLUMN IF NOT EXISTS error_message TEXT;

COMMENT ON COLUMN public.consultas_credito.status IS
  'pendente | processando | aprovado | recusado | em_analise | erro (fluxo automação local). Valores legados: reprovado, pendente_documentacao.';

-- 3. Amplia automacao_origem (criada em migration anterior) com 'automacao_local'.
ALTER TABLE public.consultas_credito
  ADD COLUMN IF NOT EXISTS automacao_origem TEXT;

ALTER TABLE public.consultas_credito
  DROP CONSTRAINT IF EXISTS consultas_credito_automacao_origem_check;

ALTER TABLE public.consultas_credito
  ADD CONSTRAINT consultas_credito_automacao_origem_check
  CHECK (automacao_origem IS NULL OR automacao_origem IN ('manual_assistido', 'mock', 'api_oficial', 'automacao_local'));

-- 4. Índice para a fila do worker (busca consultas pendentes da automação).
CREATE INDEX IF NOT EXISTS idx_consultas_credito_fila_automacao
  ON public.consultas_credito (created_at)
  WHERE status = 'pendente';

CREATE INDEX IF NOT EXISTS idx_consultas_credito_status
  ON public.consultas_credito (status);

-- 5. RLS + policies (idempotente; mantém as policies permissivas já existentes).
ALTER TABLE public.consultas_credito ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "App reads consultas" ON public.consultas_credito;
CREATE POLICY "App reads consultas" ON public.consultas_credito FOR SELECT USING (true);
DROP POLICY IF EXISTS "App inserts consultas" ON public.consultas_credito;
CREATE POLICY "App inserts consultas" ON public.consultas_credito FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "App updates consultas" ON public.consultas_credito;
CREATE POLICY "App updates consultas" ON public.consultas_credito FOR UPDATE USING (true);

-- 6. Trigger de updated_at (função pode não existir em banco vazio).
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_updated_at_consultas'
      AND tgrelid = 'public.consultas_credito'::regclass
  ) THEN
    CREATE TRIGGER set_updated_at_consultas
      BEFORE UPDATE ON public.consultas_credito
      FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
END $$;

-- 7. Realtime — frontend escuta o UPDATE da consulta pelo id.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'consultas_credito'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.consultas_credito';
  END IF;
END $$;

-- Realtime UPDATE precisa de replica identity full para enviar o registro completo.
ALTER TABLE public.consultas_credito REPLICA IDENTITY FULL;
