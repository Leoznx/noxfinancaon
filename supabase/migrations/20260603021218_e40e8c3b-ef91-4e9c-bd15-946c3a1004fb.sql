-- Criar tabela de sinistros se não existir
CREATE TABLE IF NOT EXISTS public.sinistros (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    apolice_id UUID NOT NULL REFERENCES public.apolices(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pendente',
    motivo TEXT,
    valor_estimado DECIMAL(10,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Grant permissões
GRANT SELECT, INSERT, UPDATE ON public.sinistros TO authenticated;
GRANT ALL ON public.sinistros TO service_role;

-- Enable RLS
ALTER TABLE public.sinistros ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own sinistros" ON public.sinistros
    FOR SELECT USING (auth.uid() = profile_id);

CREATE POLICY "Admins can view all sinistros" ON public.sinistros
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role IN ('admin', 'analista')
        )
    );

CREATE POLICY "Users can insert their own sinistros" ON public.sinistros
    FOR INSERT WITH CHECK (auth.uid() = profile_id);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_sinistros_updated_at
    BEFORE UPDATE ON public.sinistros
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
