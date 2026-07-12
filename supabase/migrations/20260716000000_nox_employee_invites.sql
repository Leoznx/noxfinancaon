-- Convites de cadastro para a equipe interna NOX (vendedor/financeiro/
-- juridico/marketing) - gerados pelo admin em /admin/conta-nox, consumidos
-- nas rotas fixas /login/<cargo>nox. Reaproveita public.internal_role (ja
-- usado por internal_users/role_permissions) em vez de criar outro enum de
-- cargo, e a propria tabela public.internal_users como fonte de verdade do
-- cargo apos o cadastro - esta tabela guarda so o convite em si.
--
-- Nunca guarda o token puro (so o hash) e fica com RLS travada (nenhuma
-- policy pra authenticated/anon) - toda leitura/escrita passa por server
-- functions com a service role, que fazem a checagem de "e admin de
-- verdade" elas mesmas antes de tocar a tabela.
CREATE TABLE IF NOT EXISTS public.nox_employee_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role public.internal_role NOT NULL CHECK (role IN ('vendedor', 'financeiro', 'juridico', 'marketing')),
  token_hash text NOT NULL UNIQUE,
  employee_name text,
  invited_email text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_by uuid REFERENCES auth.users(id),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nox_employee_invites_created_by
  ON public.nox_employee_invites (created_by);

-- Nunca concede acesso direto a authenticated/anon - so service_role
-- (server functions) toca esta tabela.
GRANT ALL ON public.nox_employee_invites TO service_role;
ALTER TABLE public.nox_employee_invites ENABLE ROW LEVEL SECURITY;
