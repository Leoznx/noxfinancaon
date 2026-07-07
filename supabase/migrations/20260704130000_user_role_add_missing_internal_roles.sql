-- Os perfis de "Equipe NOX" (Jurídico, Marketing, Vendedor, Suporte, Admin Master) já
-- existem no frontend (AuthProvider.tsx Role/InternalRole, login.tsx INTERNAL_PROFILES,
-- ensure-demo-users demoUsers) mas nunca foram adicionados ao enum public.user_role.
-- Isso quebrava TODOS os botões de "entrar automaticamente" em /login: a Edge Function
-- ensure-demo-users tenta criar os 11 usuários demo em um único loop e retorna ok:false
-- se qualquer um falhar; como 'juridico'/'marketing'/'suporte'/'vendedor'/'admin_master'
-- não eram valores válidos do enum, a criação desses 5 sempre falhava com
-- "invalid input value for enum user_role", derrubando o ok:false geral e bloqueando
-- login.tsx:repairDemoUsers() mesmo para perfis que já funcionavam (ex.: Imobiliária).
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'admin_master';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'juridico';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'marketing';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'suporte';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'vendedor';
