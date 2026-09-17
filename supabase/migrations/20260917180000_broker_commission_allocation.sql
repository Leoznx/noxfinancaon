-- Regra financeira por corretor vinculada à imobiliária.
--
-- A escolha é feita no vínculo e vale para contratos novos. Cada apólice
-- captura uma fotografia imutável da regra, do corretor e da imobiliária para
-- que alterações futuras não reescrevam o histórico financeiro.

ALTER TABLE public.corretores
  ADD COLUMN IF NOT EXISTS commission_allocation_mode text NOT NULL DEFAULT 'broker_full',
  ADD COLUMN IF NOT EXISTS commission_allocation_updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS commission_allocation_updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.corretores
  DROP CONSTRAINT IF EXISTS corretores_commission_allocation_mode_check;
ALTER TABLE public.corretores
  ADD CONSTRAINT corretores_commission_allocation_mode_check
  CHECK (commission_allocation_mode IN ('broker_full', 'split_50', 'agency_full'));

ALTER TABLE public.apolices
  ADD COLUMN IF NOT EXISTS commission_origin_broker_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS commission_origin_agency_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS commission_allocation_mode_snapshot text,
  ADD COLUMN IF NOT EXISTS commission_allocation_captured_at timestamptz;

ALTER TABLE public.apolices
  DROP CONSTRAINT IF EXISTS apolices_commission_allocation_snapshot_check;
ALTER TABLE public.apolices
  ADD CONSTRAINT apolices_commission_allocation_snapshot_check
  CHECK (
    commission_allocation_mode_snapshot IS NULL
    OR commission_allocation_mode_snapshot IN ('broker_full', 'split_50', 'agency_full')
  );

ALTER TABLE public.comissoes
  ADD COLUMN IF NOT EXISTS allocation_mode text,
  ADD COLUMN IF NOT EXISTS allocation_share_bps integer,
  ADD COLUMN IF NOT EXISTS origin_broker_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS origin_agency_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.comissoes
  DROP CONSTRAINT IF EXISTS comissoes_allocation_mode_check,
  DROP CONSTRAINT IF EXISTS comissoes_allocation_share_bps_check;
ALTER TABLE public.comissoes
  ADD CONSTRAINT comissoes_allocation_mode_check CHECK (
    allocation_mode IS NULL OR allocation_mode IN ('broker_full', 'split_50', 'agency_full', 'direct')
  ),
  ADD CONSTRAINT comissoes_allocation_share_bps_check CHECK (
    allocation_share_bps IS NULL OR allocation_share_bps BETWEEN 1 AND 10000
  );

CREATE INDEX IF NOT EXISTS corretores_imobiliaria_commission_mode_idx
  ON public.corretores(imobiliaria_id, commission_allocation_mode)
  WHERE imobiliaria_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS apolices_commission_origin_broker_idx
  ON public.apolices(commission_origin_broker_profile_id)
  WHERE commission_origin_broker_profile_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.capture_policy_commission_allocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $$
DECLARE
  v_requester_id uuid;
  v_requester_role text;
  v_broker_id uuid;
  v_agency_id uuid;
  v_mode text;
BEGIN
  -- Uma fotografia já capturada nunca é recalculada.
  IF NEW.commission_origin_broker_profile_id IS NOT NULL
     AND NEW.commission_allocation_mode_snapshot IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT q.profile_id_solicitante, lower(coalesce(q.role_solicitante, ''))
    INTO v_requester_id, v_requester_role
  FROM public.consultas_credito q
  WHERE q.id = NEW.consulta_id;

  v_broker_id := coalesce(
    NEW.corretor_profile_id,
    CASE WHEN v_requester_role = 'corretor' THEN v_requester_id END
  );

  IF v_broker_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.commission_allocation_mode, agency_profile.id
    INTO v_mode, v_agency_id
  FROM public.corretores c
  LEFT JOIN public.imobiliarias i ON i.id = c.imobiliaria_id
  LEFT JOIN public.profiles agency_profile
    ON lower(agency_profile.email) = lower(i.contato_email)
   AND agency_profile.role::text = 'imobiliaria'
  WHERE c.profile_id = v_broker_id
    AND c.imobiliaria_id IS NOT NULL
    AND coalesce(c.vinculado_imobiliaria, true)
  ORDER BY agency_profile.created_at DESC NULLS LAST
  LIMIT 1;

  v_mode := coalesce(v_mode, 'broker_full');
  -- Não permite perder comissão por um vínculo legado sem conta de imobiliária.
  IF v_agency_id IS NULL AND v_mode IN ('split_50', 'agency_full') THEN
    v_mode := 'broker_full';
  END IF;

  NEW.commission_origin_broker_profile_id := v_broker_id;
  NEW.commission_origin_agency_profile_id := v_agency_id;
  NEW.commission_allocation_mode_snapshot := v_mode;
  NEW.commission_allocation_captured_at := coalesce(NEW.commission_allocation_captured_at, now());
  NEW.corretor_profile_id := coalesce(NEW.corretor_profile_id, v_broker_id);
  NEW.imobiliaria_profile_id := coalesce(NEW.imobiliaria_profile_id, v_agency_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS capture_policy_commission_allocation ON public.apolices;
CREATE TRIGGER capture_policy_commission_allocation
  BEFORE INSERT OR UPDATE OF status, consulta_id, corretor_profile_id, imobiliaria_profile_id
  ON public.apolices
  FOR EACH ROW EXECUTE FUNCTION private.capture_policy_commission_allocation();

CREATE OR REPLACE FUNCTION public.link_my_corretor(
  p_corretor_id uuid,
  p_commission_allocation_mode text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_imobiliaria_id uuid;
  v_linked_imobiliaria_id uuid;
  v_status text;
  v_mode text := lower(trim(coalesce(p_commission_allocation_mode, '')));
BEGIN
  IF v_mode NOT IN ('broker_full', 'split_50', 'agency_full') THEN
    RAISE EXCEPTION 'Escolha como a comissão será repassada antes de vincular o corretor.';
  END IF;

  v_imobiliaria_id := public.current_imobiliaria_id();
  IF v_imobiliaria_id IS NULL THEN
    RAISE EXCEPTION 'Não foi possível identificar a imobiliária vinculada à sua conta.';
  END IF;

  SELECT corretor.imobiliaria_id, profile.status
    INTO v_linked_imobiliaria_id, v_status
  FROM public.corretores AS corretor
  JOIN public.profiles AS profile ON profile.id = corretor.profile_id
  WHERE corretor.id = p_corretor_id
    AND profile.role::text = 'corretor'
  FOR UPDATE OF corretor;

  IF NOT FOUND THEN RAISE EXCEPTION 'Corretor não encontrado.'; END IF;
  IF NOT public.is_corretor_linkable_status(v_status) THEN
    RAISE EXCEPTION 'Este corretor está bloqueado ou indisponível para vínculo.';
  END IF;

  IF v_linked_imobiliaria_id IS NOT NULL
     AND v_linked_imobiliaria_id <> v_imobiliaria_id THEN
    IF public.is_my_imobiliaria(v_linked_imobiliaria_id) THEN
      v_imobiliaria_id := v_linked_imobiliaria_id;
    ELSIF public.has_registered_imobiliaria_owner(v_linked_imobiliaria_id) THEN
      RAISE EXCEPTION 'Este corretor já possui vínculo com outra imobiliária.';
    END IF;
  END IF;

  UPDATE public.corretores AS corretor
  SET imobiliaria_id = v_imobiliaria_id,
      vinculado_imobiliaria = true,
      commission_allocation_mode = v_mode,
      commission_allocation_updated_at = now(),
      commission_allocation_updated_by = auth.uid(),
      updated_at = now()
  WHERE corretor.id = p_corretor_id;

  RETURN p_corretor_id;
END;
$$;

-- Compatibilidade com clientes antigos durante a publicação coordenada.
CREATE OR REPLACE FUNCTION public.link_my_corretor(p_corretor_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.link_my_corretor(p_corretor_id, 'broker_full');
$$;

CREATE OR REPLACE FUNCTION public.update_my_corretor_commission_allocation(
  p_corretor_id uuid,
  p_commission_allocation_mode text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mode text := lower(trim(coalesce(p_commission_allocation_mode, '')));
  v_updated_id uuid;
BEGIN
  IF v_mode NOT IN ('broker_full', 'split_50', 'agency_full') THEN
    RAISE EXCEPTION 'Regra de comissão inválida.';
  END IF;

  UPDATE public.corretores c
  SET commission_allocation_mode = v_mode,
      commission_allocation_updated_at = now(),
      commission_allocation_updated_by = auth.uid(),
      updated_at = now()
  WHERE c.id = p_corretor_id
    AND c.imobiliaria_id IS NOT NULL
    AND public.is_my_imobiliaria(c.imobiliaria_id)
  RETURNING c.id INTO v_updated_id;

  IF v_updated_id IS NULL THEN
    RAISE EXCEPTION 'Este corretor não está vinculado à sua imobiliária.';
  END IF;
  RETURN v_mode;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_broker_commission_access()
RETURNS TABLE (
  commission_allocation_mode text,
  can_access_financial_modules boolean,
  agency_profile_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    coalesce(c.commission_allocation_mode, 'broker_full'),
    NOT (
      c.imobiliaria_id IS NOT NULL
      AND coalesce(c.vinculado_imobiliaria, true)
      AND c.commission_allocation_mode = 'agency_full'
    ),
    CASE
      WHEN c.imobiliaria_id IS NOT NULL AND coalesce(c.vinculado_imobiliaria, true)
        THEN public.imobiliaria_profile_id_do_corretor(auth.uid())
      ELSE NULL
    END
  FROM public.profiles p
  LEFT JOIN public.corretores c ON c.profile_id = p.id
  WHERE p.id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.link_my_corretor(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.link_my_corretor(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_my_corretor_commission_allocation(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_broker_commission_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_my_corretor(uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.link_my_corretor(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_my_corretor_commission_allocation(uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_broker_commission_access() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.record_policy_commission(
  p_policy_id uuid,
  p_beneficiary_id uuid,
  p_beneficiary_type text,
  p_base_cents bigint,
  p_amount_cents bigint,
  p_percentage numeric,
  p_level_name text,
  p_event_key text,
  p_notify boolean,
  p_allocation_mode text,
  p_allocation_share_bps integer,
  p_origin_broker_id uuid,
  p_origin_agency_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $$
DECLARE
  v_source text;
  v_commission_id uuid;
BEGIN
  IF p_beneficiary_id IS NULL OR coalesce(p_amount_cents, 0) <= 0 THEN RETURN false; END IF;
  v_source := coalesce(nullif(trim(p_event_key), ''), 'POLICY_ACTIVATED:' || p_policy_id::text)
    || ':' || p_beneficiary_type || ':' || p_beneficiary_id::text;

  INSERT INTO public.comissoes (
    beneficiario_id, beneficiario_tipo, contrato_id, valor,
    percentual_aplicado, nivel_aplicado, tipo_comissao, status,
    base_amount_cents, amount_cents, source_event_key, observacoes,
    allocation_mode, allocation_share_bps,
    origin_broker_profile_id, origin_agency_profile_id,
    created_at, updated_at
  ) VALUES (
    p_beneficiary_id, p_beneficiary_type, p_policy_id,
    p_amount_cents::numeric / 100, p_percentage,
    p_level_name, 'contrato_novo', 'PENDING',
    p_base_cents, p_amount_cents, v_source,
    'Gerada pelo evento válido de ativação da apólice.',
    p_allocation_mode, p_allocation_share_bps,
    p_origin_broker_id, p_origin_agency_id,
    now(), now()
  )
  ON CONFLICT (source_event_key) DO NOTHING
  RETURNING id INTO v_commission_id;

  IF v_commission_id IS NULL THEN RETURN false; END IF;

  INSERT INTO public.commission_financial_ledger (
    user_id, commission_id, contract_id, entry_type,
    amount_cents, idempotency_key, metadata
  ) VALUES (
    p_beneficiary_id, v_commission_id, p_policy_id,
    'COMMISSION_CREATED', p_amount_cents,
    'commission:' || v_commission_id::text || ':created',
    jsonb_build_object(
      'base_amount_cents', p_base_cents,
      'percentage_applied', p_percentage,
      'level_applied', p_level_name,
      'source_event_key', v_source,
      'allocation_mode', p_allocation_mode,
      'allocation_share_bps', p_allocation_share_bps,
      'origin_broker_profile_id', p_origin_broker_id,
      'origin_agency_profile_id', p_origin_agency_id
    )
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  PERFORM private.add_financial_audit(
    NULL, 'COMMISSION_CREATED', NULL, v_commission_id, p_policy_id,
    NULL, 'PENDING', p_amount_cents,
    jsonb_build_object(
      'base_amount_cents', p_base_cents,
      'percentage_applied', p_percentage,
      'level_applied', p_level_name,
      'source_event_key', v_source,
      'allocation_mode', p_allocation_mode,
      'allocation_share_bps', p_allocation_share_bps,
      'origin_broker_profile_id', p_origin_broker_id,
      'origin_agency_profile_id', p_origin_agency_id
    )
  );

  IF p_notify THEN
    PERFORM private.notify_user(
      p_beneficiary_id,
      'Nova comissão registrada',
      'Uma comissão de R$ ' || to_char(p_amount_cents::numeric / 100, 'FM999999990D00') ||
        ' foi registrada e aguarda a primeira mensalidade.',
      'nova_comissao', '/minhas-comissoes', 'wallet', 'yellow'
    );
  END IF;
  RETURN true;
END;
$$;

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
  v_level record;
  v_active_contracts integer;
  v_base_cents bigint;
  v_pool_cents bigint;
  v_broker_cents bigint;
  v_agency_cents bigint;
  v_broker_id uuid;
  v_agency_id uuid;
  v_owner_id uuid;
  v_mode text;
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

  v_base_cents := round(
    (coalesce(v_policy.aluguel_value, 0) + coalesce(v_policy.condominio_value, 0) + coalesce(v_policy.taxas_value, 0)) * 100
  )::bigint;
  IF v_base_cents <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_COMMISSION_BASE');
  END IF;

  v_broker_id := coalesce(
    v_policy.commission_origin_broker_profile_id,
    v_policy.corretor_profile_id,
    CASE WHEN v_policy.requester_role = 'corretor' THEN v_policy.profile_id_solicitante END
  );
  v_agency_id := coalesce(
    v_policy.commission_origin_agency_profile_id,
    v_policy.imobiliaria_profile_id,
    CASE WHEN v_policy.requester_role = 'imobiliaria' THEN v_policy.profile_id_solicitante END
  );
  v_owner_id := coalesce(v_policy.proprietario_profile_id, v_policy.property_owner_profile_id);
  v_mode := v_policy.commission_allocation_mode_snapshot;

  IF v_broker_id IS NOT NULL AND v_mode IS NULL THEN
    SELECT c.commission_allocation_mode, agency_profile.id
      INTO v_mode, v_agency_id
    FROM public.corretores c
    LEFT JOIN public.imobiliarias i ON i.id = c.imobiliaria_id
    LEFT JOIN public.profiles agency_profile
      ON lower(agency_profile.email) = lower(i.contato_email)
     AND agency_profile.role::text = 'imobiliaria'
    WHERE c.profile_id = v_broker_id
      AND c.imobiliaria_id IS NOT NULL
      AND coalesce(c.vinculado_imobiliaria, true)
    ORDER BY agency_profile.created_at DESC NULLS LAST
    LIMIT 1;
    v_mode := coalesce(v_mode, 'broker_full');
  END IF;
  IF v_agency_id IS NULL AND v_mode IN ('split_50', 'agency_full') THEN v_mode := 'broker_full'; END IF;

  -- Corretor vinculado gera um único bolo de comissão. A divisão nunca aumenta
  -- o total; em centavos ímpares a imobiliária recebe o centavo residual.
  IF v_policy.plano_tem_comissao AND v_broker_id IS NOT NULL THEN
    SELECT count(*)::integer INTO v_active_contracts
    FROM public.apolices a
    LEFT JOIN public.consultas_credito q ON q.id = a.consulta_id
    WHERE lower(a.status) IN ('ativa', 'active')
      AND (
        a.commission_origin_broker_profile_id = v_broker_id
        OR a.corretor_profile_id = v_broker_id
        OR (q.profile_id_solicitante = v_broker_id AND lower(q.role_solicitante) = 'corretor')
      );

    SELECT * INTO v_level
    FROM public.niveis_perfil n
    WHERE n.tipo_perfil = 'corretor'
      AND n.ativo
      AND n.min_contratos <= v_active_contracts
      AND (n.max_contratos IS NULL OR n.max_contratos >= v_active_contracts)
    ORDER BY n.ordem DESC LIMIT 1;

    IF FOUND AND coalesce(v_level.percentual_comissao, 0) > 0 THEN
      v_pool_cents := round(v_base_cents * v_level.percentual_comissao / 100)::bigint;
      IF v_mode = 'split_50' THEN
        v_broker_cents := v_pool_cents / 2;
        v_agency_cents := v_pool_cents - v_broker_cents;
      ELSIF v_mode = 'agency_full' THEN
        v_broker_cents := 0;
        v_agency_cents := v_pool_cents;
      ELSE
        v_mode := 'broker_full';
        v_broker_cents := v_pool_cents;
        v_agency_cents := 0;
      END IF;

      IF private.record_policy_commission(
        p_policy_id, v_broker_id, 'corretor', v_base_cents, v_broker_cents,
        round(v_level.percentual_comissao * CASE WHEN v_mode = 'split_50' THEN 0.5 ELSE 1 END, 2),
        v_level.nome_nivel, p_event_key, p_notify, v_mode,
        CASE WHEN v_mode = 'split_50' THEN 5000 ELSE 10000 END,
        v_broker_id, v_agency_id
      ) THEN v_created := v_created + 1; END IF;

      IF private.record_policy_commission(
        p_policy_id, v_agency_id, 'imobiliaria', v_base_cents, v_agency_cents,
        round(v_level.percentual_comissao * CASE WHEN v_mode = 'split_50' THEN 0.5 ELSE 1 END, 2),
        v_level.nome_nivel, p_event_key, p_notify, v_mode,
        CASE WHEN v_mode = 'split_50' THEN 5000 ELSE 10000 END,
        v_broker_id, v_agency_id
      ) THEN v_created := v_created + 1; END IF;
    END IF;
    PERFORM private.refresh_active_contract_count(v_broker_id);
    PERFORM private.refresh_active_contract_count(v_agency_id);

  -- Contrato direto da imobiliária, sem corretor, mantém a regra normal dela.
  ELSIF v_policy.plano_tem_comissao AND v_agency_id IS NOT NULL THEN
    SELECT count(*)::integer INTO v_active_contracts
    FROM public.apolices a
    LEFT JOIN public.consultas_credito q ON q.id = a.consulta_id
    WHERE lower(a.status) IN ('ativa', 'active')
      AND (
        a.imobiliaria_profile_id = v_agency_id
        OR (q.profile_id_solicitante = v_agency_id AND lower(q.role_solicitante) = 'imobiliaria')
      );
    SELECT * INTO v_level
    FROM public.niveis_perfil n
    WHERE n.tipo_perfil = 'imobiliaria' AND n.ativo
      AND n.min_contratos <= v_active_contracts
      AND (n.max_contratos IS NULL OR n.max_contratos >= v_active_contracts)
    ORDER BY n.ordem DESC LIMIT 1;
    IF FOUND AND coalesce(v_level.percentual_comissao, 0) > 0 THEN
      v_pool_cents := round(v_base_cents * v_level.percentual_comissao / 100)::bigint;
      IF private.record_policy_commission(
        p_policy_id, v_agency_id, 'imobiliaria', v_base_cents, v_pool_cents,
        v_level.percentual_comissao, v_level.nome_nivel, p_event_key, p_notify,
        'direct', 10000, NULL, v_agency_id
      ) THEN v_created := v_created + 1; END IF;
    END IF;
    PERFORM private.refresh_active_contract_count(v_agency_id);
  END IF;

  -- Bônus do proprietário permanece independente do plano e da divisão.
  IF v_owner_id IS NOT NULL THEN
    SELECT count(*)::integer INTO v_active_contracts
    FROM public.apolices a
    LEFT JOIN public.consultas_credito q ON q.id = a.consulta_id
    LEFT JOIN public.imoveis im ON im.id = q.imovel_id
    LEFT JOIN public.proprietarios prop ON prop.id = im.proprietario_id
    WHERE lower(a.status) IN ('ativa', 'active')
      AND (a.proprietario_profile_id = v_owner_id OR prop.profile_id = v_owner_id);
    SELECT * INTO v_level
    FROM public.niveis_perfil n
    WHERE n.tipo_perfil = 'proprietario' AND n.ativo
      AND n.min_contratos <= v_active_contracts
      AND (n.max_contratos IS NULL OR n.max_contratos >= v_active_contracts)
    ORDER BY n.ordem DESC LIMIT 1;
    IF FOUND AND coalesce(v_level.percentual_comissao, 0) > 0 THEN
      v_pool_cents := round(v_base_cents * v_level.percentual_comissao / 100)::bigint
        + round(coalesce(v_level.bonus_renovacao, 0) * 100)::bigint;
      IF private.record_policy_commission(
        p_policy_id, v_owner_id, 'proprietario', v_base_cents, v_pool_cents,
        v_level.percentual_comissao, v_level.nome_nivel, p_event_key, p_notify,
        'direct', 10000, NULL, NULL
      ) THEN v_created := v_created + 1; END IF;
    END IF;
    PERFORM private.refresh_active_contract_count(v_owner_id);
  END IF;

  IF private.has_qualifying_first_payment(p_policy_id) THEN
    PERFORM public.release_commissions_for_contract(
      p_policy_id, 'policy:' || p_policy_id::text || ':existing-first-payment', p_notify
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'created_count', v_created,
    'policy_id', p_policy_id,
    'allocation_mode', coalesce(v_mode, 'direct')
  );
END;
$$;

REVOKE ALL ON FUNCTION private.capture_policy_commission_allocation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.record_policy_commission(uuid,uuid,text,bigint,bigint,numeric,text,text,boolean,text,integer,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_commissions_for_policy(uuid,text,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_commissions_for_policy(uuid,text,boolean) TO service_role;

COMMENT ON COLUMN public.corretores.commission_allocation_mode IS
  'Destino da comissão de contratos novos: corretor integral, divisão 50/50 ou imobiliária integral.';
COMMENT ON COLUMN public.apolices.commission_allocation_mode_snapshot IS
  'Fotografia imutável da regra financeira vigente ao criar o contrato.';
COMMENT ON FUNCTION public.update_my_corretor_commission_allocation(uuid,text) IS
  'Permite à imobiliária alterar a regra de comissão do próprio corretor para contratos futuros.';

NOTIFY pgrst, 'reload schema';
