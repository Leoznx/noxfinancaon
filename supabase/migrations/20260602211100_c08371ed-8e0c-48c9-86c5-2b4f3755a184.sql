-- Drop the permissive policy
DROP POLICY "System/Admins can create notifications" ON public.notificacoes;

-- Create a more restricted one
CREATE POLICY "Admins can create notifications"
ON public.notificacoes
FOR INSERT
WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

-- Also allow the system (service_role) to bypass RLS, which it already does.
-- But for authenticated users, only admins can create.
