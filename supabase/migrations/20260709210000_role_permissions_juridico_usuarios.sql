-- juridicoItems tinha "Documentos" apontando pra /admin/usuarios (mesma rota
-- que suporteItems chamava de "Usuários") — na unificação em ADMIN_CATALOG
-- (DashboardLayout.tsx) essa rota virou um módulo único: "usuarios". Faltou
-- semear can_view=true pra juridico nesse módulo (a linha existente era em
-- "documentos", que continua servindo só a grade de ações/CRUD, não a
-- navegação) — sem isso, jurídico perdia acesso a essa aba que já tinha hoje.
INSERT INTO public.role_permissions (role, module, can_view)
VALUES ('juridico'::internal_role, 'usuarios', true)
ON CONFLICT (role, module) DO UPDATE SET can_view = true;
