-- Recompensas mensais configuraveis do portal vendedor.
-- A mesma tabela e consumida pelo site e pelo aplicativo. O progresso nao e
-- persistido: ele e calculado com os indicadores reais retornados por
-- get_my_seller_monthly_progress, evitando divergencia entre as superficies.

CREATE TABLE IF NOT EXISTS public.seller_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  year integer NOT NULL CHECK (year BETWEEN 2000 AND 9999),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  description text CHECK (description IS NULL OR char_length(description) <= 500),
  image_url text NOT NULL CHECK (
    char_length(image_url) <= 2048
    AND image_url ~* '^https?://'
  ),
  metric text NOT NULL CHECK (metric IN ('meetings', 'clients', 'contracts')),
  target integer NOT NULL CHECK (target > 0),
  active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seller_rewards_period
  ON public.seller_rewards(year, month, active, display_order, created_at);

COMMENT ON TABLE public.seller_rewards IS
  'Premiacoes mensais da equipe comercial, com progresso individual calculado a partir das metas reais.';
COMMENT ON COLUMN public.seller_rewards.image_url IS
  'URL HTTPS/HTTP da foto da recompensa informada pelo administrador.';
COMMENT ON COLUMN public.seller_rewards.metric IS
  'Indicador necessario para liberar a recompensa: meetings, clients ou contracts.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.seller_rewards TO authenticated;
GRANT ALL ON public.seller_rewards TO service_role;

ALTER TABLE public.seller_rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "seller_rewards read" ON public.seller_rewards;
CREATE POLICY "seller_rewards read"
  ON public.seller_rewards FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
    OR (
      active
      AND EXISTS (
        SELECT 1
        FROM public.internal_users AS internal_user
        WHERE internal_user.auth_user_id = auth.uid()
          AND internal_user.role = 'vendedor'
          AND internal_user.status = 'ativo'
      )
    )
  );

DROP POLICY IF EXISTS "seller_rewards admin write" ON public.seller_rewards;
CREATE POLICY "seller_rewards admin write"
  ON public.seller_rewards FOR ALL TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  );

DROP TRIGGER IF EXISTS trg_seller_rewards_updated ON public.seller_rewards;
CREATE TRIGGER trg_seller_rewards_updated
  BEFORE UPDATE ON public.seller_rewards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'seller_rewards'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.seller_rewards;
  END IF;
END;
$$;
