-- Enum para os papéis de usuário
DO $$ BEGIN
    CREATE TYPE public.user_role AS ENUM ('admin', 'analista', 'financeiro', 'corretor', 'imobiliaria', 'proprietario', 'inquilino');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Tabela de Perfis (Profiles)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
    nome TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role public.user_role NOT NULL DEFAULT 'inquilino',
    telefone TEXT,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Tabela de Imobiliárias
CREATE TABLE IF NOT EXISTS public.imobiliarias (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    razao_social TEXT NOT NULL,
    cnpj TEXT UNIQUE NOT NULL,
    creci TEXT NOT NULL,
    endereco TEXT,
    comissao_pct DECIMAL(5,2) DEFAULT 0,
    contato_nome TEXT,
    contato_email TEXT,
    contato_telefone TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Tabela de Corretores
CREATE TABLE IF NOT EXISTS public.corretores (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE NOT NULL,
    susep TEXT,
    imobiliaria_id UUID REFERENCES public.imobiliarias(id) ON DELETE SET NULL,
    comissao_pct DECIMAL(5,2) DEFAULT 0,
    pix TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Tabela de Proprietários
CREATE TABLE IF NOT EXISTS public.proprietarios (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nome TEXT NOT NULL,
    cpf_cnpj TEXT UNIQUE NOT NULL,
    email TEXT,
    telefone TEXT,
    banco_dados JSONB, -- { banco: '', agencia: '', conta: '', tipo: '' }
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Tabela de Inquilinos
CREATE TABLE IF NOT EXISTS public.inquilinos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
    nome TEXT NOT NULL,
    cpf TEXT UNIQUE NOT NULL,
    rg TEXT,
    data_nascimento DATE,
    renda DECIMAL(15,2),
    profissao TEXT,
    estado_civil TEXT,
    score INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Tabela de Imóveis
CREATE TABLE IF NOT EXISTS public.imoveis (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    proprietario_id UUID REFERENCES public.proprietarios(id) ON DELETE CASCADE NOT NULL,
    imobiliaria_id UUID REFERENCES public.imobiliarias(id) ON DELETE SET NULL,
    endereco TEXT NOT NULL,
    tipo TEXT NOT NULL, -- residencial, comercial
    valor_aluguel DECIMAL(15,2) NOT NULL,
    encargos DECIMAL(15,2) DEFAULT 0, -- Condomínio + IPTU
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Tabela de Planos
CREATE TABLE IF NOT EXISTS public.planos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nome TEXT NOT NULL,
    percentual_premio DECIMAL(5,2) NOT NULL,
    cobertura_max DECIMAL(15,2),
    descricao TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Tabela de Consultas de Crédito
CREATE TABLE IF NOT EXISTS public.consultas_credito (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    inquilino_id UUID REFERENCES public.inquilinos(id) NOT NULL,
    imovel_id UUID REFERENCES public.imoveis(id) NOT NULL,
    corretor_id UUID REFERENCES public.corretores(id),
    plano_id UUID REFERENCES public.planos(id),
    status TEXT NOT NULL DEFAULT 'pendente', -- pendente, em_analise, aprovado, reprovado, pendente_documentacao
    score_interno INTEGER,
    observacoes TEXT,
    documentos JSONB, -- Array de links do storage
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Tabela de Apólices
CREATE TABLE IF NOT EXISTS public.apolices (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    numero TEXT UNIQUE NOT NULL, -- NOX-YYYY-NNNNN
    consulta_id UUID REFERENCES public.consultas_credito(id) NOT NULL,
    vigencia_inicio DATE NOT NULL,
    vigencia_fim DATE NOT NULL,
    valor_premio DECIMAL(15,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'ativa', -- ativa, cancelada, vencida, em_renovacao
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilitar RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imobiliarias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corretores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proprietarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inquilinos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imoveis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultas_credito ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apolices ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS (Simplificadas para o início)
-- Admin pode tudo
CREATE POLICY "Admin full access" ON public.profiles FOR ALL TO authenticated USING (auth.jwt() ->> 'role' = 'admin');

-- Usuário pode ver seu próprio perfil
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_profiles BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_imobiliarias BEFORE UPDATE ON public.imobiliarias FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_corretores BEFORE UPDATE ON public.corretores FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_inquilinos BEFORE UPDATE ON public.inquilinos FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_imoveis BEFORE UPDATE ON public.imoveis FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_consultas BEFORE UPDATE ON public.consultas_credito FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_apolices BEFORE UPDATE ON public.apolices FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
