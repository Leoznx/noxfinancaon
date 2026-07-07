-- Update profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ativo';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS aprovado_em TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS aprovado_por UUID REFERENCES public.profiles(id);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS motivo_reprovacao TEXT;

-- Expand imobiliarias table
ALTER TABLE public.imobiliarias ADD COLUMN IF NOT EXISTS nome_fantasia TEXT;
ALTER TABLE public.imobiliarias ADD COLUMN IF NOT EXISTS cargo TEXT;
ALTER TABLE public.imobiliarias ADD COLUMN IF NOT EXISTS cidade TEXT;
ALTER TABLE public.imobiliarias ADD COLUMN IF NOT EXISTS estado TEXT;

-- Expand corretores table
ALTER TABLE public.corretores ADD COLUMN IF NOT EXISTS cpf TEXT;
ALTER TABLE public.corretores ADD COLUMN IF NOT EXISTS creci TEXT;
ALTER TABLE public.corretores ADD COLUMN IF NOT EXISTS cidade TEXT;
ALTER TABLE public.corretores ADD COLUMN IF NOT EXISTS estado TEXT;
ALTER TABLE public.corretores ADD COLUMN IF NOT EXISTS vinculado_imobiliaria BOOLEAN DEFAULT false;

-- Create notifications table
CREATE TABLE IF NOT EXISTS public.notificacoes (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id),
    titulo TEXT NOT NULL,
    mensagem TEXT NOT NULL,
    lida BOOLEAN DEFAULT false,
    tipo TEXT, -- 'cadastro_pendente', 'aprovacao', 'geral'
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notificacoes TO authenticated;
GRANT SELECT ON public.notificacoes TO anon;
GRANT ALL ON public.notificacoes TO service_role;

-- Enable RLS
ALTER TABLE public.notificacoes ENABLE ROW LEVEL SECURITY;

-- Policies for notifications
CREATE POLICY "Users can view their own notifications"
ON public.notificacoes
FOR SELECT
USING (auth.uid() = user_id OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "System/Admins can create notifications"
ON public.notificacoes
FOR INSERT
WITH CHECK (true);

-- Update RLS for profiles to consider status
-- (Assuming existing policies might need adjustment or new ones added)
CREATE POLICY "Admins can view all profiles"
ON public.profiles
FOR SELECT
USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can update all profiles"
ON public.profiles
FOR UPDATE
USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');
