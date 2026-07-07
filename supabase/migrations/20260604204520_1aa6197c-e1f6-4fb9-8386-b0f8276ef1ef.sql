-- Tabela principal de comissões
CREATE TABLE IF NOT EXISTS comissoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  beneficiario_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  beneficiario_tipo text NOT NULL CHECK (beneficiario_tipo IN ('corretor', 'imobiliaria', 'proprietario')),
  contrato_id uuid,
  valor numeric(10,2) NOT NULL DEFAULT 0,
  percentual_aplicado numeric(5,2),
  nivel_aplicado text,
  tipo_comissao text DEFAULT 'contrato_novo',
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'disponivel', 'sacada', 'cancelada')),
  disponivel_em timestamp with time zone,
  sacada_em timestamp with time zone,
  solicitacao_saque_id uuid,
  observacoes text,
  created_at timestamp with time zone DEFAULT now()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_comissoes_beneficiario ON comissoes(beneficiario_id, status);
CREATE INDEX IF NOT EXISTS idx_comissoes_created_at ON comissoes(created_at DESC);

-- RLS — Habilitar
ALTER TABLE comissoes ENABLE ROW LEVEL SECURITY;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comissoes TO authenticated;
GRANT ALL ON public.comissoes TO service_role;

-- Política: usuário vê só as próprias comissões
DROP POLICY IF EXISTS "usuario_ve_proprias_comissoes" ON comissoes;
CREATE POLICY "usuario_ve_proprias_comissoes"
ON comissoes FOR SELECT
USING (beneficiario_id = auth.uid());

-- Política: admin vê todas
DROP POLICY IF EXISTS "admin_ve_todas_comissoes" ON comissoes;
CREATE POLICY "admin_ve_todas_comissoes"
ON comissoes FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  )
);

-- Tabela de solicitações de saque
CREATE TABLE IF NOT EXISTS solicitacoes_saque (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  perfil_tipo text NOT NULL,
  valor_bruto numeric(10,2) NOT NULL,
  taxa_saque numeric(10,2) NOT NULL DEFAULT 3.20,
  valor_liquido numeric(10,2) NOT NULL,
  pix_chave text NOT NULL,
  pix_tipo text NOT NULL,
  status text NOT NULL DEFAULT 'pendente',
  aprovado_por uuid REFERENCES profiles(id),
  aprovado_em timestamp with time zone,
  pago_por uuid REFERENCES profiles(id),
  pago_em timestamp with time zone,
  comprovante_url text,
  motivo_rejeicao text,
  observacoes_internas text,
  created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE solicitacoes_saque ENABLE ROW LEVEL SECURITY;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.solicitacoes_saque TO authenticated;
GRANT ALL ON public.solicitacoes_saque TO service_role;

DROP POLICY IF EXISTS "usuario_ve_proprios_saques" ON solicitacoes_saque;
CREATE POLICY "usuario_ve_proprios_saques"
ON solicitacoes_saque FOR SELECT
USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "usuario_cria_proprio_saque" ON solicitacoes_saque;
CREATE POLICY "usuario_cria_proprio_saque"
ON solicitacoes_saque FOR INSERT
WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "admin_gerencia_saques" ON solicitacoes_saque;
CREATE POLICY "admin_gerencia_saques"
ON solicitacoes_saque FOR ALL
USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
