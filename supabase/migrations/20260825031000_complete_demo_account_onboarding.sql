-- Contas demo não representam novos cadastros e nunca devem disparar a URL/pixel
-- de conversão do primeiro acesso antes de abrir o painel oficial.
UPDATE public.profiles
SET cadastro_concluido_em = COALESCE(cadastro_concluido_em, now()),
    updated_at = now()
WHERE lower(email) IN (
  'corretor@nox.com',
  'imobiliaria@nox.com',
  'proprietario@nox.com',
  'inquilino@nox.com'
);
