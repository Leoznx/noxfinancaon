
CREATE OR REPLACE FUNCTION public.handle_apolice_referral()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_indicado_id uuid;
  v_referral RECORD;
  v_new_status text;
  v_reward_status text;
BEGIN
  IF NEW.status <> 'ativa' THEN RETURN NEW; END IF;

  -- O "indicado" é quem detém o contrato (corretor/imobiliária/proprietário)
  v_indicado_id := COALESCE(NEW.corretor_profile_id, NEW.imobiliaria_profile_id, NEW.proprietario_profile_id);
  IF v_indicado_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_referral
  FROM public.referrals
  WHERE referred_user_id = v_indicado_id
    AND first_contract_id IS NULL
    AND reward_status NOT IN ('paga','recusada','cancelada')
  ORDER BY created_at ASC
  LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Antifraude baixo => libera direto; senão vai para análise admin
  IF v_referral.fraud_status = 'aprovado' THEN
    v_new_status := 'liberada';
    v_reward_status := 'disponivel';
  ELSE
    v_new_status := 'em_analise';
    v_reward_status := 'pendente';
  END IF;

  UPDATE public.referrals
  SET first_contract_id = NEW.id,
      first_contract_at = now(),
      reward_status = v_new_status,
      approved_at = CASE WHEN v_new_status = 'liberada' THEN now() ELSE approved_at END
  WHERE id = v_referral.id;

  INSERT INTO public.referral_rewards (user_id, referral_id, amount, status, available_at)
  VALUES (
    v_referral.referrer_user_id,
    v_referral.id,
    v_referral.reward_amount,
    v_reward_status,
    CASE WHEN v_reward_status = 'disponivel' THEN now() ELSE NULL END
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apolice_referral ON public.apolices;
CREATE TRIGGER trg_apolice_referral
AFTER INSERT ON public.apolices
FOR EACH ROW EXECUTE FUNCTION public.handle_apolice_referral();
