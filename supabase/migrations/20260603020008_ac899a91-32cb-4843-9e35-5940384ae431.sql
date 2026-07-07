-- Garantir que os perfis existam para os IDs dos usuários de autenticação
UPDATE public.profiles 
SET status = 'ativo' 
WHERE email IN ('admin@nox.com', 'corretor@nox.com', 'imobiliaria@nox.com', 'proprietario@nox.com');

INSERT INTO public.profiles (id, email, nome, role, status)
SELECT id, email, 
  CASE 
    WHEN email = 'admin@nox.com' THEN 'Administrador NOX'
    WHEN email = 'corretor@nox.com' THEN 'Carlos Corretor'
    WHEN email = 'imobiliaria@nox.com' THEN 'Vértice Imobiliária'
    WHEN email = 'proprietario@nox.com' THEN 'Maria Proprietária'
  END,
  (raw_user_meta_data->>'role')::user_role,
  'ativo'
FROM auth.users
WHERE email IN ('admin@nox.com', 'corretor@nox.com', 'imobiliaria@nox.com', 'proprietario@nox.com')
ON CONFLICT (id) DO UPDATE 
SET status = 'ativo', 
    role = EXCLUDED.role;
