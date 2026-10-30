-- Keep the authenticated consultation history fast for every supported role.
-- The clients request the newest 100 rows and narrow by these ownership keys;
-- matching indexes avoid sorting or scanning the whole shared table first.

CREATE INDEX IF NOT EXISTS idx_consultas_credito_updated_at_desc
  ON public.consultas_credito (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_consultas_credito_profile_updated_at
  ON public.consultas_credito (profile_id_solicitante, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_consultas_credito_tenant_user_updated_at
  ON public.consultas_credito (tenant_user_id, updated_at DESC)
  WHERE tenant_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_consultas_credito_tenant_email_updated_at
  ON public.consultas_credito (tenant_email, updated_at DESC)
  WHERE tenant_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_consultas_credito_orphan_role_updated_at
  ON public.consultas_credito (role_solicitante, updated_at DESC)
  WHERE profile_id_solicitante IS NULL;
