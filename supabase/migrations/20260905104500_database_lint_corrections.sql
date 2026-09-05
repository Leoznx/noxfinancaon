-- A mensalidade não possui updated_at. Using that column made the second-payment
-- reward trigger fail at runtime whenever it evaluated the monthly-installment
-- branch.
CREATE OR REPLACE FUNCTION public.refresh_seller_referral_reward_for_policy(p_policy_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_paid_at timestamptz;
  v_count integer := 0;
BEGIN
  SELECT min(paid_at)
  INTO v_paid_at
  FROM (
    SELECT coalesce(invoice.pago_em, invoice.updated_at, invoice.created_at) AS paid_at
    FROM public.faturas_inquilino AS invoice
    WHERE invoice.apolice_id = p_policy_id
      AND invoice.numero_parcela = 2
      AND lower(coalesce(invoice.status, '')) IN (
        'paid', 'pago', 'confirmed', 'received', 'paid_via_consolidated'
      )
    UNION ALL
    SELECT coalesce(monthly.data_pagamento, monthly.created_at) AS paid_at
    FROM public.mensalidades AS monthly
    WHERE monthly.apolice_id = p_policy_id
      AND monthly.numero_parcela = 2
      AND lower(coalesce(monthly.status, '')) IN ('paid', 'pago', 'confirmed', 'received')
  ) AS paid;

  IF v_paid_at IS NULL THEN
    RETURN 0;
  END IF;

  INSERT INTO public.seller_referral_rewards (
    invite_id,
    sdr_id,
    policy_id,
    second_installment_paid_at
  )
  SELECT invite.id, invite.sdr_id, policy.id, v_paid_at
  FROM public.apolices AS policy
  LEFT JOIN public.consultas_credito AS consultation
    ON consultation.id = policy.consulta_id
  JOIN public.seller_referral_invites AS invite
    ON invite.status = 'cadastrado'
   AND invite.referred_profile_id IN (
     policy.corretor_profile_id,
     policy.imobiliaria_profile_id,
     policy.proprietario_profile_id,
     consultation.profile_id_solicitante
   )
  WHERE policy.id = p_policy_id
  ON CONFLICT (invite_id, policy_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- These routines derive values from current time and/or call routines marked
-- VOLATILE. Marking them correctly avoids stale planner assumptions.
ALTER FUNCTION public.time_clock_day_summary(uuid, date) VOLATILE;
ALTER FUNCTION public.get_my_time_clock_dashboard(date, date) VOLATILE;
ALTER FUNCTION public.get_admin_time_clock_history(date, date, uuid) VOLATILE;
