-- Adicionar colunas faltantes se não existirem
ALTER TABLE notificacoes ADD COLUMN IF NOT EXISTS link text;
ALTER TABLE notificacoes ADD COLUMN IF NOT EXISTS icone text;
ALTER TABLE notificacoes ADD COLUMN IF NOT EXISTS cor_destaque text;
ALTER TABLE notificacoes ADD COLUMN IF NOT EXISTS lida_em timestamp with time zone;

-- Grant permissions (essential for Supabase Data API)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notificacoes TO authenticated;
GRANT ALL ON public.notificacoes TO service_role;

-- Enable RLS
ALTER TABLE notificacoes ENABLE ROW LEVEL SECURITY;

-- Create policy (using user_id as confirmed by schema query)
DROP POLICY IF EXISTS "usuario_ve_proprias_notificacoes" ON notificacoes;
CREATE POLICY "usuario_ve_proprias_notificacoes"
ON notificacoes FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_notificacoes_user_lida ON notificacoes(user_id, lida, created_at DESC);
