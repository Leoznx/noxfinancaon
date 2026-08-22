-- Corrige generate_commissions_for_policy em dois pontos:
--
-- 1) A base de cálculo da comissão (v_base_cents) usava só o valor do aluguel
--    (coalesce(q.valor_aluguel, q.rent_value, im.valor_aluguel, a.valor_premio)),
--    ignorando condomínio e taxas. Passa a somar aluguel + condomínio + taxas
--    (o "valor total" da locação), igual ao que já é usado em todo o resto do
--    app (calculateExpectedPayment, FormularioSimulacao, tela de finalizar
--    consulta) para compor o pacote locatício.
--
-- 2) A função nunca olhava planos.tem_comissao: gerava comissão pra
--    corretor/imobiliaria mesmo em planos "sem comissão" (NOX Fit/Fit+), só
--    usando o percentual do NÍVEL de parceria do próprio corretor/imobiliária
--    (niveis_perfil.percentual_comissao). Agora, quando o plano contratado tem
--    tem_comissao = false, a comissão de corretor/imobiliaria é pulada
--    (CONTINUE) — nenhuma linha é criada em comissoes para esses dois tipos.
--    proprietario não é afetado: o bônus dele (bonus_renovacao) é uma
--    estrutura própria, sem relação com o corretor ter escolhido um plano
--    "com" ou "sem" comissão embutida no prêmio.
--    Consultas legadas sem plano_id/planos vinculado continuam funcionando
--    como antes (coalesce(pl.tem_comissao, true) — nunca bloqueia por engano).

CREATE OR REPLACE FUNCTION public.generate_commissions_for_policy(
  p_policy_id uuid,
  p_event_key text DEFAULT NULL,
  p_notify boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $$
DECLARE
  v_policy record;
  v_beneficiary record;
  v_level record;
  v_active_contracts integer;
  v_base_cents bigint;
  v_amount_cents bigint;
  v_source text;
  v_commission_id uuid;
  v_created integer := 0;
BEGIN
  SELECT
    a.*,
    coalesce(q.valor_aluguel, q.rent_value, im.valor_aluguel, a.valor_premio, 0) AS aluguel_value,
    coalesce(im.valor_condominio, q.valor_condominio, 0) AS condominio_value,
    coalesce(im.valor_taxas, q.valor_taxas, 0) AS taxas_value,
    coalesce(pl.tem_comissao, true) AS plano_tem_comissao,
    q.profile_id_solicitante,
    lower(coalesce(q.role_solicitante, '')) AS requester_role,
    prop.profile_id AS property_owner_profile_id
  INTO v_policy
  FROM public.apolices a
  LEFT JOIN public.consultas_credito q ON q.id = a.consulta_id
  LEFT JOIN public.imoveis im ON im.id = q.imovel_id
  LEFT JOIN public.proprietarios prop ON prop.id = im.proprietario_id
  LEFT JOIN public.planos pl ON pl.id = q.plano_id
  WHERE a.id = p_policy_id
  FOR UPDATE OF a;

  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'POLICY_NOT_FOUND'); END IF;
  IF lower(v_policy.status) NOT IN ('ativa', 'active') THEN
    RETURN jsonb_build_object('ok', true, 'ignored', true, 'code', 'POLICY_NOT_ACTIVE');
  END IF;
  -- Valor total do pacote locatício (aluguel + condomínio + taxas) — base da
  -- comissão, não apenas o aluguel isolado.
  v_base_cents := round(
    (coalesce(v_policy.aluguel_value, 0) + coalesce(v_policy.condominio_value, 0) + coalesce(v_policy.taxas_value, 0))
    * 100
  )::bigint;
  IF v_base_cents <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_COMMISSION_BASE');
  END IF;

  FOR v_beneficiary IN
    SELECT * FROM (VALUES
      (
        coalesce(
          v_policy.corretor_profile_id,
          CASE WHEN v_policy.requester_role = 'corretor' THEN v_policy.profile_id_solicitante END
        ),
        'corretor'::text
      ),
      (
        coalesce(
          v_policy.imobiliaria_profile_id,
          CASE WHEN v_policy.requester_role = 'imobiliaria' THEN v_policy.profile_id_solicitante END
        ),
        'imobiliaria'::text
      ),
      (
        coalesce(v_policy.proprietario_profile_id, v_policy.property_owner_profile_id),
        'proprietario'::text
      )
    ) AS b(user_id, user_type)
    WHERE user_id IS NOT NULL
  LOOP
    -- Plano "sem comissão" (NOX Fit/Fit+): corretor e imobiliária não recebem
    -- comissão sobre esse contrato. O bônus do proprietário não depende disso.
    IF v_beneficiary.user_type IN ('corretor', 'imobiliaria') AND NOT v_policy.plano_tem_comissao THEN
      CONTINUE;
    END IF;

    SELECT count(*)::integer INTO v_active_contracts
    FROM public.apolices a
    LEFT JOIN public.consultas_credito q ON q.id = a.consulta_id
    LEFT JOIN public.imoveis im ON im.id = q.imovel_id
    LEFT JOIN public.proprietarios prop ON prop.id = im.proprietario_id
    WHERE lower(a.status) IN ('ativa', 'active')
      AND CASE v_beneficiary.user_type
        WHEN 'corretor' THEN (
          a.corretor_profile_id = v_beneficiary.user_id
          OR (q.profile_id_solicitante = v_beneficiary.user_id AND lower(q.role_solicitante) = 'corretor')
        )
        WHEN 'imobiliaria' THEN (
          a.imobiliaria_profile_id = v_beneficiary.user_id
          OR (q.profile_id_solicitante = v_beneficiary.user_id AND lower(q.role_solicitante) = 'imobiliaria')
        )
        ELSE (
          a.proprietario_profile_id = v_beneficiary.user_id OR prop.profile_id = v_beneficiary.user_id
        )
      END;

    SELECT * INTO v_level
    FROM public.niveis_perfil n
    WHERE n.tipo_perfil = v_beneficiary.user_type
      AND n.ativo
      AND n.min_contratos <= v_active_contracts
      AND (n.max_contratos IS NULL OR n.max_contratos >= v_active_contracts)
    ORDER BY n.ordem DESC LIMIT 1;
    IF NOT FOUND OR coalesce(v_level.percentual_comissao, 0) <= 0 THEN CONTINUE; END IF;

    v_amount_cents := round(v_base_cents * v_level.percentual_comissao / 100)::bigint;
    IF v_beneficiary.user_type = 'proprietario' THEN
      v_amount_cents := v_amount_cents + round(coalesce(v_level.bonus_renovacao, 0) * 100)::bigint;
    END IF;
    IF v_amount_cents <= 0 THEN CONTINUE; END IF;

    v_source := coalesce(nullif(trim(p_event_key), ''), 'POLICY_ACTIVATED:' || p_policy_id::text)
      || ':' || v_beneficiary.user_type || ':' || v_beneficiary.user_id::text;
    v_commission_id := NULL;

    INSERT INTO public.comissoes (
      beneficiario_id, beneficiario_tipo, contrato_id, valor,
      percentual_aplicado, nivel_aplicado, tipo_comissao, status,
      base_amount_cents, amount_cents, source_event_key, observacoes,
      created_at, updated_at
    ) VALUES (
      v_beneficiary.user_id, v_beneficiary.user_type, p_policy_id,
      v_amount_cents::numeric / 100, v_level.percentual_comissao,
      v_level.nome_nivel, 'contrato_novo', 'PENDING',
      v_base_cents, v_amount_cents, v_source,
      'Gerada pelo evento válido de ativação da apólice.', now(), now()
    )
    ON CONFLICT (source_event_key) DO NOTHING
    RETURNING id INTO v_commission_id;

    IF v_commission_id IS NOT NULL THEN
      v_created := v_created + 1;
      INSERT INTO public.commission_financial_ledger (
        user_id, commission_id, contract_id, entry_type,
        amount_cents, idempotency_key, metadata
      ) VALUES (
        v_beneficiary.user_id, v_commission_id, p_policy_id,
        'COMMISSION_CREATED', v_amount_cents,
        'commission:' || v_commission_id::text || ':created',
        jsonb_build_object(
          'base_amount_cents', v_base_cents,
          'percentage_applied', v_level.percentual_comissao,
          'level_applied', v_level.nome_nivel,
          'source_event_key', v_source
        )
      ) ON CONFLICT (idempotency_key) DO NOTHING;

      PERFORM private.add_financial_audit(
        NULL, 'COMMISSION_CREATED', NULL, v_commission_id, p_policy_id,
        NULL, 'PENDING', v_amount_cents,
        jsonb_build_object(
          'base_amount_cents', v_base_cents,
          'percentage_applied', v_level.percentual_comissao,
          'level_applied', v_level.nome_nivel,
          'source_event_key', v_source
        )
      );
      IF p_notify THEN
        PERFORM private.notify_user(
          v_beneficiary.user_id,
          'Nova comissão registrada',
          'Uma comissão de R$ ' || to_char(v_amount_cents::numeric / 100, 'FM999999990D00') ||
            ' foi registrada e aguarda a primeira mensalidade.',
          'nova_comissao', '/minhas-comissoes', 'wallet', 'yellow'
        );
      END IF;
    END IF;

    PERFORM private.refresh_active_contract_count(v_beneficiary.user_id);
  END LOOP;

  IF private.has_qualifying_first_payment(p_policy_id) THEN
    PERFORM public.release_commissions_for_contract(
      p_policy_id,
      'policy:' || p_policy_id::text || ':existing-first-payment',
      p_notify
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'created_count', v_created, 'policy_id', p_policy_id);
END;
$$;
REVOKE ALL ON FUNCTION public.generate_commissions_for_policy(uuid,text,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_commissions_for_policy(uuid,text,boolean) TO service_role;
