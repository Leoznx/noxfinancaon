-- Add new columns to profiles if they don't exist
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS nivel_atual TEXT DEFAULT 'BRONZE',
ADD COLUMN IF NOT EXISTS contratos_ativos_count INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS nivel_atualizado_em TIMESTAMP WITH TIME ZONE DEFAULT now();

-- Ensure niveis_perfil table is properly set up (it already exists but let's make sure it's accessible)
GRANT SELECT ON public.niveis_perfil TO authenticated;
GRANT ALL ON public.niveis_perfil TO service_role;

-- Function to update levels daily
CREATE OR REPLACE FUNCTION public.atualizar_niveis_diariamente()
RETURNS void AS $$
DECLARE
  user_record RECORD;
  novo_nivel TEXT;
  contratos_ativos INT;
BEGIN
  -- Iterate through all users with roles that have career plans
  FOR user_record IN 
    SELECT id, role FROM public.profiles WHERE role IN ('corretor', 'imobiliaria', 'proprietario')
  LOOP
    -- Count active policies for the user
    SELECT COUNT(*) INTO contratos_ativos
    FROM public.apolices
    WHERE status = 'ativa'
      AND (
        (user_record.role = 'corretor'     AND corretor_profile_id = user_record.id) OR
        (user_record.role = 'imobiliaria'  AND imobiliaria_profile_id = user_record.id) OR
        (user_record.role = 'proprietario' AND proprietario_profile_id = user_record.id)
      );
    
    -- Find the highest matching level
    SELECT nome_nivel INTO novo_nivel
    FROM public.niveis_perfil
    WHERE tipo_perfil = CAST(user_record.role AS TEXT)
      AND min_contratos <= contratos_ativos
      AND (max_contratos >= contratos_ativos OR max_contratos IS NULL)
      AND ativo = true
    ORDER BY ordem DESC
    LIMIT 1;
    
    -- Fallback to BRONZE if no level found
    IF novo_nivel IS NULL THEN
      novo_nivel := 'BRONZE';
    END IF;

    -- Update profile if values changed
    UPDATE public.profiles 
    SET 
      nivel_atual = novo_nivel,
      contratos_ativos_count = contratos_ativos,
      nivel_atualizado_em = now()
    WHERE id = user_record.id 
      AND (nivel_atual IS DISTINCT FROM novo_nivel OR contratos_ativos_count IS DISTINCT FROM contratos_ativos);
    
  END LOOP;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Schedule daily execution at midnight (requires pg_cron extension)
-- Note: On some environments, pg_cron might not be available or requires specific setup.
-- We check if the extension exists first.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule('atualizar-niveis-carreira', '0 0 * * *', 'SELECT public.atualizar_niveis_diariamente();');
    END IF;
END $$;
