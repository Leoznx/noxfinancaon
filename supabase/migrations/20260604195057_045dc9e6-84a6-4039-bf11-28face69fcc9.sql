-- Create leads_contato table
CREATE TABLE IF NOT EXISTS public.leads_contato (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  perfil TEXT NOT NULL CHECK (perfil IN ('corretor', 'imobiliaria', 'proprietario')),
  nome TEXT NOT NULL,
  email TEXT NOT NULL,
  telefone TEXT NOT NULL,
  cidade TEXT NOT NULL,
  uf TEXT NOT NULL,
  mensagem TEXT,
  origem TEXT DEFAULT 'landing_page',
  status TEXT DEFAULT 'novo' CHECK (status IN ('novo', 'em_contato', 'qualificado', 'convertido', 'descartado')),
  responsavel_id UUID REFERENCES public.profiles(id),
  observacoes_internas TEXT,
  contatado_em TIMESTAMP WITH TIME ZONE,
  convertido_em TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- GRANT permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads_contato TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads_contato TO service_role;
GRANT INSERT ON public.leads_contato TO anon;

-- Enable RLS
ALTER TABLE public.leads_contato ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Public can insert leads"
ON public.leads_contato FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "Admins and commercial team can manage leads"
ON public.leads_contato FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND (profiles.role = 'admin' OR profiles.role = 'comercial')
  )
);
