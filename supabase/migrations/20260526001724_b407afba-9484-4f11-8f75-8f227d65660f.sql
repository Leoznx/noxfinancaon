-- 1. Tabela de Comissões
CREATE TABLE IF NOT EXISTS public.comissoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corretor_id uuid REFERENCES public.corretores(id),
  apolice_id uuid REFERENCES public.apolices(id),
  valor numeric(12,2) NOT NULL,
  status text DEFAULT 'pendente',
  data_competencia date DEFAULT CURRENT_DATE,
  nivel_aplicado text,
  percentual_aplicado numeric(5,2),
  created_at timestamp WITH TIME ZONE DEFAULT now(),
  updated_at timestamp WITH TIME ZONE DEFAULT now()
);

-- 2. Tabela de Níveis de Comissão
CREATE TABLE IF NOT EXISTS public.niveis_comissao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  min_contratos int NOT NULL,
  max_contratos int,
  percentual_comissao numeric(5,2) NOT NULL,
  cor_hex text,
  icone text,
  ordem int NOT NULL,
  ativo boolean DEFAULT true,
  created_at timestamp WITH TIME ZONE DEFAULT now()
);

-- Inserindo Níveis Padrão
INSERT INTO public.niveis_comissao (nome, min_contratos, max_contratos, percentual_comissao, cor_hex, icone, ordem) VALUES
('Bronze', 0, 10, 5.00, '#CD7F32', 'Medal', 1),
('Prata', 11, 20, 7.00, '#C0C0C0', 'Award', 2),
('Ouro', 21, 30, 9.00, '#FFD700', 'Trophy', 3),
('Diamante', 31, NULL, 12.00, '#B9F2FF', 'Gem', 4)
ON CONFLICT DO NOTHING;

-- 3. Função para obter nível do corretor baseado em apólices ativas
CREATE OR REPLACE FUNCTION public.get_nivel_corretor_info(p_corretor_id uuid)
RETURNS TABLE (
    nivel_nome text,
    nivel_percentual numeric,
    nivel_cor text,
    nivel_icone text,
    contratos_ativos bigint,
    proximo_nivel_nome text,
    proximo_nivel_min int
) AS $$
DECLARE
    v_count bigint;
BEGIN
    SELECT count(*) INTO v_count 
    FROM public.apolices a
    JOIN public.consultas_credito c ON a.consulta_id = c.id
    WHERE c.corretor_id = p_corretor_id AND a.status = 'ativa';

    RETURN QUERY
    WITH atual AS (
        SELECT n.nome, n.percentual_comissao, n.cor_hex, n.icone, n.ordem
        FROM public.niveis_comissao n
        WHERE v_count >= n.min_contratos AND (n.max_contratos IS NULL OR v_count <= n.max_contratos)
        AND n.ativo = true
        ORDER BY n.ordem DESC LIMIT 1
    ),
    proximo AS (
        SELECT n.nome, n.min_contratos
        FROM public.niveis_comissao n
        WHERE n.min_contratos > v_count AND n.ativo = true
        ORDER BY n.ordem ASC LIMIT 1
    )
    SELECT 
        atual.nome, atual.percentual_comissao, atual.cor_hex, atual.icone, v_count,
        proximo.nome, proximo.min_contratos
    FROM atual LEFT JOIN proximo ON true;
END;
$$ LANGUAGE plpgsql STABLE;

-- 4. Row Level Security (RLS)
ALTER TABLE public.consultas_credito ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apolices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comissoes ENABLE ROW LEVEL SECURITY;

-- Políticas (Simplificadas para evitar subqueries complexas que podem falhar)
DROP POLICY IF EXISTS "Corretor vê só suas consultas" ON public.consultas_credito;
CREATE POLICY "Corretor vê só suas consultas" ON public.consultas_credito
FOR ALL USING (
    corretor_id IN (SELECT id FROM public.corretores WHERE profile_id = auth.uid()) 
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'analista')
);

DROP POLICY IF EXISTS "Corretor vê só suas apólices" ON public.apolices;
CREATE POLICY "Corretor vê só suas apólices" ON public.apolices
FOR SELECT USING (
    consulta_id IN (SELECT id FROM public.consultas_credito WHERE corretor_id IN (SELECT id FROM public.corretores WHERE profile_id = auth.uid()))
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'analista', 'financeiro')
);

DROP POLICY IF EXISTS "Corretor vê só suas comissões" ON public.comissoes;
CREATE POLICY "Corretor vê só suas comissões" ON public.comissoes
FOR SELECT USING (
    corretor_id IN (SELECT id FROM public.corretores WHERE profile_id = auth.uid())
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'financeiro')
);
