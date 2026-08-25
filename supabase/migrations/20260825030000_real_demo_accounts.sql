-- As contas demonstrativas entram nas mesmas rotas, componentes e políticas das
-- contas reais. A única diferença é o conjunto de dados isolado usado na apresentação.
-- A função abaixo já é restrita ao service_role e é executada aqui pelo migrador.
SELECT public.ensure_nox_demo_auth_user(
  'corretor@nox.com',
  'nox12345',
  'João Corretor',
  'corretor'::public.user_role,
  '(47) 99999-1001'
);

SELECT public.ensure_nox_demo_auth_user(
  'imobiliaria@nox.com',
  'nox12345',
  'Imobiliária João & Cia',
  'imobiliaria'::public.user_role,
  '(47) 99999-1002'
);

SELECT public.ensure_nox_demo_auth_user(
  'proprietario@nox.com',
  'nox12345',
  'João Proprietário',
  'proprietario'::public.user_role,
  '(47) 99999-1003'
);

SELECT public.ensure_nox_demo_auth_user(
  'inquilino@nox.com',
  'nox12345',
  'João Inquilino',
  'inquilino'::public.user_role,
  '(47) 99999-1004'
);
