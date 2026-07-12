-- Distribuicao automatica de leads comerciais entre vendedores NOX.
-- A tabela sales_leads ja existia; esta migracao adiciona a fila, historico,
-- follow-ups e uma RPC transacional para evitar lead duplicado no rodizio.

ALTER TABLE public.sales_leads
  ADD COLUMN IF NOT EXISTS distributed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_interaction_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_followup_at timestamptz;

CREATE TABLE IF NOT EXISTS public.lead_distribution_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendedor_id uuid NOT NULL UNIQUE REFERENCES public.internal_users(id) ON DELETE CASCADE,
  ativo boolean NOT NULL DEFAULT true,
  ordem integer NOT NULL DEFAULT 0,
  ultimo_recebimento timestamptz,
  total_leads_recebidos integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lead_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.sales_leads(id) ON DELETE CASCADE,
  vendedor_id uuid NOT NULL REFERENCES public.internal_users(id) ON DELETE CASCADE,
  data_followup timestamptz NOT NULL,
  status_followup text NOT NULL DEFAULT 'pendente',
  observacao text,
  realizado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lead_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.sales_leads(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  acao text NOT NULL,
  status_anterior text,
  status_novo text,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_distribution_queue_ordem_idx
  ON public.lead_distribution_queue(ativo, ordem);
CREATE INDEX IF NOT EXISTS lead_followups_lead_idx
  ON public.lead_followups(lead_id, data_followup);
CREATE INDEX IF NOT EXISTS lead_followups_vendedor_idx
  ON public.lead_followups(vendedor_id, status_followup, data_followup);
CREATE INDEX IF NOT EXISTS lead_history_lead_idx
  ON public.lead_history(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_leads_seller_status_idx
  ON public.sales_leads(assigned_seller_id, status, next_action_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_distribution_queue TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_followups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_history TO authenticated;
GRANT ALL ON public.lead_distribution_queue TO service_role;
GRANT ALL ON public.lead_followups TO service_role;
GRANT ALL ON public.lead_history TO service_role;

ALTER TABLE public.lead_distribution_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_history ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_manage_sales_leads(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_internal_role(_uid, 'admin_master')
    OR public.has_internal_role(_uid, 'marketing')
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = _uid
        AND p.role IN ('admin', 'analista', 'admin_master', 'marketing')
    );
$$;

CREATE OR REPLACE FUNCTION public.current_internal_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.internal_users
  WHERE auth_user_id = auth.uid()
    AND status = 'ativo'
  LIMIT 1;
$$;

DROP POLICY IF EXISTS "internal_users self read" ON public.internal_users;
CREATE POLICY "internal_users self read"
ON public.internal_users
FOR SELECT TO authenticated
USING (
  auth_user_id = auth.uid()
  OR public.has_internal_role(auth.uid(), 'admin_master')
  OR public.can_manage_sales_leads(auth.uid())
);

DROP POLICY IF EXISTS "lead_distribution_admin_read" ON public.lead_distribution_queue;
CREATE POLICY "lead_distribution_admin_read"
ON public.lead_distribution_queue
FOR SELECT TO authenticated
USING (public.can_manage_sales_leads(auth.uid()) OR vendedor_id = public.current_internal_user_id());

DROP POLICY IF EXISTS "lead_distribution_admin_write" ON public.lead_distribution_queue;
CREATE POLICY "lead_distribution_admin_write"
ON public.lead_distribution_queue
FOR ALL TO authenticated
USING (public.can_manage_sales_leads(auth.uid()))
WITH CHECK (public.can_manage_sales_leads(auth.uid()));

DROP POLICY IF EXISTS "lead_followups_admin_or_owner_read" ON public.lead_followups;
CREATE POLICY "lead_followups_admin_or_owner_read"
ON public.lead_followups
FOR SELECT TO authenticated
USING (public.can_manage_sales_leads(auth.uid()) OR vendedor_id = public.current_internal_user_id());

DROP POLICY IF EXISTS "lead_followups_admin_or_owner_write" ON public.lead_followups;
CREATE POLICY "lead_followups_admin_or_owner_write"
ON public.lead_followups
FOR ALL TO authenticated
USING (public.can_manage_sales_leads(auth.uid()) OR vendedor_id = public.current_internal_user_id())
WITH CHECK (public.can_manage_sales_leads(auth.uid()) OR vendedor_id = public.current_internal_user_id());

DROP POLICY IF EXISTS "lead_history_admin_or_owner_read" ON public.lead_history;
CREATE POLICY "lead_history_admin_or_owner_read"
ON public.lead_history
FOR SELECT TO authenticated
USING (
  public.can_manage_sales_leads(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.sales_leads l
    WHERE l.id = lead_history.lead_id
      AND l.assigned_seller_id = public.current_internal_user_id()
  )
);

DROP POLICY IF EXISTS "lead_history_admin_or_owner_insert" ON public.lead_history;
CREATE POLICY "lead_history_admin_or_owner_insert"
ON public.lead_history
FOR INSERT TO authenticated
WITH CHECK (
  public.can_manage_sales_leads(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.sales_leads l
    WHERE l.id = lead_history.lead_id
      AND l.assigned_seller_id = public.current_internal_user_id()
  )
);

DROP POLICY IF EXISTS "sales_leads seller read own" ON public.sales_leads;
CREATE POLICY "sales_leads seller read own"
ON public.sales_leads
FOR SELECT TO authenticated
USING (
  public.can_manage_sales_leads(auth.uid())
  OR assigned_seller_id = public.current_internal_user_id()
);

DROP POLICY IF EXISTS "sales_leads marketing/admin write" ON public.sales_leads;
CREATE POLICY "sales_leads marketing/admin write"
ON public.sales_leads
FOR ALL TO authenticated
USING (
  public.can_manage_sales_leads(auth.uid())
  OR assigned_seller_id = public.current_internal_user_id()
)
WITH CHECK (
  public.can_manage_sales_leads(auth.uid())
  OR assigned_seller_id = public.current_internal_user_id()
);

CREATE OR REPLACE FUNCTION public.sync_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_distribution_queue_upd ON public.lead_distribution_queue;
CREATE TRIGGER trg_lead_distribution_queue_upd
BEFORE UPDATE ON public.lead_distribution_queue
FOR EACH ROW EXECUTE FUNCTION public.sync_updated_at();

DROP TRIGGER IF EXISTS trg_lead_followups_upd ON public.lead_followups;
CREATE TRIGGER trg_lead_followups_upd
BEFORE UPDATE ON public.lead_followups
FOR EACH ROW EXECUTE FUNCTION public.sync_updated_at();

CREATE OR REPLACE FUNCTION public.sincronizar_fila_vendedores_leads()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.lead_distribution_queue (vendedor_id, ativo, ordem)
  SELECT
    u.id,
    true,
    COALESCE((SELECT MAX(ordem) FROM public.lead_distribution_queue), 0)
      + ROW_NUMBER() OVER (ORDER BY u.created_at, u.full_name)
  FROM public.internal_users u
  WHERE u.role = 'vendedor'
    AND u.status = 'ativo'
    AND NOT EXISTS (
      SELECT 1
      FROM public.lead_distribution_queue q
      WHERE q.vendedor_id = u.id
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.distribuir_sales_lead(
  p_full_name text,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_origin text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_type text DEFAULT NULL,
  p_interest text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public.sales_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queue public.lead_distribution_queue%ROWTYPE;
  v_lead public.sales_leads%ROWTYPE;
  v_auth_user uuid;
BEGIN
  IF NOT public.can_manage_sales_leads(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao para distribuir leads';
  END IF;

  IF NULLIF(trim(p_full_name), '') IS NULL THEN
    RAISE EXCEPTION 'Nome do lead e obrigatorio';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('nox_sales_lead_distribution'));
  PERFORM public.sincronizar_fila_vendedores_leads();

  SELECT q.*
  INTO v_queue
  FROM public.lead_distribution_queue q
  JOIN public.internal_users u ON u.id = q.vendedor_id
  WHERE q.ativo = true
    AND u.role = 'vendedor'
    AND u.status = 'ativo'
  ORDER BY COALESCE(q.ultimo_recebimento, '1970-01-01'::timestamptz), q.ordem, q.created_at
  LIMIT 1
  FOR UPDATE OF q;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nenhum vendedor ativo na fila de distribuicao';
  END IF;

  INSERT INTO public.sales_leads (
    assigned_seller_id,
    full_name,
    phone,
    email,
    origin,
    city,
    type,
    interest,
    status,
    notes,
    distributed_at,
    last_interaction_at
  )
  VALUES (
    v_queue.vendedor_id,
    trim(p_full_name),
    NULLIF(trim(COALESCE(p_phone, '')), ''),
    NULLIF(trim(COALESCE(p_email, '')), ''),
    NULLIF(trim(COALESCE(p_origin, '')), ''),
    NULLIF(trim(COALESCE(p_city, '')), ''),
    NULLIF(trim(COALESCE(p_type, '')), ''),
    NULLIF(trim(COALESCE(p_interest, '')), ''),
    'pendente',
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    now(),
    now()
  )
  RETURNING * INTO v_lead;

  UPDATE public.lead_distribution_queue
  SET ultimo_recebimento = now(),
      total_leads_recebidos = total_leads_recebidos + 1
  WHERE id = v_queue.id;

  INSERT INTO public.lead_history (lead_id, user_id, acao, status_novo, observacao)
  VALUES (v_lead.id, auth.uid(), 'lead_distribuido', 'pendente', 'Lead distribuido automaticamente pelo rodizio.');

  SELECT auth_user_id
  INTO v_auth_user
  FROM public.internal_users
  WHERE id = v_queue.vendedor_id;

  IF v_auth_user IS NOT NULL THEN
    INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, cor_destaque, link)
    VALUES (
      v_auth_user,
      'Novo lead recebido',
      'Voce recebeu um novo lead: ' || v_lead.full_name,
      'lead_novo',
      'amarelo',
      '/vendedor/leads'
    );
  END IF;

  RETURN v_lead;
END;
$$;

CREATE OR REPLACE FUNCTION public.preparar_sales_lead_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.last_interaction_at = now();
    IF NEW.status = 'em_atendimento' AND NEW.next_action_at IS NULL THEN
      NEW.next_action_at = now() + interval '2 days';
    ELSIF NEW.status = 'atendido' THEN
      NEW.next_action_at = NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_sales_lead_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.lead_history (lead_id, user_id, acao, status_anterior, status_novo, observacao)
    VALUES (NEW.id, auth.uid(), 'status_alterado', OLD.status, NEW.status, NEW.notes);

    IF NEW.status = 'em_atendimento' THEN
      INSERT INTO public.lead_followups (lead_id, vendedor_id, data_followup, status_followup, observacao)
      SELECT NEW.id, NEW.assigned_seller_id, NEW.next_action_at, 'pendente', 'Follow-up automatico em 2 dias.'
      WHERE NEW.assigned_seller_id IS NOT NULL
        AND NEW.next_action_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.lead_followups f
          WHERE f.lead_id = NEW.id
            AND f.status_followup = 'pendente'
            AND f.data_followup = NEW.next_action_at
        );
    ELSIF NEW.status = 'atendido' THEN
      UPDATE public.lead_followups
      SET status_followup = 'concluido',
          realizado_em = COALESCE(realizado_em, now())
      WHERE lead_id = NEW.id
        AND status_followup = 'pendente';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_preparar_sales_lead_status ON public.sales_leads;
CREATE TRIGGER trg_preparar_sales_lead_status
BEFORE UPDATE OF status ON public.sales_leads
FOR EACH ROW EXECUTE FUNCTION public.preparar_sales_lead_status();

DROP TRIGGER IF EXISTS trg_registrar_sales_lead_status ON public.sales_leads;
CREATE TRIGGER trg_registrar_sales_lead_status
AFTER UPDATE OF status ON public.sales_leads
FOR EACH ROW EXECUTE FUNCTION public.registrar_sales_lead_status();

CREATE OR REPLACE FUNCTION public.registrar_lead_followup(
  p_lead_id uuid,
  p_observacao text DEFAULT NULL,
  p_reagendar_para timestamptz DEFAULT NULL,
  p_concluir boolean DEFAULT false
)
RETURNS public.sales_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead public.sales_leads%ROWTYPE;
  v_next timestamptz;
BEGIN
  SELECT *
  INTO v_lead
  FROM public.sales_leads
  WHERE id = p_lead_id
    AND (
      public.can_manage_sales_leads(auth.uid())
      OR assigned_seller_id = public.current_internal_user_id()
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead nao encontrado ou sem permissao';
  END IF;

  UPDATE public.lead_followups
  SET status_followup = 'realizado',
      observacao = COALESCE(NULLIF(trim(COALESCE(p_observacao, '')), ''), observacao),
      realizado_em = now()
  WHERE lead_id = p_lead_id
    AND status_followup = 'pendente'
    AND (v_lead.assigned_seller_id IS NULL OR vendedor_id = v_lead.assigned_seller_id);

  INSERT INTO public.lead_history (lead_id, user_id, acao, status_anterior, status_novo, observacao)
  VALUES (p_lead_id, auth.uid(), 'followup_registrado', v_lead.status, CASE WHEN p_concluir THEN 'atendido' ELSE 'em_atendimento' END, p_observacao);

  IF p_concluir THEN
    UPDATE public.sales_leads
    SET status = 'atendido',
        next_action_at = NULL,
        last_followup_at = now(),
        notes = COALESCE(NULLIF(trim(COALESCE(p_observacao, '')), ''), notes)
    WHERE id = p_lead_id
    RETURNING * INTO v_lead;
  ELSE
    v_next := COALESCE(p_reagendar_para, now() + interval '2 days');
    UPDATE public.sales_leads
    SET status = 'em_atendimento',
        next_action_at = v_next,
        last_followup_at = now(),
        notes = COALESCE(NULLIF(trim(COALESCE(p_observacao, '')), ''), notes)
    WHERE id = p_lead_id
    RETURNING * INTO v_lead;

    INSERT INTO public.lead_followups (lead_id, vendedor_id, data_followup, status_followup, observacao)
    SELECT p_lead_id, v_lead.assigned_seller_id, v_next, 'pendente', 'Proximo follow-up reagendado.'
    WHERE v_lead.assigned_seller_id IS NOT NULL;
  END IF;

  RETURN v_lead;
END;
$$;

INSERT INTO public.role_permissions (role, module, can_view, can_create, can_edit, can_delete, can_approve)
VALUES ('marketing', 'distribuicao_leads', true, true, true, false, false)
ON CONFLICT (role, module) DO UPDATE
SET can_view = EXCLUDED.can_view,
    can_create = EXCLUDED.can_create,
    can_edit = EXCLUDED.can_edit,
    updated_at = now();

INSERT INTO public.role_permissions (role, module, can_view, can_create, can_edit, can_delete, can_approve)
VALUES ('vendedor', 'leads_proprios', true, false, true, false, false)
ON CONFLICT (role, module) DO UPDATE
SET can_view = EXCLUDED.can_view,
    can_edit = EXCLUDED.can_edit,
    updated_at = now();
