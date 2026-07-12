-- Geração e liberação de comissões exclusivamente por eventos válidos do
-- backend. A integração Asaas continua apenas recebendo cobranças; esta camada
-- nunca cria transferências ou pagamentos Pix de saída.

CREATE TABLE IF NOT EXISTS public.commission_release_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  invoice_id uuid REFERENCES public.faturas_inquilino(id) ON DELETE SET NULL,
  legacy_installment_id uuid REFERENCES public.mensalidades(id) ON DELETE SET NULL,
  contract_id uuid NOT NULL REFERENCES public.apolices(id) ON DELETE RESTRICT,
  source text NOT NULL,
  status text NOT NULL CHECK (status IN ('PROCESSED', 'IGNORED')),
  released_commission_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.commission_release_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commission_release_events FROM anon, authenticated;
GRANT SELECT ON public.commission_release_events TO authenticated;
GRANT ALL ON public.commission_release_events TO service_role;
CREATE POLICY "Admins audit commission release events"
  ON public.commission_release_events FOR SELECT TO authenticated
  USING (public.can_audit_withdrawals(auth.uid()));

CREATE OR REPLACE FUNCTION private.refresh_active_contract_count(_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  UPDATE public.profiles p
  SET contratos_ativos_count = (
    SELECT count(*)
    FROM public.apolices a
    LEFT JOIN public.consultas_credito q ON q.id = a.consulta_id
    LEFT JOIN public.imoveis im ON im.id = q.imovel_id
    LEFT JOIN public.proprietarios prop ON prop.id = im.proprietario_id
    WHERE lower(a.status) IN ('ativa', 'active')
      AND (
        a.corretor_profile_id = _user_id
        OR a.imobiliaria_profile_id = _user_id
        OR a.proprietario_profile_id = _user_id
        OR q.profile_id_solicitante = _user_id
        OR prop.profile_id = _user_id
      )
  ), updated_at = now()
  WHERE p.id = _user_id
$$;
REVOKE ALL ON FUNCTION private.refresh_active_contract_count(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.has_qualifying_first_payment(_contract_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.faturas_inquilino f
    WHERE f.apolice_id = _contract_id
      AND f.numero_parcela = 1
      AND lower(f.status) IN ('paid', 'pago', 'received', 'paid_via_consolidated')
  ) OR EXISTS (
    SELECT 1
    FROM public.mensalidades m
    WHERE m.apolice_id = _contract_id
      AND coalesce(m.numero_parcela, 1) = 1
      AND lower(coalesce(m.status, '')) IN ('paid', 'pago', 'received')
  )
$$;
REVOKE ALL ON FUNCTION private.has_qualifying_first_payment(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.release_commissions_for_contract(
  p_contract_id uuid,
  p_event_key text,
  p_notify boolean DEFAULT true
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $$
DECLARE
  v_commission record;
  v_count integer := 0;
BEGIN
  IF nullif(trim(coalesce(p_event_key, '')), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='COMMISSION_RELEASE_EVENT_REQUIRED';
  END IF;
  IF NOT private.has_qualifying_first_payment(p_contract_id) THEN RETURN 0; END IF;

  FOR v_commission IN
    UPDATE public.comissoes
    SET
      status = 'AVAILABLE',
      disponivel_em = coalesce(disponivel_em, now()),
      released_at = coalesce(released_at, now()),
      release_event_id = p_event_key,
      updated_at = now()
    WHERE contrato_id = p_contract_id
      AND status = 'PENDING'
    RETURNING id, beneficiario_id, amount_cents, contrato_id
  LOOP
    v_count := v_count + 1;
    INSERT INTO public.commission_financial_ledger (
      user_id, commission_id, contract_id, entry_type,
      amount_cents, idempotency_key, metadata
    ) VALUES (
      v_commission.beneficiario_id,
      v_commission.id,
      v_commission.contrato_id,
      'COMMISSION_RELEASED',
      v_commission.amount_cents,
      'commission:' || v_commission.id::text || ':released',
      jsonb_build_object('event_key', p_event_key)
    ) ON CONFLICT (idempotency_key) DO NOTHING;

    PERFORM private.add_financial_audit(
      NULL, 'COMMISSION_RELEASED', NULL, v_commission.id, v_commission.contrato_id,
      'PENDING', 'AVAILABLE', v_commission.amount_cents,
      jsonb_build_object('event_key', p_event_key)
    );

    IF p_notify THEN
      PERFORM private.notify_user(
        v_commission.beneficiario_id,
        'Comissão disponível',
        'Uma comissão de R$ ' ||
          to_char(v_commission.amount_cents::numeric / 100, 'FM999999990D00') ||
          ' foi liberada para saque.',
        'nova_comissao', '/minhas-comissoes', 'wallet', 'emerald'
      );
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.release_commissions_for_contract(uuid,text,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_commissions_for_contract(uuid,text,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.release_commissions_for_invoice(
  p_invoice_id uuid,
  p_event_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $$
DECLARE
  v_invoice public.faturas_inquilino%ROWTYPE;
  v_event_key text;
  v_count integer := 0;
  v_existing public.commission_release_events%ROWTYPE;
  v_contract_id uuid;
BEGIN
  SELECT * INTO v_invoice
  FROM public.faturas_inquilino
  WHERE id = p_invoice_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'INVOICE_NOT_FOUND'); END IF;

  v_event_key := coalesce(nullif(trim(p_event_id), ''), 'invoice:' || v_invoice.id::text || ':first-paid');
  SELECT * INTO v_existing FROM public.commission_release_events WHERE event_key = v_event_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true, 'idempotent', true,
      'released_count', v_existing.released_commission_count,
      'status', v_existing.status
    );
  END IF;

  v_contract_id := v_invoice.apolice_id;
  IF v_contract_id IS NULL THEN
    SELECT a.id INTO v_contract_id
    FROM public.apolices a
    WHERE a.consulta_id = v_invoice.consulta_id
    ORDER BY a.created_at DESC LIMIT 1;
  END IF;
  IF v_contract_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CONTRACT_NOT_LINKED');
  END IF;

  IF v_invoice.numero_parcela <> 1 THEN
    INSERT INTO public.commission_release_events (
      event_key, invoice_id, contract_id, source, status, released_commission_count
    ) VALUES (
      v_event_key, v_invoice.id, v_contract_id,
      'FATURAS_INQUILINO', 'IGNORED', 0
    );
    RETURN jsonb_build_object('ok', true, 'ignored', true, 'released_count', 0);
  END IF;

  IF lower(v_invoice.status) NOT IN ('paid', 'pago', 'received', 'paid_via_consolidated') THEN
    RETURN jsonb_build_object('ok', true, 'ignored', true, 'released_count', 0);
  END IF;

  v_count := public.release_commissions_for_contract(v_contract_id, v_event_key, true);
  INSERT INTO public.commission_release_events (
    event_key, invoice_id, contract_id, source, status, released_commission_count
  ) VALUES (
    v_event_key, v_invoice.id, v_contract_id,
    'FATURAS_INQUILINO', 'PROCESSED', v_count
  );

  RETURN jsonb_build_object('ok', true, 'released_count', v_count, 'event_key', v_event_key);
EXCEPTION WHEN unique_violation THEN
  SELECT * INTO v_existing FROM public.commission_release_events WHERE event_key = v_event_key;
  RETURN jsonb_build_object(
    'ok', true, 'idempotent', true,
    'released_count', coalesce(v_existing.released_commission_count, 0),
    'status', v_existing.status
  );
END;
$$;
REVOKE ALL ON FUNCTION public.release_commissions_for_invoice(uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_commissions_for_invoice(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION private.release_commissions_for_legacy_installment(
  _installment_id uuid,
  _event_key text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $$
DECLARE v_m public.mensalidades%ROWTYPE; v_count integer := 0;
BEGIN
  SELECT * INTO v_m FROM public.mensalidades WHERE id = _installment_id FOR UPDATE;
  IF NOT FOUND OR coalesce(v_m.numero_parcela, 1) <> 1
     OR lower(coalesce(v_m.status, '')) NOT IN ('paid', 'pago', 'received') THEN
    RETURN 0;
  END IF;
  IF EXISTS (SELECT 1 FROM public.commission_release_events WHERE event_key = _event_key) THEN
    RETURN 0;
  END IF;
  v_count := public.release_commissions_for_contract(v_m.apolice_id, _event_key, true);
  INSERT INTO public.commission_release_events (
    event_key, legacy_installment_id, contract_id, source, status, released_commission_count
  ) VALUES (
    _event_key, v_m.id, v_m.apolice_id, 'MENSALIDADES_LEGACY', 'PROCESSED', v_count
  ) ON CONFLICT (event_key) DO NOTHING;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION private.release_commissions_for_legacy_installment(uuid,text)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Geração idempotente de comissões quando a apólice passa a ativa.
-- ---------------------------------------------------------------------------
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
    coalesce(q.valor_aluguel, q.rent_value, im.valor_aluguel, a.valor_premio) AS base_value,
    q.profile_id_solicitante,
    lower(coalesce(q.role_solicitante, '')) AS requester_role,
    prop.profile_id AS property_owner_profile_id
  INTO v_policy
  FROM public.apolices a
  LEFT JOIN public.consultas_credito q ON q.id = a.consulta_id
  LEFT JOIN public.imoveis im ON im.id = q.imovel_id
  LEFT JOIN public.proprietarios prop ON prop.id = im.proprietario_id
  WHERE a.id = p_policy_id
  FOR UPDATE OF a;

  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'POLICY_NOT_FOUND'); END IF;
  IF lower(v_policy.status) NOT IN ('ativa', 'active') THEN
    RETURN jsonb_build_object('ok', true, 'ignored', true, 'code', 'POLICY_NOT_ACTIVE');
  END IF;
  v_base_cents := round(coalesce(v_policy.base_value, 0) * 100)::bigint;
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

-- ---------------------------------------------------------------------------
-- Risco/estorno: antes do pagamento coloca em revisão; depois de PAID preserva
-- histórico e cria ajuste futuro, sem apagar saque ou comprovante.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.flag_contract_financial_risk(
  _contract_id uuid,
  _event_key text,
  _reason text,
  _reverse_unpaid boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions, pg_catalog
AS $$
DECLARE v_w record; v_count integer := 0; v_paid record;
BEGIN
  FOR v_w IN
    SELECT w.id, w.status, w.amount_cents
    FROM public.withdrawal_requests w
    WHERE EXISTS (
      SELECT 1 FROM public.withdrawal_commissions wc
      WHERE wc.withdrawal_id = w.id AND wc.contract_id = _contract_id AND wc.active
    )
      AND w.status IN ('PENDING_REVIEW','APPROVED','AWAITING_PAYMENT','MANUAL_REVIEW')
    FOR UPDATE OF w
  LOOP
    IF v_w.status <> 'MANUAL_REVIEW' THEN
      UPDATE public.withdrawal_requests
      SET status='MANUAL_REVIEW', requires_manual_review=true,
          internal_notes=concat_ws(E'\n', nullif(internal_notes,''), left(_reason, 500))
      WHERE id=v_w.id;
      UPDATE public.comissoes c
      SET status='MANUAL_REVIEW', updated_at=now()
      FROM public.withdrawal_commissions wc
      WHERE wc.withdrawal_id=v_w.id AND wc.commission_id=c.id AND wc.active
        AND c.status='RESERVED';
      PERFORM private.add_financial_audit(
        NULL, 'WITHDRAWAL_SENT_TO_MANUAL_REVIEW', v_w.id, NULL, _contract_id,
        v_w.status, 'MANUAL_REVIEW', v_w.amount_cents,
        jsonb_build_object('event_key', _event_key, 'reason', left(_reason, 300))
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;

  IF _reverse_unpaid THEN
    UPDATE public.comissoes
    SET status='REVERSED', reversed_at=now(), reversal_reason=left(_reason,500), updated_at=now()
    WHERE contrato_id=_contract_id AND status IN ('PENDING','AVAILABLE');
  ELSE
    UPDATE public.comissoes
    SET status='MANUAL_REVIEW', updated_at=now()
    WHERE contrato_id=_contract_id AND status='AVAILABLE';
  END IF;

  FOR v_paid IN
    SELECT c.id, c.beneficiario_id, c.amount_cents
    FROM public.comissoes c
    WHERE c.contrato_id=_contract_id AND c.status='PAID'
  LOOP
    INSERT INTO public.commission_financial_ledger (
      user_id, commission_id, contract_id, entry_type,
      amount_cents, idempotency_key, metadata
    ) VALUES (
      v_paid.beneficiario_id, v_paid.id, _contract_id,
      'ADJUSTMENT_REQUIRED', -v_paid.amount_cents,
      'commission:' || v_paid.id::text || ':risk:' || encode(digest(_event_key,'sha256'),'hex'),
      jsonb_build_object('event_key', _event_key, 'reason', left(_reason,300))
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END LOOP;

  IF v_count > 0 THEN
    PERFORM private.notify_withdrawal_staff(
      'Saque em revisão manual',
      'Um contrato vinculado a saque apresentou divergência: ' || left(_reason, 250),
      'saque_revisao', '/admin/financeiro'
    );
  END IF;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION private.flag_contract_financial_risk(uuid,text,text,boolean)
  FROM PUBLIC, anon, authenticated;

-- Triggers substituem o NOOP legado e fazem a ponte com faturas do Asaas.
CREATE OR REPLACE FUNCTION public.trigger_calcular_comissoes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $$
DECLARE
  v_requester uuid;
  v_property_owner uuid;
BEGIN
  IF lower(NEW.status) IN ('ativa','active')
     AND (TG_OP='INSERT' OR lower(coalesce(OLD.status,'')) NOT IN ('ativa','active')) THEN
    PERFORM public.generate_commissions_for_policy(
      NEW.id, 'POLICY_ACTIVATED:' || NEW.id::text, true
    );
  END IF;

  IF TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status
     AND lower(NEW.status) ~ 'cancel|estorn|refund|chargeback' THEN
    PERFORM private.flag_contract_financial_risk(
      NEW.id,
      'policy-status:' || NEW.id::text || ':' || lower(NEW.status),
      'Contrato alterado para ' || NEW.status || '.',
      true
    );
  END IF;

  PERFORM private.refresh_active_contract_count(NEW.corretor_profile_id);
  PERFORM private.refresh_active_contract_count(NEW.imobiliaria_profile_id);
  PERFORM private.refresh_active_contract_count(NEW.proprietario_profile_id);
  IF TG_OP='UPDATE' THEN
    PERFORM private.refresh_active_contract_count(OLD.corretor_profile_id);
    PERFORM private.refresh_active_contract_count(OLD.imobiliaria_profile_id);
    PERFORM private.refresh_active_contract_count(OLD.proprietario_profile_id);
  END IF;
  SELECT q.profile_id_solicitante, prop.profile_id
  INTO v_requester, v_property_owner
  FROM public.consultas_credito q
  LEFT JOIN public.imoveis im ON im.id = q.imovel_id
  LEFT JOIN public.proprietarios prop ON prop.id = im.proprietario_id
  WHERE q.id = NEW.consulta_id;
  PERFORM private.refresh_active_contract_count(v_requester);
  PERFORM private.refresh_active_contract_count(v_property_owner);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apolice_ativada_calcular_comissoes ON public.apolices;
CREATE TRIGGER apolice_ativada_calcular_comissoes
  AFTER INSERT OR UPDATE OF status, corretor_profile_id, imobiliaria_profile_id, proprietario_profile_id
  ON public.apolices
  FOR EACH ROW EXECUTE FUNCTION public.trigger_calcular_comissoes();

CREATE OR REPLACE FUNCTION private.on_financial_installment_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $$
DECLARE v_event text;
BEGIN
  IF TG_TABLE_NAME='faturas_inquilino' THEN
    IF NEW.numero_parcela=1
       AND lower(NEW.status) IN ('paid','pago','received','paid_via_consolidated')
       AND (TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
      v_event := 'invoice:' || NEW.id::text || ':first-paid';
      PERFORM public.release_commissions_for_invoice(NEW.id, v_event);
    ELSIF lower(NEW.status) IN ('overdue','vencido','refunded','chargeback','cancelled_after_consolidation')
       AND (TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status)
       AND NEW.apolice_id IS NOT NULL THEN
      PERFORM private.flag_contract_financial_risk(
        NEW.apolice_id,
        'invoice-risk:' || NEW.id::text || ':' || lower(NEW.status),
        'Parcela ' || NEW.numero_parcela::text || ' com status ' || NEW.status || '.',
        lower(NEW.status) IN ('refunded','chargeback')
      );
    END IF;
  ELSE
    IF coalesce(NEW.numero_parcela,1)=1
       AND lower(coalesce(NEW.status,'')) IN ('paid','pago','received')
       AND (TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
      v_event := 'legacy-installment:' || NEW.id::text || ':first-paid';
      PERFORM private.release_commissions_for_legacy_installment(NEW.id, v_event);
    ELSIF lower(coalesce(NEW.status,'')) IN ('overdue','atrasado','vencido','refunded','chargeback')
       AND (TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
      PERFORM private.flag_contract_financial_risk(
        NEW.apolice_id,
        'legacy-installment-risk:' || NEW.id::text || ':' || lower(NEW.status),
        'Mensalidade legada com status ' || NEW.status || '.',
        lower(NEW.status) IN ('refunded','chargeback')
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.on_financial_installment_status_change()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS mensalidade_paga_libera_comissao ON public.mensalidades;
DROP TRIGGER IF EXISTS external_commission_mensalidade_status ON public.mensalidades;
CREATE TRIGGER external_commission_mensalidade_status
  AFTER INSERT OR UPDATE OF status ON public.mensalidades
  FOR EACH ROW EXECUTE FUNCTION private.on_financial_installment_status_change();

DROP TRIGGER IF EXISTS external_commission_invoice_status ON public.faturas_inquilino;
CREATE TRIGGER external_commission_invoice_status
  AFTER INSERT OR UPDATE OF status ON public.faturas_inquilino
  FOR EACH ROW EXECUTE FUNCTION private.on_financial_installment_status_change();

-- Backfill idempotente das apólices já ativas. Evita notificações em massa na
-- implantação; somente novos eventos notificam em tempo real.
DO $$
DECLARE v_policy uuid;
BEGIN
  FOR v_policy IN
    SELECT id FROM public.apolices WHERE lower(status) IN ('ativa','active')
  LOOP
    PERFORM public.generate_commissions_for_policy(
      v_policy, 'POLICY_ACTIVATED:' || v_policy::text, false
    );
  END LOOP;
END $$;
