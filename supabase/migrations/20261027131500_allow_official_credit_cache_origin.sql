-- The document cache records a distinct origin so operations can distinguish a
-- paid Direct Data result from a zero-cost reuse. The original check constraint
-- predated that origin and rejected the entire cache transaction.

ALTER TABLE public.consultas_credito
  DROP CONSTRAINT IF EXISTS consultas_credito_automacao_origem_check;

ALTER TABLE public.consultas_credito
  ADD CONSTRAINT consultas_credito_automacao_origem_check
  CHECK (
    automacao_origem IS NULL
    OR automacao_origem IN (
      'manual_assistido',
      'mock',
      'api_oficial',
      'api_oficial_cache',
      'automacao_local'
    )
  );

COMMENT ON COLUMN public.consultas_credito.automacao_origem IS
  'Origem operacional da análise: manual, demonstração, API paga, cache oficial ou automação local.';
