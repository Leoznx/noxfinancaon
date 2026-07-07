-- DROP existing conflicting tables
DROP TABLE IF EXISTS public.comissoes CASCADE;
DROP TABLE IF EXISTS public.niveis_comissao CASCADE;

-- Tabela niveis_perfil
CREATE TABLE public.niveis_perfil (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_perfil text NOT NULL CHECK (tipo_perfil IN ('corretor', 'imobiliaria', 'proprietario')),
  nome_nivel text NOT NULL,  -- BRONZE, PRATA, OURO, DIAMANTE
  min_contratos int NOT NULL,
  max_contratos int,  -- NULL = ilimitado
  percentual_comissao numeric(5,2),
  bonus_renovacao numeric(10,2) DEFAULT 0,  -- para proprietários
  ordem int NOT NULL,
  cor_hex text,
  ativo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);

-- SEEDS dos níveis por perfil
INSERT INTO public.niveis_perfil (tipo_perfil, nome_nivel, min_contratos, max_contratos, percentual_comissao, bonus_renovacao, ordem, cor_hex) VALUES
('corretor', 'BRONZE',   0,  10,   5.00,  0, 1, '#CD7F32'),
('corretor', 'PRATA',    11, 20,   7.00,  0, 2, '#C0C0C0'),
('corretor', 'OURO',     21, 30,   9.00,  0, 3, '#FFD60A'),
('corretor', 'DIAMANTE', 31, NULL, 12.00, 0, 4, '#B9F2FF'),
('imobiliaria', 'BRONZE',   0,   30,   1.50, 0, 1, '#CD7F32'),
('imobiliaria', 'PRATA',    31,  60,   2.00, 0, 2, '#C0C0C0'),
('imobiliaria', 'OURO',     61,  100,  2.50, 0, 3, '#FFD60A'),
('imobiliaria', 'DIAMANTE', 101, NULL, 3.00, 0, 4, '#B9F2FF'),
('proprietario', 'BRONZE',   0, 1,    0.50, 50.00,  1, '#CD7F32'),
('proprietario', 'PRATA',    2, 3,    1.00, 80.00,  2, '#C0C0C0'),
('proprietario', 'OURO',     4, 6,    2.00, 150.00, 3, '#FFD60A'),
('proprietario', 'DIAMANTE', 7, NULL, 3.00, 250.00, 4, '#B9F2FF');

-- Tabela comissoes
CREATE TABLE public.comissoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  beneficiario_id uuid REFERENCES public.profiles(id) NOT NULL,
  beneficiario_tipo text NOT NULL CHECK (beneficiario_tipo IN ('corretor', 'imobiliaria', 'proprietario')),
  contrato_id uuid REFERENCES public.apolices(id) NOT NULL,
  valor numeric(10,2) NOT NULL,
  percentual_aplicado numeric(5,2),
  nivel_aplicado text NOT NULL,
  tipo_comissao text NOT NULL,  -- 'contrato_novo', 'renovacao', 'mensal'
  status text DEFAULT 'pendente' CHECK (status IN ('pendente', 'disponivel', 'sacada', 'cancelada')),
  disponivel_em timestamp with time zone,
  sacada_em timestamp with time zone,
  solicitacao_saque_id uuid, -- will reference withdrawal request later
  observacoes text,
  created_at timestamp with time zone DEFAULT now()
);

-- Tabela solicitacoes_saque
CREATE TABLE public.solicitacoes_saque (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.profiles(id) NOT NULL,
  perfil_tipo text NOT NULL,  -- 'corretor', 'imobiliaria', 'proprietario'
  valor_bruto numeric(10,2) NOT NULL,
  taxa_saque numeric(10,2) DEFAULT 3.20 NOT NULL,
  valor_liquido numeric(10,2) NOT NULL,
  pix_chave text NOT NULL,
  pix_tipo text NOT NULL CHECK (pix_tipo IN ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria')),
  status text DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovada', 'paga', 'rejeitada', 'cancelada')),
  aprovado_por uuid REFERENCES public.profiles(id),
  aprovado_em timestamp with time zone,
  pago_por uuid REFERENCES public.profiles(id),
  pago_em timestamp with time zone,
  comprovante_url text,
  motivo_rejeicao text,
  observacoes_internas text,
  created_at timestamp with time zone DEFAULT now()
);

-- Foreign key for comissoes to solicitacoes_saque
ALTER TABLE public.comissoes ADD CONSTRAINT fk_comissoes_saque FOREIGN KEY (solicitacao_saque_id) REFERENCES public.solicitacoes_saque(id);

-- View saldos_comissao
CREATE OR REPLACE VIEW public.saldos_comissao AS
SELECT 
  p.id AS profile_id,
  p.nome,
  p.role AS tipo_perfil,
  COALESCE(SUM(c.valor) FILTER (WHERE c.status = 'pendente'), 0) AS saldo_pendente,
  COALESCE(SUM(c.valor) FILTER (WHERE c.status = 'disponivel'), 0) AS saldo_disponivel,
  COALESCE(SUM(c.valor) FILTER (WHERE c.status = 'sacada'), 0) AS total_sacado,
  COALESCE(SUM(c.valor) FILTER (WHERE c.status IN ('pendente', 'disponivel', 'sacada')), 0) AS total_acumulado
FROM public.profiles p
LEFT JOIN public.comissoes c ON c.beneficiario_id = p.id
GROUP BY p.id, p.nome, p.role;

-- Tabela configuracoes_sistema
CREATE TABLE public.configuracoes_sistema (
  chave text PRIMARY KEY,
  valor text NOT NULL,
  descricao text,
  atualizado_em timestamp with time zone DEFAULT now()
);

INSERT INTO public.configuracoes_sistema (chave, valor, descricao) VALUES
('taxa_saque_brl', '3.20', 'Taxa fixa em reais cobrada por solicitação de saque'),
('valor_minimo_saque', '50.00', 'Valor mínimo permitido para solicitar saque'),
('prazo_liberacao_dias', '7', 'Dias após pagamento da 1ª mensalidade para liberar comissão');

-- Mensalidades (if not exists)
CREATE TABLE IF NOT EXISTS public.mensalidades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  apolice_id uuid REFERENCES public.apolices(id) NOT NULL,
  valor numeric(10,2) NOT NULL,
  data_vencimento date NOT NULL,
  data_pagamento timestamp with time zone,
  status text DEFAULT 'pendente' CHECK (status IN ('pendente', 'pago', 'atrasado', 'cancelado')),
  created_at timestamp with time zone DEFAULT now()
);

-- Indexes
CREATE INDEX idx_comissoes_beneficiario ON public.comissoes(beneficiario_id, status);
CREATE INDEX idx_comissoes_contrato ON public.comissoes(contrato_id);
CREATE INDEX idx_solicitacoes_status ON public.solicitacoes_saque(status, created_at);

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT ON public.saldos_comissao TO authenticated;

-- RLS
ALTER TABLE public.niveis_perfil ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comissoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitacoes_saque ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracoes_sistema ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mensalidades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read for niveis_perfil" ON public.niveis_perfil FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can view own comissoes" ON public.comissoes FOR SELECT TO authenticated USING (beneficiario_id = auth.uid() OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');
CREATE POLICY "Users can manage own saques" ON public.solicitacoes_saque FOR ALL TO authenticated USING (profile_id = auth.uid() OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');
CREATE POLICY "Admin manage configuracoes" ON public.configuracoes_sistema FOR ALL TO authenticated USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');
CREATE POLICY "Users view relevant mensalidades" ON public.mensalidades FOR SELECT TO authenticated USING (true); -- simplify for now

-- Trigger functions
CREATE OR REPLACE FUNCTION public.trigger_calcular_comissoes()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'ativa' AND (OLD.status IS NULL OR OLD.status != 'ativa') THEN
    -- In a real environment, you'd use pg_net. Here we'll rely on the app logic or a simpler mechanism
    -- For now, let's assume the edge function is called by the app layer or we can simulate it.
    -- To keep it SQL-only for the migration:
    NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER apolice_ativada_calcular_comissoes
AFTER INSERT OR UPDATE ON public.apolices
FOR EACH ROW
EXECUTE FUNCTION public.trigger_calcular_comissoes();

CREATE OR REPLACE FUNCTION public.liberar_comissoes_apos_pagamento()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'pago' AND OLD.status != 'pago' THEN
    UPDATE public.comissoes
    SET 
      status = 'disponivel',
      disponivel_em = now()
    WHERE 
      contrato_id = NEW.apolice_id 
      AND status = 'pendente'
      AND NOT EXISTS (
        SELECT 1 FROM public.mensalidades 
        WHERE apolice_id = NEW.apolice_id 
          AND status = 'pago' 
          AND id != NEW.id
      );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mensalidade_paga_libera_comissao
AFTER UPDATE ON public.mensalidades
FOR EACH ROW
EXECUTE FUNCTION public.liberar_comissoes_apos_pagamento();
