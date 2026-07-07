-- Add missing columns to apolices
ALTER TABLE public.apolices 
ADD COLUMN IF NOT EXISTS corretor_profile_id UUID REFERENCES public.profiles(id),
ADD COLUMN IF NOT EXISTS imobiliaria_profile_id UUID REFERENCES public.profiles(id),
ADD COLUMN IF NOT EXISTS proprietario_profile_id UUID REFERENCES public.profiles(id);

-- Try to populate columns from consultations if possible
-- This is a best-effort migration for existing data
UPDATE public.apolices a
SET corretor_profile_id = c.corretor_id
FROM public.consultas_credito c
WHERE a.consulta_id = c.id
AND a.corretor_profile_id IS NULL;

-- Fix the career level function to be more robust
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
    -- Count active policies for the user using the new columns
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

    -- Update profile
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

-- Grant permissions
GRANT UPDATE ON public.apolices TO service_role;
GRANT SELECT ON public.apolices TO authenticated;
