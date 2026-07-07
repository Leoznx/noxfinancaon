
-- 1) Add columns to seller_commissions
ALTER TABLE public.seller_commissions
  ADD COLUMN IF NOT EXISTS reserve_release_at timestamptz,
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS clawback_applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS clawback_reason text,
  ADD COLUMN IF NOT EXISTS apolice_id uuid REFERENCES public.apolices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mensalidade_id uuid REFERENCES public.mensalidades(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS seller_commissions_unique_contract
  ON public.seller_commissions(seller_id, contract_id, month, year)
  WHERE contract_id IS NOT NULL;

-- 2) Add bonus_bloqueado to seller_performance
ALTER TABLE public.seller_performance
  ADD COLUMN IF NOT EXISTS bonus_bloqueado boolean NOT NULL DEFAULT false;

-- 3) internal_audit_logs
CREATE TABLE IF NOT EXISTS public.internal_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  actor_role text,
  action text NOT NULL,
  table_name text,
  record_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.internal_audit_logs TO authenticated;
GRANT ALL ON public.internal_audit_logs TO service_role;
ALTER TABLE public.internal_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit insert internal" ON public.internal_audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_internal(auth.uid()));

CREATE POLICY "audit read admin_master" ON public.internal_audit_logs
  FOR SELECT TO authenticated
  USING (public.has_internal_role(auth.uid(), 'admin_master'::internal_role));

-- 4) Helper: get internal_users.id from auth uid
CREATE OR REPLACE FUNCTION public.internal_user_id(_uid uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT id FROM public.internal_users WHERE auth_user_id=_uid AND status='ativo' LIMIT 1;
$$;

-- 5) materializar_comissoes_vendedor(mes, ano)
CREATE OR REPLACE FUNCTION public.materializar_comissoes_vendedor(p_mes int DEFAULT NULL, p_ano int DEFAULT NULL)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_mes int := COALESCE(p_mes, EXTRACT(MONTH FROM now())::int);
  v_ano int := COALESCE(p_ano, EXTRACT(YEAR FROM now())::int);
  v_seller RECORD;
  v_count int;
  v_comissao numeric;
  v_bonus numeric;
  v_total numeric;
  v_processed int := 0;
  v_bonus_blocked boolean;
BEGIN
  -- Atualizar status de comissões existentes baseado em pagamentos
  -- Marcar elegivel quando 1ª parcela paga
  UPDATE public.seller_commissions sc
  SET status='elegivel',
      eligible_at = COALESCE(eligible_at, now()),
      mensalidade_id = m.id
  FROM public.mensalidades m
  WHERE sc.contract_id = m.apolice_id
    AND m.status='pago'
    AND m.numero_parcela = 1
    AND sc.status IN ('pendente','aguardando_primeira_parcela')
    AND sc.month = v_mes AND sc.year = v_ano;

  -- Para cada vendedor com comissões elegíveis no mês, recalcular totais
  FOR v_seller IN
    SELECT DISTINCT seller_id FROM public.seller_commissions
    WHERE month=v_mes AND year=v_ano AND status IN ('elegivel','retida','liberada_parcial','liberada_total')
  LOOP
    SELECT count(*) INTO v_count
    FROM public.seller_commissions
    WHERE seller_id=v_seller.seller_id AND month=v_mes AND year=v_ano
      AND status IN ('elegivel','retida','liberada_parcial','liberada_total');

    v_comissao := public.calcular_comissao_vendedor(v_count);

    -- Verificar bloqueio de bônus (cancelamento >20% no mês anterior)
    SELECT bonus_bloqueado INTO v_bonus_blocked
    FROM public.seller_performance
    WHERE seller_id=v_seller.seller_id
      AND (year=v_ano AND month=v_mes);
    v_bonus_blocked := COALESCE(v_bonus_blocked, false);

    v_bonus := CASE WHEN v_bonus_blocked THEN 0 ELSE public.calcular_bonus_vendedor(v_count) END;
    v_total := v_comissao + v_bonus;

    -- Upsert performance
    INSERT INTO public.seller_performance(seller_id, month, year, contracts_activated, commission_total, bonus_total, total_estimated_gain)
    VALUES (v_seller.seller_id, v_mes, v_ano, v_count, v_comissao, v_bonus, v_total)
    ON CONFLICT (seller_id, month, year) DO UPDATE SET
      contracts_activated = EXCLUDED.contracts_activated,
      commission_total = EXCLUDED.commission_total,
      bonus_total = EXCLUDED.bonus_total,
      total_estimated_gain = EXCLUDED.total_estimated_gain,
      updated_at = now();

    -- Aplicar reserva 15% + 85% liberado nas comissões elegíveis sem reserva ainda definida
    UPDATE public.seller_commissions
    SET commission_amount = (v_comissao / NULLIF(v_count,0)),
        bonus_amount = (v_bonus / NULLIF(v_count,0)),
        reserve_amount = ((v_comissao / NULLIF(v_count,0)) * 0.15),
        released_amount = ((v_comissao / NULLIF(v_count,0)) * 0.85),
        reserve_release_at = COALESCE(reserve_release_at, now() + interval '60 days'),
        clawback_until = COALESCE(clawback_until, now() + interval '90 days'),
        status = CASE WHEN status='elegivel' THEN 'retida' ELSE status END
    WHERE seller_id=v_seller.seller_id AND month=v_mes AND year=v_ano
      AND status IN ('elegivel','retida');

    v_processed := v_processed + 1;
  END LOOP;

  RETURN v_processed;
END $$;

-- 6) aplicar_clawback_vendedor()
CREATE OR REPLACE FUNCTION public.aplicar_clawback_vendedor()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_count int := 0;
  v_seller RECORD;
  v_total int; v_canceled int;
BEGIN
  -- Marcar comissões estornadas quando apólice cancelada dentro do clawback
  WITH cancel AS (
    UPDATE public.seller_commissions sc
    SET status='estornada',
        canceled_at = COALESCE(canceled_at, now()),
        clawback_applied_at = now(),
        clawback_reason = COALESCE(clawback_reason,'Cancelamento dentro do período de 90 dias'),
        released_amount = 0,
        reserve_amount = 0
    FROM public.apolices a
    WHERE sc.contract_id = a.id
      AND a.status = 'cancelada'
      AND sc.clawback_until IS NOT NULL
      AND sc.clawback_until > now() - interval '1 day'
      AND sc.status NOT IN ('estornada','cancelada')
    RETURNING sc.id
  )
  SELECT count(*) INTO v_count FROM cancel;

  -- Para cada vendedor, calcular taxa de cancelamento do mês corrente
  FOR v_seller IN
    SELECT DISTINCT seller_id, month, year FROM public.seller_commissions
    WHERE month = EXTRACT(MONTH FROM now())::int
      AND year = EXTRACT(YEAR FROM now())::int
  LOOP
    SELECT count(*) INTO v_total FROM public.seller_commissions
    WHERE seller_id=v_seller.seller_id AND month=v_seller.month AND year=v_seller.year;
    SELECT count(*) INTO v_canceled FROM public.seller_commissions
    WHERE seller_id=v_seller.seller_id AND month=v_seller.month AND year=v_seller.year AND status='estornada';

    IF v_total > 0 AND (v_canceled::numeric / v_total::numeric) > 0.20 THEN
      -- Bloquear bônus do próximo mês
      INSERT INTO public.seller_performance(seller_id, month, year, bonus_bloqueado)
      VALUES (
        v_seller.seller_id,
        CASE WHEN v_seller.month=12 THEN 1 ELSE v_seller.month+1 END,
        CASE WHEN v_seller.month=12 THEN v_seller.year+1 ELSE v_seller.year END,
        true
      )
      ON CONFLICT (seller_id, month, year) DO UPDATE SET bonus_bloqueado=true, updated_at=now();
    END IF;
  END LOOP;

  RETURN v_count;
END $$;

-- 7) liberar_reservas_vendedor()
CREATE OR REPLACE FUNCTION public.liberar_reservas_vendedor()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count int;
BEGIN
  WITH upd AS (
    UPDATE public.seller_commissions
    SET released_amount = released_amount + reserve_amount,
        reserve_amount = 0,
        status = 'liberada_total',
        released_at = COALESCE(released_at, now())
    WHERE reserve_release_at IS NOT NULL
      AND reserve_release_at <= now()
      AND status NOT IN ('estornada','cancelada','liberada_total')
      AND reserve_amount > 0
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN v_count;
END $$;

-- 8) Trigger em mensalidades: ao pagar a 1ª parcela, dispara materialização
CREATE OR REPLACE FUNCTION public.trg_materializar_comissao_on_pagamento()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status='pago' AND (OLD.status IS DISTINCT FROM 'pago') AND NEW.numero_parcela=1 THEN
    PERFORM public.materializar_comissoes_vendedor(
      EXTRACT(MONTH FROM now())::int,
      EXTRACT(YEAR FROM now())::int
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_materializar_comissao_vendedor ON public.mensalidades;
CREATE TRIGGER trg_materializar_comissao_vendedor
  AFTER UPDATE OF status ON public.mensalidades
  FOR EACH ROW EXECUTE FUNCTION public.trg_materializar_comissao_on_pagamento();

-- 9) Policies adicionais (aditivas)
-- Marketing pode ler leads
DROP POLICY IF EXISTS "leads marketing read" ON public.leads;
CREATE POLICY "leads marketing read" ON public.leads
  FOR SELECT TO authenticated
  USING (public.has_internal_role(auth.uid(),'marketing'::internal_role)
      OR public.has_internal_role(auth.uid(),'admin_master'::internal_role));

DROP POLICY IF EXISTS "leads marketing write" ON public.leads;
CREATE POLICY "leads marketing write" ON public.leads
  FOR UPDATE TO authenticated
  USING (public.has_internal_role(auth.uid(),'marketing'::internal_role)
      OR public.has_internal_role(auth.uid(),'admin_master'::internal_role))
  WITH CHECK (public.has_internal_role(auth.uid(),'marketing'::internal_role)
      OR public.has_internal_role(auth.uid(),'admin_master'::internal_role));

-- Financeiro pode aprovar saques
DROP POLICY IF EXISTS "saques financeiro" ON public.solicitacoes_saque;
CREATE POLICY "saques financeiro" ON public.solicitacoes_saque
  FOR ALL TO authenticated
  USING (public.has_internal_role(auth.uid(),'financeiro'::internal_role)
      OR public.has_internal_role(auth.uid(),'admin_master'::internal_role))
  WITH CHECK (public.has_internal_role(auth.uid(),'financeiro'::internal_role)
      OR public.has_internal_role(auth.uid(),'admin_master'::internal_role));

-- Jurídico pode atualizar consultas_credito
DROP POLICY IF EXISTS "consultas juridico write" ON public.consultas_credito;
CREATE POLICY "consultas juridico write" ON public.consultas_credito
  FOR UPDATE TO authenticated
  USING (public.has_internal_role(auth.uid(),'juridico'::internal_role)
      OR public.has_internal_role(auth.uid(),'admin_master'::internal_role))
  WITH CHECK (public.has_internal_role(auth.uid(),'juridico'::internal_role)
      OR public.has_internal_role(auth.uid(),'admin_master'::internal_role));

-- Seed default role_permissions matrix (idempotent)
INSERT INTO public.role_permissions (role, module, can_view, can_create, can_edit, can_delete, can_approve)
SELECT r::internal_role, m, true, true, true, true, true
FROM (VALUES ('admin_master')) roles(r),
     (VALUES ('aprovacoes'),('contratos'),('apolices'),('documentos'),('financeiro'),('faturamento'),('comissoes'),('saques'),('leads'),('campanhas'),('suporte'),('vendedores'),('materiais'),('colaboradores'),('configuracoes')) mods(m)
ON CONFLICT (role, module) DO NOTHING;

INSERT INTO public.role_permissions (role, module, can_view, can_edit, can_approve)
VALUES
  ('juridico','aprovacoes',true,true,true),
  ('juridico','contratos',true,false,false),
  ('juridico','apolices',true,false,false),
  ('juridico','documentos',true,true,false),
  ('financeiro','financeiro',true,true,true),
  ('financeiro','faturamento',true,true,false),
  ('financeiro','comissoes',true,true,true),
  ('financeiro','saques',true,true,true),
  ('marketing','leads',true,true,false),
  ('marketing','campanhas',true,true,false),
  ('marketing','materiais',true,true,false),
  ('suporte','suporte',true,true,false),
  ('vendedor','leads',true,true,false),
  ('vendedor','comissoes',true,false,false),
  ('vendedor','materiais',true,false,false)
ON CONFLICT (role, module) DO NOTHING;
