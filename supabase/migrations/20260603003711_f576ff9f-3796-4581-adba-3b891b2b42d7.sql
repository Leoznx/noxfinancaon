-- Add 'origem' to consultas_credito
ALTER TABLE public.consultas_credito ADD COLUMN IF NOT EXISTS origem TEXT DEFAULT 'painel_interno';

-- Create eventos_funil table
CREATE TABLE IF NOT EXISTS public.eventos_funil (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evento TEXT NOT NULL,
  metadata JSONB,
  origem TEXT,
  sessao_id TEXT,
  profile_id UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.eventos_funil ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert (public events)
CREATE POLICY "Anyone can insert funnel events" ON public.eventos_funil
FOR INSERT WITH CHECK (true);

-- Allow admins/analysts to read
CREATE POLICY "Admins can view funnel events" ON public.eventos_funil
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role IN ('admin', 'analista')
  )
);

-- Grants
GRANT INSERT ON public.eventos_funil TO anon, authenticated;
GRANT SELECT ON public.eventos_funil TO authenticated;
GRANT ALL ON public.eventos_funil TO service_role;
