-- Add profile_id to proprietarios
ALTER TABLE public.proprietarios ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Update RLS for proprietarios
ALTER TABLE public.proprietarios ENABLE ROW LEVEL SECURITY;

-- Policy for owners to see their own data
CREATE POLICY "Owners can view their own record" ON public.proprietarios
FOR SELECT USING (auth.uid() = profile_id);

-- Policy for admins/analysts to see all owners
CREATE POLICY "Admins can view all owners" ON public.proprietarios
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role IN ('admin', 'analista')
  )
);
