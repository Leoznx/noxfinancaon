-- Criar usuários demo caso não existam
-- Como não podemos manipular auth.users diretamente com facilidade via Data API sem service_role,
-- assumimos que eles já foram criados ou o Lovable lida com isso.
-- No entanto, garantiremos que os PROFILES estejam corretos.

DO $$
BEGIN
  -- Atualizar perfis demo para status ativo se existirem
  UPDATE public.profiles SET status = 'ativo' WHERE email IN ('admin@nox.com', 'corretor@nox.com', 'imobiliaria@nox.com', 'proprietario@nox.com');
END $$;
