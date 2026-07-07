
-- =========================================================
-- 1) PADRONIZAÇÃO DOS STATUS DE CONSULTAS
-- =========================================================
UPDATE public.consultas_credito SET status = 'pendente' WHERE status IN ('em_analise', 'em análise');
UPDATE public.consultas_credito SET status = 'aprovado' WHERE status = 'aprovada';
UPDATE public.consultas_credito SET status = 'reprovado' WHERE status IN ('reprovada', 'recusada', 'recusado');

ALTER TABLE public.consultas_credito
  DROP CONSTRAINT IF EXISTS consultas_credito_status_check;
ALTER TABLE public.consultas_credito
  ADD CONSTRAINT consultas_credito_status_check
  CHECK (status IN ('aprovado', 'pendente', 'reprovado'));

ALTER TABLE public.consultas_credito ALTER COLUMN status SET DEFAULT 'pendente';


-- =========================================================
-- 2) CÓDIGO DE INDICAÇÃO EM PROFILES
-- =========================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referred_by_code text,
  ADD COLUMN IF NOT EXISTS referred_at timestamptz;

CREATE OR REPLACE FUNCTION public.generate_referral_code(_profile_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base text;
  v_code text;
  v_suffix text;
  v_attempt int := 0;
BEGIN
  SELECT regexp_replace(upper(coalesce(split_part(nome, ' ', 1), 'USER')), '[^A-Z0-9]', '', 'g')
    INTO v_base
  FROM public.profiles WHERE id = _profile_id;
  IF v_base IS NULL OR length(v_base) = 0 THEN v_base := 'USER'; END IF;
  v_base := substr(v_base, 1, 10);

  LOOP
    v_suffix := upper(substr(encode(gen_random_bytes(3), 'hex'), 1, 4));
    v_code := 'NOX-' || v_base || '-' || v_suffix;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = v_code) THEN
      RETURN v_code;
    END IF;
    v_attempt := v_attempt + 1;
    IF v_attempt > 10 THEN
      RETURN 'NOX-' || encode(gen_random_bytes(5), 'hex');
    END IF;
  END LOOP;
END;
$$;


-- =========================================================
-- 3) TABELA REFERRALS
-- =========================================================
CREATE TABLE public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referrer_role text,
  referred_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  referred_role text,
  referral_code text NOT NULL,
  referred_email text,
  referred_document text,
  referred_phone text,
  signup_at timestamptz DEFAULT now(),
  first_contract_id uuid REFERENCES public.apolices(id) ON DELETE SET NULL,
  first_contract_at timestamptz,
  reward_amount numeric(10,2) NOT NULL DEFAULT 50.00,
  reward_status text NOT NULL DEFAULT 'aguardando_contrato'
    CHECK (reward_status IN ('aguardando_contrato','consulta_iniciada','em_analise','liberada','paga','recusada','cancelada')),
  fraud_status text NOT NULL DEFAULT 'aprovado'
    CHECK (fraud_status IN ('aprovado','suspeito','bloqueado','em_analise')),
  fraud_reasons jsonb,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  rejected_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  rejected_at timestamptz,
  rejection_reason text,
  paid_at timestamptz,
  internal_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(referrer_user_id, referred_user_id)
);

GRANT SELECT, INSERT, UPDATE ON public.referrals TO authenticated;
GRANT ALL ON public.referrals TO service_role;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Indicador vê suas indicações" ON public.referrals
  FOR SELECT TO authenticated
  USING (referrer_user_id = auth.uid() OR referred_user_id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "Admin gerencia indicações" ON public.referrals
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Sistema/usuário insere indicação ao cadastrar" ON public.referrals
  FOR INSERT TO authenticated
  WITH CHECK (referred_user_id = auth.uid() OR public.is_admin(auth.uid()));

CREATE INDEX idx_referrals_referrer ON public.referrals(referrer_user_id);
CREATE INDEX idx_referrals_referred ON public.referrals(referred_user_id);
CREATE INDEX idx_referrals_reward_status ON public.referrals(reward_status);
CREATE INDEX idx_referrals_created_at ON public.referrals(created_at DESC);

CREATE TRIGGER trg_referrals_updated
BEFORE UPDATE ON public.referrals
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- =========================================================
-- 4) TABELA DE RECOMPENSAS DE INDICAÇÃO (financeiro)
-- =========================================================
CREATE TABLE public.referral_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referral_id uuid NOT NULL REFERENCES public.referrals(id) ON DELETE CASCADE,
  source_type text NOT NULL DEFAULT 'referral_reward',
  amount numeric(10,2) NOT NULL DEFAULT 50.00,
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','disponivel','paga','cancelada')),
  available_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.referral_rewards TO authenticated;
GRANT ALL ON public.referral_rewards TO service_role;
ALTER TABLE public.referral_rewards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuário vê suas recompensas" ON public.referral_rewards
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "Admin gerencia recompensas" ON public.referral_rewards
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE INDEX idx_referral_rewards_user ON public.referral_rewards(user_id);
CREATE INDEX idx_referral_rewards_status ON public.referral_rewards(status);

CREATE TRIGGER trg_referral_rewards_updated
BEFORE UPDATE ON public.referral_rewards
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- =========================================================
-- 5) PERMISSÕES ADMIN
-- =========================================================
INSERT INTO public.permissoes (chave, modulo, acao, descricao) VALUES
  ('indicacoes.view', 'indicacoes', 'view', 'Ver indicações'),
  ('indicacoes.approve', 'indicacoes', 'approve', 'Aprovar recompensa de indicação'),
  ('indicacoes.pay', 'indicacoes', 'pay', 'Pagar recompensa de indicação'),
  ('indicacoes.block', 'indicacoes', 'block', 'Bloquear indicação suspeita')
ON CONFLICT (chave) DO NOTHING;

INSERT INTO public.cargo_permissoes (cargo_id, permissao_id)
SELECT c.id, p.id
FROM public.cargos_admin c, public.permissoes p
WHERE c.chave = 'admin_master' AND p.chave LIKE 'indicacoes.%'
ON CONFLICT DO NOTHING;

INSERT INTO public.cargo_permissoes (cargo_id, permissao_id)
SELECT c.id, p.id
FROM public.cargos_admin c, public.permissoes p
WHERE c.chave = 'financeiro' AND p.chave IN ('indicacoes.view','indicacoes.pay')
ON CONFLICT DO NOTHING;
