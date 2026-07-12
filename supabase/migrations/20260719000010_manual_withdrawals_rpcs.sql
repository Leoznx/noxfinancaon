-- RPCs transacionais e consultas seguras do sistema de saque manual.
-- O frontend envia intenção e dados bancários; valores, estados e vínculos são
-- sempre determinados novamente pelo servidor.

-- ---------------------------------------------------------------------------
-- Validação server-side dos dados Pix.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_valid_cpf(_value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  v text := regexp_replace(coalesce(_value, ''), '\D', '', 'g');
  total integer;
  digit integer;
  i integer;
BEGIN
  IF length(v) <> 11 OR v ~ '^(\d)\1{10}$' THEN RETURN false; END IF;

  total := 0;
  FOR i IN 1..9 LOOP total := total + substr(v, i, 1)::integer * (11 - i); END LOOP;
  digit := (total * 10) % 11;
  IF digit = 10 THEN digit := 0; END IF;
  IF digit <> substr(v, 10, 1)::integer THEN RETURN false; END IF;

  total := 0;
  FOR i IN 1..10 LOOP total := total + substr(v, i, 1)::integer * (12 - i); END LOOP;
  digit := (total * 10) % 11;
  IF digit = 10 THEN digit := 0; END IF;
  RETURN digit = substr(v, 11, 1)::integer;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_valid_cnpj(_value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  v text := regexp_replace(coalesce(_value, ''), '\D', '', 'g');
  weights1 integer[] := ARRAY[5,4,3,2,9,8,7,6,5,4,3,2];
  weights2 integer[] := ARRAY[6,5,4,3,2,9,8,7,6,5,4,3,2];
  total integer := 0;
  remainder integer;
  digit integer;
  i integer;
BEGIN
  IF length(v) <> 14 OR v ~ '^(\d)\1{13}$' THEN RETURN false; END IF;

  FOR i IN 1..12 LOOP total := total + substr(v, i, 1)::integer * weights1[i]; END LOOP;
  remainder := total % 11;
  digit := CASE WHEN remainder < 2 THEN 0 ELSE 11 - remainder END;
  IF digit <> substr(v, 13, 1)::integer THEN RETURN false; END IF;

  total := 0;
  FOR i IN 1..13 LOOP total := total + substr(v, i, 1)::integer * weights2[i]; END LOOP;
  remainder := total % 11;
  digit := CASE WHEN remainder < 2 THEN 0 ELSE 11 - remainder END;
  RETURN digit = substr(v, 14, 1)::integer;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_valid_pix_key(_type text, _value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  v_type text := upper(trim(coalesce(_type, '')));
  v text := public.normalize_pix_key(_type, _value);
BEGIN
  IF v_type = 'CPF' THEN RETURN public.is_valid_cpf(v); END IF;
  IF v_type = 'CNPJ' THEN RETURN public.is_valid_cnpj(v); END IF;
  IF v_type IN ('EMAIL', 'E-MAIL') THEN
    RETURN length(v) <= 254 AND v ~* '^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9-]+(\.[A-Z0-9-]+)+$';
  END IF;
  IF v_type IN ('PHONE', 'TELEFONE') THEN
    RETURN length(v) IN (10, 11) AND left(v, 2) !~ '^0' AND v !~ '^(\d)\1+$';
  END IF;
  IF v_type IN ('RANDOM', 'ALEATORIA', 'ALEATÓRIA', 'CHAVE ALEATÓRIA') THEN
    RETURN v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION private.encrypt_withdrawal_pix(_value text, _version integer DEFAULT 1)
RETURNS bytea
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = private, public, extensions, pg_catalog
AS $$
  SELECT pgp_sym_encrypt(
    _value,
    private.withdrawal_crypto_key(_version),
    'cipher-algo=aes256,compress-algo=1'
  )
$$;
REVOKE ALL ON FUNCTION private.encrypt_withdrawal_pix(text, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.decrypt_withdrawal_pix(_value bytea, _version integer DEFAULT 1)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, public, extensions, pg_catalog
AS $$
  SELECT pgp_sym_decrypt(_value, private.withdrawal_crypto_key(_version))
$$;
REVOKE ALL ON FUNCTION private.decrypt_withdrawal_pix(bytea, integer) FROM PUBLIC, anon, authenticated;

-- Helpers internos. Nenhum deles é executável pelo cliente diretamente.
CREATE OR REPLACE FUNCTION private.add_financial_audit(
  _actor uuid,
  _action text,
  _withdrawal uuid DEFAULT NULL,
  _commission uuid DEFAULT NULL,
  _contract uuid DEFAULT NULL,
  _previous text DEFAULT NULL,
  _new text DEFAULT NULL,
  _amount bigint DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.financial_audit_logs (
    actor_user_id, action_type, withdrawal_id, commission_id, contract_id,
    previous_status, new_status, amount_cents, metadata
  ) VALUES (
    _actor, _action, _withdrawal, _commission, _contract,
    _previous, _new, _amount,
    coalesce(_metadata, '{}'::jsonb) - 'pix_key' - 'pix' - 'token' - 'receipt_base64'
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION private.add_financial_audit(uuid,text,uuid,uuid,uuid,text,text,bigint,jsonb)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.notify_user(
  _user_id uuid,
  _title text,
  _message text,
  _type text,
  _link text,
  _icon text DEFAULT 'wallet',
  _color text DEFAULT 'yellow'
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  INSERT INTO public.notificacoes (
    user_id, titulo, mensagem, tipo, link, icone, cor_destaque, lida
  ) VALUES (
    _user_id, _title, _message, _type, _link, _icon, _color, false
  )
$$;
REVOKE ALL ON FUNCTION private.notify_user(uuid,text,text,text,text,text,text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.notify_withdrawal_staff(
  _title text,
  _message text,
  _type text,
  _link text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_recipient uuid;
BEGIN
  FOR v_recipient IN
    SELECT DISTINCT recipient_id
    FROM (
      SELECT p.id AS recipient_id
      FROM public.profiles p
      WHERE p.role::text IN ('admin', 'admin_master', 'financeiro')
      UNION ALL
      SELECT iu.auth_user_id
      FROM public.internal_users iu
      WHERE iu.status::text = 'ativo'
        AND iu.role::text IN ('admin_master', 'financeiro')
    ) recipients
    WHERE recipient_id IS NOT NULL
  LOOP
    PERFORM private.notify_user(
      v_recipient, _title, _message, _type, _link, 'banknote', 'yellow'
    );
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION private.notify_withdrawal_staff(text,text,text,text)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Situação financeira real do contrato, calculada a partir de apólice e
-- parcelas. `faturas_inquilino` (alimentada pelo Asaas) é a fonte moderna;
-- `mensalidades` permanece apenas como compatibilidade para contratos antigos.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contract_financial_status(_contract_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_status text;
  v_has_first_payment boolean;
  v_overdue boolean;
BEGIN
  SELECT lower(a.status) INTO v_status
  FROM public.apolices a WHERE a.id = _contract_id;
  IF NOT FOUND THEN RETURN 'UNDER_REVIEW'; END IF;

  IF v_status ~ 'cancel|estorn|refund|chargeback' THEN RETURN 'CANCELLED'; END IF;
  IF v_status ~ 'encerr|finaliz|closed' THEN RETURN 'CLOSED'; END IF;
  IF v_status ~ 'analis|review|suspens|bloque' THEN RETURN 'UNDER_REVIEW'; END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.faturas_inquilino f
    WHERE f.apolice_id = _contract_id
      AND f.vencimento < current_date
      AND lower(f.status) NOT IN (
        'paid', 'pago', 'confirmed', 'received', 'paid_via_consolidated', 'cancelled', 'cancelado'
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.mensalidades m
    WHERE m.apolice_id = _contract_id
      AND m.data_vencimento < current_date
      AND lower(coalesce(m.status, '')) NOT IN ('paid', 'pago', 'confirmed', 'received', 'cancelado')
  ) INTO v_overdue;
  IF v_overdue THEN RETURN 'OVERDUE'; END IF;

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
  ) INTO v_has_first_payment;

  IF NOT v_has_first_payment THEN RETURN 'PAYMENT_PENDING'; END IF;
  RETURN 'ON_TIME';
END;
$$;
REVOKE ALL ON FUNCTION public.contract_financial_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contract_financial_status(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Solicitação: lock por usuário + lock das comissões + reserva atômica.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_withdrawal(
  p_bank_name text,
  p_holder_name text,
  p_pix_key_type text,
  p_pix_key text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user_type text;
  v_bank text := public.normalize_whitespace(p_bank_name);
  v_holder text := public.normalize_whitespace(p_holder_name);
  v_type text;
  v_pix text;
  v_existing public.withdrawal_requests%ROWTYPE;
  v_commission record;
  v_commission_ids uuid[] := ARRAY[]::uuid[];
  v_amount bigint := 0;
  v_withdrawal_id uuid;
  v_user_name text;
  v_updated_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'WITHDRAWAL_AUTH_REQUIRED';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WITHDRAWAL_IDEMPOTENCY_REQUIRED';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_uid::text));

  SELECT p.role::text, p.nome
  INTO v_user_type, v_user_name
  FROM public.profiles p
  WHERE p.id = v_uid
  FOR UPDATE;

  IF NOT FOUND OR v_user_type NOT IN ('corretor', 'imobiliaria', 'proprietario') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'WITHDRAWAL_PROFILE_NOT_ALLOWED';
  END IF;

  SELECT * INTO v_existing
  FROM public.withdrawal_requests
  WHERE user_id = v_uid AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'withdrawal_id', v_existing.id,
      'amount_cents', v_existing.amount_cents,
      'status', v_existing.status,
      'pix_key_masked', v_existing.pix_key_masked
    );
  END IF;

  IF length(v_bank) < 2 OR length(v_bank) > 120 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WITHDRAWAL_INVALID_BANK';
  END IF;
  IF length(v_holder) < 3 OR length(v_holder) > 160
     OR v_holder ~ '^\d+$' OR v_holder !~ '[[:alpha:]]' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WITHDRAWAL_INVALID_HOLDER';
  END IF;

  v_type := CASE upper(trim(coalesce(p_pix_key_type, '')))
    WHEN 'CPF' THEN 'CPF'
    WHEN 'CNPJ' THEN 'CNPJ'
    WHEN 'EMAIL' THEN 'EMAIL'
    WHEN 'E-MAIL' THEN 'EMAIL'
    WHEN 'PHONE' THEN 'PHONE'
    WHEN 'TELEFONE' THEN 'PHONE'
    WHEN 'RANDOM' THEN 'RANDOM'
    WHEN 'ALEATORIA' THEN 'RANDOM'
    WHEN 'ALEATÓRIA' THEN 'RANDOM'
    ELSE ''
  END;
  v_pix := public.normalize_pix_key(v_type, p_pix_key);
  IF NOT public.is_valid_pix_key(v_type, v_pix) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WITHDRAWAL_INVALID_PIX';
  END IF;

  SELECT * INTO v_existing
  FROM public.withdrawal_requests
  WHERE user_id = v_uid
    AND status IN ('PENDING_REVIEW', 'APPROVED', 'AWAITING_PAYMENT', 'MANUAL_REVIEW')
  ORDER BY requested_at DESC
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'ACTIVE_WITHDRAWAL_EXISTS',
      'withdrawal_id', v_existing.id,
      'status', v_existing.status
    );
  END IF;

  FOR v_commission IN
    SELECT c.id, c.contrato_id, c.amount_cents, c.base_amount_cents,
           c.percentual_aplicado, c.nivel_aplicado
    FROM public.comissoes c
    WHERE c.beneficiario_id = v_uid
      AND c.status = 'AVAILABLE'
      AND c.amount_cents > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.withdrawal_commissions wc
        WHERE wc.commission_id = c.id AND wc.active
      )
    ORDER BY c.created_at, c.id
    FOR UPDATE OF c
  LOOP
    v_commission_ids := array_append(v_commission_ids, v_commission.id);
    v_amount := v_amount + v_commission.amount_cents;
  END LOOP;

  IF v_amount <= 0 OR cardinality(v_commission_ids) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NO_AVAILABLE_BALANCE');
  END IF;

  INSERT INTO public.withdrawal_requests (
    user_id, user_type, amount_cents, fee_cents, net_amount_cents, status,
    bank_name, holder_name, pix_key_type, pix_key_encrypted, pix_key_masked,
    pix_key_fingerprint, pix_key_version, requested_at, idempotency_key,
    requires_manual_review
  ) VALUES (
    v_uid, v_user_type, v_amount, 0, v_amount, 'PENDING_REVIEW',
    v_bank, v_holder, v_type, private.encrypt_withdrawal_pix(v_pix, 1),
    public.mask_pix_key(v_type, v_pix), encode(digest(v_pix, 'sha256'), 'hex'),
    1, now(), p_idempotency_key, false
  ) RETURNING id INTO v_withdrawal_id;

  INSERT INTO public.withdrawal_commissions (
    withdrawal_id, commission_id, contract_id, amount_cents,
    base_amount_cents, percentage_applied, level_applied, active
  )
  SELECT
    v_withdrawal_id, c.id, c.contrato_id, c.amount_cents,
    c.base_amount_cents, c.percentual_aplicado, c.nivel_aplicado, true
  FROM public.comissoes c
  WHERE c.id = ANY(v_commission_ids);

  UPDATE public.comissoes
  SET status = 'RESERVED', withdrawal_id = v_withdrawal_id, updated_at = now()
  WHERE id = ANY(v_commission_ids) AND status = 'AVAILABLE';
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count <> cardinality(v_commission_ids) THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'WITHDRAWAL_BALANCE_CHANGED';
  END IF;

  INSERT INTO public.commission_financial_ledger (
    user_id, withdrawal_id, entry_type, amount_cents, idempotency_key, metadata
  ) VALUES (
    v_uid, v_withdrawal_id, 'WITHDRAWAL_RESERVED', v_amount,
    'withdrawal:' || v_withdrawal_id::text || ':reserved',
    jsonb_build_object('commission_count', cardinality(v_commission_ids))
  );

  PERFORM private.add_financial_audit(
    v_uid, 'WITHDRAWAL_CREATED', v_withdrawal_id, NULL, NULL,
    NULL, 'PENDING_REVIEW', v_amount,
    jsonb_build_object('commission_count', cardinality(v_commission_ids), 'idempotency_key', p_idempotency_key)
  );
  PERFORM private.add_financial_audit(
    v_uid, 'BALANCE_RESERVED', v_withdrawal_id, NULL, NULL,
    'AVAILABLE', 'RESERVED', v_amount,
    jsonb_build_object('commission_count', cardinality(v_commission_ids))
  );

  PERFORM private.notify_withdrawal_staff(
    'Nova solicitação de saque',
    coalesce(v_user_name, 'Usuário') || ' solicitou o saque de R$ ' ||
      to_char(v_amount::numeric / 100, 'FM999999990D00') || '.',
    'saque_solicitado',
    '/admin/financeiro'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'withdrawal_id', v_withdrawal_id,
    'amount_cents', v_amount,
    'fee_cents', 0,
    'net_amount_cents', v_amount,
    'status', 'PENDING_REVIEW',
    'pix_key_masked', public.mask_pix_key(v_type, v_pix),
    'commission_count', cardinality(v_commission_ids)
  );
EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO v_existing
    FROM public.withdrawal_requests
    WHERE user_id = v_uid
      AND (idempotency_key = p_idempotency_key
        OR status IN ('PENDING_REVIEW', 'APPROVED', 'AWAITING_PAYMENT', 'MANUAL_REVIEW'))
    ORDER BY (idempotency_key = p_idempotency_key) DESC, requested_at DESC
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', v_existing.idempotency_key = p_idempotency_key,
        'idempotent', v_existing.idempotency_key = p_idempotency_key,
        'code', CASE WHEN v_existing.idempotency_key = p_idempotency_key THEN NULL ELSE 'ACTIVE_WITHDRAWAL_EXISTS' END,
        'withdrawal_id', v_existing.id,
        'amount_cents', v_existing.amount_cents,
        'status', v_existing.status
      );
    END IF;
    RAISE;
END;
$$;

-- ---------------------------------------------------------------------------
-- Aprovação e recusa. Todas as transições usam row lock e status atual.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_withdrawal(p_withdrawal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_w public.withdrawal_requests%ROWTYPE;
  v_issues jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.can_manage_withdrawals(v_uid, 'approve') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'WITHDRAWAL_FORBIDDEN';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_withdrawal_id::text));
  SELECT * INTO v_w FROM public.withdrawal_requests WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF v_w.status = 'AWAITING_PAYMENT' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'status', v_w.status);
  END IF;
  IF v_w.status NOT IN ('PENDING_REVIEW', 'APPROVED', 'MANUAL_REVIEW') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'STATUS_NOT_ALLOWED', 'status', v_w.status);
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'contract_id', wc.contract_id,
    'status', public.contract_financial_status(wc.contract_id)
  )) INTO v_issues
  FROM public.withdrawal_commissions wc
  WHERE wc.withdrawal_id = v_w.id
    AND wc.active
    AND public.contract_financial_status(wc.contract_id) IN (
      'CANCELLED', 'OVERDUE', 'UNDER_REVIEW', 'PAYMENT_PENDING'
    );

  IF v_issues IS NOT NULL THEN
    IF v_w.status <> 'MANUAL_REVIEW' THEN
      UPDATE public.withdrawal_requests
      SET status = 'MANUAL_REVIEW', requires_manual_review = true,
          reviewed_at = now(), reviewed_by = v_uid
      WHERE id = v_w.id;
      UPDATE public.comissoes c
      SET status = 'MANUAL_REVIEW'
      FROM public.withdrawal_commissions wc
      WHERE wc.withdrawal_id = v_w.id AND wc.commission_id = c.id AND wc.active
        AND c.status = 'RESERVED';
      PERFORM private.add_financial_audit(
        v_uid, 'WITHDRAWAL_SENT_TO_MANUAL_REVIEW', v_w.id, NULL, NULL,
        v_w.status, 'MANUAL_REVIEW', v_w.amount_cents,
        jsonb_build_object('contract_issues', v_issues)
      );
    END IF;
    RETURN jsonb_build_object(
      'ok', false, 'code', 'CONTRACT_REVIEW_REQUIRED',
      'status', 'MANUAL_REVIEW', 'issues', v_issues
    );
  END IF;

  UPDATE public.comissoes c
  SET status = 'RESERVED', updated_at = now()
  FROM public.withdrawal_commissions wc
  WHERE wc.withdrawal_id = v_w.id AND wc.commission_id = c.id AND wc.active
    AND c.status = 'MANUAL_REVIEW';

  UPDATE public.withdrawal_requests
  SET status = 'AWAITING_PAYMENT', approved_at = coalesce(approved_at, now()),
      approved_by = coalesce(approved_by, v_uid), reviewed_at = now(),
      reviewed_by = v_uid, requires_manual_review = false
  WHERE id = v_w.id;

  PERFORM private.add_financial_audit(
    v_uid, 'WITHDRAWAL_APPROVED', v_w.id, NULL, NULL,
    v_w.status, 'AWAITING_PAYMENT', v_w.amount_cents,
    jsonb_build_object('contract_count', (
      SELECT count(*) FROM public.withdrawal_commissions WHERE withdrawal_id = v_w.id
    ))
  );
  PERFORM private.notify_user(
    v_w.user_id,
    'Saque aprovado',
    'Sua solicitação de R$ ' || to_char(v_w.amount_cents::numeric / 100, 'FM999999990D00') ||
      ' foi aprovada e aguarda pagamento.',
    'saque_aprovado', '/minhas-comissoes', 'circle-check', 'emerald'
  );

  RETURN jsonb_build_object('ok', true, 'withdrawal_id', v_w.id, 'status', 'AWAITING_PAYMENT');
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_withdrawal(
  p_withdrawal_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_w public.withdrawal_requests%ROWTYPE;
  v_reason text := public.normalize_whitespace(p_reason);
BEGIN
  IF v_uid IS NULL OR NOT public.can_manage_withdrawals(v_uid, 'reject') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'WITHDRAWAL_FORBIDDEN';
  END IF;
  IF length(v_reason) < 3 OR length(v_reason) > 1000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WITHDRAWAL_REJECTION_REASON_REQUIRED';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_withdrawal_id::text));
  SELECT * INTO v_w FROM public.withdrawal_requests WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF v_w.status = 'REJECTED' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'status', 'REJECTED');
  END IF;
  IF v_w.status IN ('PAID', 'CANCELLED') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'STATUS_NOT_ALLOWED', 'status', v_w.status);
  END IF;

  UPDATE public.withdrawal_requests
  SET status = 'REJECTED', rejected_at = now(), rejected_by = v_uid,
      rejection_reason = v_reason, reviewed_at = now(), reviewed_by = v_uid
  WHERE id = v_w.id;

  UPDATE public.withdrawal_commissions
  SET active = false, released_at = now(), release_reason = 'REJECTED'
  WHERE withdrawal_id = v_w.id AND active;

  UPDATE public.comissoes c
  SET
    status = CASE
      WHEN public.contract_financial_status(c.contrato_id) = 'CANCELLED' THEN 'REVERSED'
      ELSE 'AVAILABLE'
    END,
    reversed_at = CASE
      WHEN public.contract_financial_status(c.contrato_id) = 'CANCELLED' THEN now()
      ELSE c.reversed_at
    END,
    reversal_reason = CASE
      WHEN public.contract_financial_status(c.contrato_id) = 'CANCELLED'
        THEN 'Contrato cancelado antes do pagamento do saque'
      ELSE c.reversal_reason
    END,
    withdrawal_id = NULL,
    updated_at = now()
  FROM public.withdrawal_commissions wc
  WHERE wc.withdrawal_id = v_w.id AND wc.commission_id = c.id
    AND c.status IN ('RESERVED', 'MANUAL_REVIEW');

  INSERT INTO public.commission_financial_ledger (
    user_id, withdrawal_id, entry_type, amount_cents, idempotency_key, metadata
  ) VALUES (
    v_w.user_id, v_w.id, 'WITHDRAWAL_RELEASED', -v_w.amount_cents,
    'withdrawal:' || v_w.id::text || ':released',
    jsonb_build_object('reason', left(v_reason, 300))
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  PERFORM private.add_financial_audit(
    v_uid, 'WITHDRAWAL_REJECTED', v_w.id, NULL, NULL,
    v_w.status, 'REJECTED', v_w.amount_cents,
    jsonb_build_object('reason', left(v_reason, 300))
  );
  PERFORM private.add_financial_audit(
    v_uid, 'BALANCE_RELEASED_AFTER_REJECTION', v_w.id, NULL, NULL,
    'RESERVED', 'AVAILABLE', v_w.amount_cents, '{}'::jsonb
  );
  PERFORM private.notify_user(
    v_w.user_id,
    'Saque recusado',
    'Sua solicitação de R$ ' || to_char(v_w.amount_cents::numeric / 100, 'FM999999990D00') ||
      ' foi recusada. Motivo: ' || left(v_reason, 300),
    'saque_recusado', '/minhas-comissoes', 'circle-x', 'red'
  );

  RETURN jsonb_build_object('ok', true, 'withdrawal_id', v_w.id, 'status', 'REJECTED');
END;
$$;

-- ---------------------------------------------------------------------------
-- Contexto e finalização do comprovante. A Edge Function faz upload privado;
-- esta RPC revalida tudo e conclui o banco em uma única transação.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_withdrawal_upload_context(p_withdrawal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_w public.withdrawal_requests%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.can_manage_withdrawals(v_uid, 'pay') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'WITHDRAWAL_FORBIDDEN';
  END IF;
  SELECT * INTO v_w FROM public.withdrawal_requests WHERE id = p_withdrawal_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('allowed', false, 'code', 'NOT_FOUND'); END IF;
  RETURN jsonb_build_object(
    'allowed', v_w.status = 'AWAITING_PAYMENT',
    'user_id', v_w.user_id,
    'status', v_w.status,
    'amount_cents', v_w.amount_cents
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_withdrawal_as_paid(
  p_withdrawal_id uuid,
  p_receipt_path text,
  p_receipt_file_name text,
  p_receipt_mime_type text,
  p_receipt_size_bytes bigint,
  p_receipt_sha256 text,
  p_payment_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_w public.withdrawal_requests%ROWTYPE;
  v_reserved bigint;
  v_issues jsonb;
  v_expected_prefix text;
BEGIN
  IF v_uid IS NULL OR NOT public.can_manage_withdrawals(v_uid, 'pay') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'WITHDRAWAL_FORBIDDEN';
  END IF;
  IF p_receipt_mime_type NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
     OR p_receipt_size_bytes NOT BETWEEN 1 AND 10485760
     OR p_receipt_sha256 !~ '^[0-9a-f]{64}$'
     OR length(coalesce(p_receipt_file_name, '')) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WITHDRAWAL_INVALID_RECEIPT';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_withdrawal_id::text));
  SELECT * INTO v_w FROM public.withdrawal_requests WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;

  IF v_w.status = 'PAID' THEN
    RETURN jsonb_build_object(
      'ok', v_w.receipt_sha256 = p_receipt_sha256,
      'idempotent', v_w.receipt_sha256 = p_receipt_sha256,
      'code', CASE WHEN v_w.receipt_sha256 = p_receipt_sha256 THEN NULL ELSE 'ALREADY_PAID' END,
      'status', v_w.status
    );
  END IF;
  IF v_w.status <> 'AWAITING_PAYMENT' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'STATUS_NOT_ALLOWED', 'status', v_w.status);
  END IF;

  v_expected_prefix := v_w.user_id::text || '/' || v_w.id::text || '/';
  IF p_receipt_path NOT LIKE v_expected_prefix || '%'
     OR p_receipt_path ~ '(^|/)\.\.(/|$)'
     OR p_receipt_path !~* '\.(pdf|jpg|jpeg|png|webp)$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WITHDRAWAL_INVALID_RECEIPT_PATH';
  END IF;

  SELECT coalesce(sum(wc.amount_cents), 0)::bigint INTO v_reserved
  FROM public.withdrawal_commissions wc
  JOIN public.comissoes c ON c.id = wc.commission_id
  WHERE wc.withdrawal_id = v_w.id AND wc.active
    AND c.status IN ('RESERVED', 'MANUAL_REVIEW');
  IF v_reserved <> v_w.amount_cents THEN
    UPDATE public.withdrawal_requests
    SET status = 'MANUAL_REVIEW', requires_manual_review = true
    WHERE id = v_w.id;
    PERFORM private.add_financial_audit(
      v_uid, 'WITHDRAWAL_RESERVATION_MISMATCH', v_w.id, NULL, NULL,
      v_w.status, 'MANUAL_REVIEW', v_w.amount_cents,
      jsonb_build_object('reserved_cents', v_reserved)
    );
    RETURN jsonb_build_object('ok', false, 'code', 'RESERVATION_MISMATCH', 'status', 'MANUAL_REVIEW');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'contract_id', wc.contract_id,
    'status', public.contract_financial_status(wc.contract_id)
  )) INTO v_issues
  FROM public.withdrawal_commissions wc
  WHERE wc.withdrawal_id = v_w.id AND wc.active
    AND public.contract_financial_status(wc.contract_id) IN (
      'CANCELLED', 'OVERDUE', 'UNDER_REVIEW', 'PAYMENT_PENDING'
    );

  IF v_issues IS NOT NULL THEN
    UPDATE public.withdrawal_requests
    SET status = 'MANUAL_REVIEW', requires_manual_review = true,
        reviewed_at = now(), reviewed_by = v_uid
    WHERE id = v_w.id;
    UPDATE public.comissoes c
    SET status = 'MANUAL_REVIEW', updated_at = now()
    FROM public.withdrawal_commissions wc
    WHERE wc.withdrawal_id = v_w.id AND wc.commission_id = c.id AND wc.active
      AND c.status = 'RESERVED';
    PERFORM private.add_financial_audit(
      v_uid, 'WITHDRAWAL_SENT_TO_MANUAL_REVIEW', v_w.id, NULL, NULL,
      v_w.status, 'MANUAL_REVIEW', v_w.amount_cents,
      jsonb_build_object('contract_issues', v_issues)
    );
    PERFORM private.notify_withdrawal_staff(
      'Saque em revisão manual',
      'O saque ' || left(v_w.id::text, 8) || ' possui contrato com divergência financeira.',
      'saque_revisao', '/admin/financeiro'
    );
    RETURN jsonb_build_object(
      'ok', false, 'code', 'CONTRACT_REVIEW_REQUIRED',
      'status', 'MANUAL_REVIEW', 'issues', v_issues
    );
  END IF;

  UPDATE public.withdrawal_requests
  SET
    status = 'PAID', paid_at = now(), paid_by = v_uid,
    receipt_path = p_receipt_path,
    receipt_file_name = p_receipt_file_name,
    receipt_mime_type = p_receipt_mime_type,
    receipt_size_bytes = p_receipt_size_bytes,
    receipt_sha256 = lower(p_receipt_sha256),
    receipt_uploaded_at = now(), receipt_uploaded_by = v_uid,
    payment_notes = nullif(public.normalize_whitespace(p_payment_notes), ''),
    reviewed_at = coalesce(reviewed_at, now()), reviewed_by = coalesce(reviewed_by, v_uid)
  WHERE id = v_w.id AND status = 'AWAITING_PAYMENT';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CONCURRENT_UPDATE');
  END IF;

  UPDATE public.withdrawal_commissions
  SET active = false, released_at = now(), release_reason = 'PAID'
  WHERE withdrawal_id = v_w.id AND active;

  UPDATE public.comissoes c
  SET status = 'PAID', paid_at = now(), sacada_em = now(), updated_at = now()
  FROM public.withdrawal_commissions wc
  WHERE wc.withdrawal_id = v_w.id AND wc.commission_id = c.id
    AND c.status = 'RESERVED';

  INSERT INTO public.commission_financial_ledger (
    user_id, withdrawal_id, entry_type, amount_cents, idempotency_key,
    metadata
  ) VALUES (
    v_w.user_id, v_w.id, 'WITHDRAWAL_PAID', v_w.amount_cents,
    'withdrawal:' || v_w.id::text || ':paid',
    jsonb_build_object('receipt_sha256', lower(p_receipt_sha256))
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  PERFORM private.add_financial_audit(
    v_uid, 'WITHDRAWAL_RECEIPT_ATTACHED', v_w.id, NULL, NULL,
    NULL, NULL, v_w.amount_cents,
    jsonb_build_object(
      'mime_type', p_receipt_mime_type,
      'size_bytes', p_receipt_size_bytes,
      'sha256', lower(p_receipt_sha256)
    )
  );
  PERFORM private.add_financial_audit(
    v_uid, 'WITHDRAWAL_PAID', v_w.id, NULL, NULL,
    v_w.status, 'PAID', v_w.amount_cents, '{}'::jsonb
  );
  PERFORM private.notify_user(
    v_w.user_id,
    'Pagamento realizado',
    'Seu saque de R$ ' || to_char(v_w.amount_cents::numeric / 100, 'FM999999990D00') ||
      ' foi pago. O comprovante já está disponível em Meus Saques.',
    'saque_pago', '/minhas-comissoes', 'circle-check', 'emerald'
  );

  RETURN jsonb_build_object(
    'ok', true, 'withdrawal_id', v_w.id, 'status', 'PAID',
    'amount_cents', v_w.amount_cents, 'paid_at', now()
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Resumo e histórico do usuário. Nenhuma função devolve ciphertext/path.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_financial_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pending bigint;
  v_available bigint;
  v_reserved bigint;
  v_total bigint;
  v_withdrawn bigint;
  v_active_id uuid;
  v_active_status text;
  v_contracts integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'WITHDRAWAL_AUTH_REQUIRED';
  END IF;

  SELECT
    coalesce(sum(amount_cents) FILTER (WHERE status IN ('PENDING', 'MANUAL_REVIEW')), 0)::bigint,
    coalesce(sum(amount_cents) FILTER (WHERE status = 'AVAILABLE'), 0)::bigint,
    coalesce(sum(amount_cents) FILTER (WHERE status = 'RESERVED'), 0)::bigint,
    coalesce(sum(amount_cents) FILTER (WHERE status <> 'REVERSED'), 0)::bigint
  INTO v_pending, v_available, v_reserved, v_total
  FROM public.comissoes
  WHERE beneficiario_id = v_uid;

  SELECT coalesce(sum(amount_cents), 0)::bigint INTO v_withdrawn
  FROM public.withdrawal_requests WHERE user_id = v_uid AND status = 'PAID';

  SELECT id, status INTO v_active_id, v_active_status
  FROM public.withdrawal_requests
  WHERE user_id = v_uid
    AND status IN ('PENDING_REVIEW', 'APPROVED', 'AWAITING_PAYMENT', 'MANUAL_REVIEW')
  ORDER BY requested_at DESC LIMIT 1;

  SELECT count(*)::integer INTO v_contracts
  FROM public.apolices a
  LEFT JOIN public.consultas_credito q ON q.id = a.consulta_id
  LEFT JOIN public.imoveis im ON im.id = q.imovel_id
  LEFT JOIN public.proprietarios prop ON prop.id = im.proprietario_id
  WHERE lower(a.status) IN ('ativa', 'active')
    AND (
      a.corretor_profile_id = v_uid OR a.imobiliaria_profile_id = v_uid
      OR a.proprietario_profile_id = v_uid OR q.profile_id_solicitante = v_uid
      OR prop.profile_id = v_uid
    );

  RETURN jsonb_build_object(
    'pending_cents', v_pending,
    'available_cents', v_available,
    'reserved_cents', v_reserved,
    'total_accumulated_cents', v_total,
    'total_withdrawn_cents', v_withdrawn,
    'active_contracts', v_contracts,
    'active_withdrawal_id', v_active_id,
    'active_withdrawal_status', v_active_status,
    'withdrawal_action', CASE
      WHEN v_active_status = 'AWAITING_PAYMENT' THEN 'AWAITING_PAYMENT'
      WHEN v_active_id IS NOT NULL THEN 'UNDER_REVIEW'
      WHEN v_available > 0 THEN 'AVAILABLE'
      ELSE 'UNAVAILABLE'
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_commissions()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_uid uuid := auth.uid(); v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION USING ERRCODE='28000', MESSAGE='WITHDRAWAL_AUTH_REQUIRED'; END IF;
  SELECT coalesce(jsonb_agg(item ORDER BY (item->>'created_at') DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id', c.id,
      'contract_id', c.contrato_id,
      'contract_number', a.numero,
      'tenant_name', i.nome,
      'base_amount_cents', c.base_amount_cents,
      'percentage_applied', c.percentual_aplicado,
      'level_applied', c.nivel_aplicado,
      'amount_cents', c.amount_cents,
      'status', c.status,
      'created_at', c.created_at,
      'available_at', c.released_at,
      'withdrawal_id', linked.withdrawal_id,
      'withdrawal_status', w.status,
      'receipt_available', w.status = 'PAID' AND w.receipt_file_name IS NOT NULL
    ) AS item
    FROM public.comissoes c
    JOIN public.apolices a ON a.id = c.contrato_id
    LEFT JOIN public.consultas_credito q ON q.id = a.consulta_id
    LEFT JOIN public.inquilinos i ON i.id = q.inquilino_id
    LEFT JOIN LATERAL (
      SELECT wc.withdrawal_id
      FROM public.withdrawal_commissions wc
      WHERE wc.commission_id = c.id
      ORDER BY wc.created_at DESC LIMIT 1
    ) linked ON true
    LEFT JOIN public.withdrawal_requests w ON w.id = linked.withdrawal_id
    WHERE c.beneficiario_id = v_uid
  ) rows;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_withdrawals()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_uid uuid := auth.uid(); v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION USING ERRCODE='28000', MESSAGE='WITHDRAWAL_AUTH_REQUIRED'; END IF;
  SELECT coalesce(jsonb_agg(item ORDER BY (item->>'requested_at') DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id', w.id,
      'amount_cents', w.amount_cents,
      'fee_cents', w.fee_cents,
      'net_amount_cents', w.net_amount_cents,
      'status', w.status,
      'bank_name', w.bank_name,
      'holder_name', w.holder_name,
      'pix_key_type', w.pix_key_type,
      'pix_key_masked', w.pix_key_masked,
      'requested_at', w.requested_at,
      'approved_at', w.approved_at,
      'paid_at', w.paid_at,
      'rejected_at', w.rejected_at,
      'rejection_reason', w.rejection_reason,
      'receipt_available', w.status = 'PAID' AND w.receipt_file_name IS NOT NULL,
      'contract_count', (SELECT count(*) FROM public.withdrawal_commissions wc WHERE wc.withdrawal_id = w.id)
    ) AS item
    FROM public.withdrawal_requests w
    WHERE w.user_id = v_uid
  ) rows;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_commission_contracts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_uid uuid := auth.uid(); v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION USING ERRCODE='28000', MESSAGE='WITHDRAWAL_AUTH_REQUIRED'; END IF;
  SELECT coalesce(jsonb_agg(item ORDER BY (item->>'start_date') DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id', a.id,
      'number', a.numero,
      'status', a.status,
      'start_date', a.vigencia_inicio,
      'end_date', a.vigencia_fim,
      'premium_cents', round(a.valor_premio * 100)::bigint,
      'tenant_name', i.nome,
      'financial_status', public.contract_financial_status(a.id),
      'commission_status', c.status,
      'commission_cents', c.amount_cents
    ) AS item
    FROM public.apolices a
    LEFT JOIN public.consultas_credito q ON q.id = a.consulta_id
    LEFT JOIN public.inquilinos i ON i.id = q.inquilino_id
    LEFT JOIN LATERAL (
      SELECT c1.status, c1.amount_cents
      FROM public.comissoes c1
      WHERE c1.contrato_id = a.id AND c1.beneficiario_id = v_uid
      ORDER BY c1.created_at DESC LIMIT 1
    ) c ON true
    WHERE EXISTS (
      SELECT 1 FROM public.comissoes own_commission
      WHERE own_commission.contrato_id = a.id AND own_commission.beneficiario_id = v_uid
    )
       OR q.profile_id_solicitante = v_uid
  ) rows;
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- Detalhes, revelação Pix auditada e autorização de comprovante.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_withdrawal_details(p_withdrawal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_w public.withdrawal_requests%ROWTYPE;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION USING ERRCODE='28000', MESSAGE='WITHDRAWAL_AUTH_REQUIRED'; END IF;
  SELECT * INTO v_w FROM public.withdrawal_requests WHERE id = p_withdrawal_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_w.user_id <> v_uid AND NOT public.can_manage_withdrawals(v_uid, 'view') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='WITHDRAWAL_FORBIDDEN';
  END IF;

  SELECT jsonb_build_object(
    'withdrawal', jsonb_build_object(
      'id', v_w.id, 'user_id', v_w.user_id, 'user_type', v_w.user_type,
      'amount_cents', v_w.amount_cents, 'fee_cents', v_w.fee_cents,
      'net_amount_cents', v_w.net_amount_cents, 'status', v_w.status,
      'bank_name', v_w.bank_name, 'holder_name', v_w.holder_name,
      'pix_key_type', v_w.pix_key_type, 'pix_key_masked', v_w.pix_key_masked,
      'requested_at', v_w.requested_at, 'reviewed_at', v_w.reviewed_at,
      'approved_at', v_w.approved_at, 'paid_at', v_w.paid_at,
      'rejected_at', v_w.rejected_at, 'rejection_reason', v_w.rejection_reason,
      'payment_notes', v_w.payment_notes,
      'receipt_available', v_w.status = 'PAID' AND v_w.receipt_file_name IS NOT NULL,
      'receipt_file_name', v_w.receipt_file_name,
      'receipt_mime_type', v_w.receipt_mime_type,
      'receipt_size_bytes', v_w.receipt_size_bytes
    ),
    'requester', (
      SELECT jsonb_build_object(
        'id', p.id, 'name', p.nome, 'email', p.email, 'role', p.role,
        'document', coalesce(
          p.cnpj,
          (SELECT co.cpf FROM public.corretores co WHERE co.profile_id = p.id LIMIT 1),
          (SELECT pr.cpf_cnpj FROM public.proprietarios pr WHERE pr.profile_id = p.id LIMIT 1)
        ),
        'created_at', p.created_at, 'commission_level', p.nivel_atual,
        'active_contracts', (
          SELECT count(*) FROM public.apolices a
          WHERE lower(a.status) IN ('ativa', 'active')
            AND (a.corretor_profile_id = p.id OR a.imobiliaria_profile_id = p.id OR a.proprietario_profile_id = p.id)
        ),
        'withdrawal_count', (
          SELECT count(*) FROM public.withdrawal_requests wh WHERE wh.user_id = p.id
        ),
        'total_accumulated_cents', (
          SELECT coalesce(sum(c.amount_cents) FILTER (WHERE c.status <> 'REVERSED'), 0)
          FROM public.comissoes c WHERE c.beneficiario_id = p.id
        ),
        'total_withdrawn_cents', (
          SELECT coalesce(sum(wh.amount_cents), 0)
          FROM public.withdrawal_requests wh WHERE wh.user_id = p.id AND wh.status = 'PAID'
        )
      ) FROM public.profiles p WHERE p.id = v_w.user_id
    ),
    'contracts', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'contract_id', a.id,
        'contract_number', a.numero,
        'tenant_name', i.nome,
        'owner_name', prop.nome,
        'responsible_name', beneficiary.nome,
        'contract_value_cents', round(coalesce(q.valor_anual, q.valor_aluguel, im.valor_aluguel, a.valor_premio) * 100)::bigint,
        'base_amount_cents', wc.base_amount_cents,
        'percentage_applied', wc.percentage_applied,
        'commission_cents', wc.amount_cents,
        'start_date', a.vigencia_inicio,
        'last_payment_at', greatest(
          (SELECT max(f.pago_em) FROM public.faturas_inquilino f WHERE f.apolice_id = a.id),
          (SELECT max(m.data_pagamento) FROM public.mensalidades m WHERE m.apolice_id = a.id)
        ),
        'next_due_date', least(
          (SELECT min(f.vencimento) FROM public.faturas_inquilino f
           WHERE f.apolice_id = a.id AND lower(f.status) NOT IN ('paid','pago','confirmed','received','cancelled','cancelado')),
          (SELECT min(m.data_vencimento) FROM public.mensalidades m
           WHERE m.apolice_id = a.id AND lower(coalesce(m.status,'')) NOT IN ('paid','pago','confirmed','received','cancelado'))
        ),
        'contract_status', a.status,
        'financial_status', public.contract_financial_status(a.id),
        'paid_installments', (
          SELECT count(*) FROM public.faturas_inquilino f
          WHERE f.apolice_id = a.id AND lower(f.status) IN ('paid','pago','confirmed','received','paid_via_consolidated')
        ) + (
          SELECT count(*) FROM public.mensalidades m
          WHERE m.apolice_id = a.id AND lower(coalesce(m.status,'')) IN ('paid','pago','confirmed','received')
        ),
        'pending_installments', (
          SELECT count(*) FROM public.faturas_inquilino f
          WHERE f.apolice_id = a.id AND lower(f.status) NOT IN ('paid','pago','confirmed','received','paid_via_consolidated','cancelled','cancelado')
        ) + (
          SELECT count(*) FROM public.mensalidades m
          WHERE m.apolice_id = a.id AND lower(coalesce(m.status,'')) NOT IN ('paid','pago','confirmed','received','cancelado')
        ),
        'has_overdue', public.contract_financial_status(a.id) = 'OVERDUE',
        'contract_url', '/apolices/' || a.id::text
      ) ORDER BY a.vigencia_inicio DESC)
      FROM public.withdrawal_commissions wc
      JOIN public.comissoes c ON c.id = wc.commission_id
      JOIN public.apolices a ON a.id = wc.contract_id
      LEFT JOIN public.consultas_credito q ON q.id = a.consulta_id
      LEFT JOIN public.inquilinos i ON i.id = q.inquilino_id
      LEFT JOIN public.imoveis im ON im.id = q.imovel_id
      LEFT JOIN public.proprietarios prop ON prop.id = im.proprietario_id
      LEFT JOIN public.profiles beneficiary ON beneficiary.id = c.beneficiario_id
      WHERE wc.withdrawal_id = v_w.id
    ), '[]'::jsonb),
    'timeline', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'action', a.action_type,
        'previous_status', a.previous_status,
        'new_status', a.new_status,
        'created_at', a.created_at,
        'actor_name', actor.nome
      ) ORDER BY a.created_at)
      FROM public.financial_audit_logs a
      LEFT JOIN public.profiles actor ON actor.id = a.actor_user_id
      WHERE a.withdrawal_id = v_w.id
    ), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.reveal_withdrawal_pix(p_withdrawal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $$
DECLARE v_uid uuid := auth.uid(); v_w public.withdrawal_requests%ROWTYPE; v_pix text;
BEGIN
  IF v_uid IS NULL OR NOT public.can_manage_withdrawals(v_uid, 'reveal') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='WITHDRAWAL_FORBIDDEN';
  END IF;
  SELECT * INTO v_w FROM public.withdrawal_requests WHERE id = p_withdrawal_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_pix := private.decrypt_withdrawal_pix(v_w.pix_key_encrypted, v_w.pix_key_version);
  PERFORM private.add_financial_audit(
    v_uid, 'PIX_KEY_REVEALED', v_w.id, NULL, NULL,
    NULL, NULL, NULL, jsonb_build_object('key_type', v_w.pix_key_type)
  );
  RETURN jsonb_build_object(
    'withdrawal_id', v_w.id,
    'pix_key_type', v_w.pix_key_type,
    'pix_key', v_pix,
    'bank_name', v_w.bank_name,
    'holder_name', v_w.holder_name
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.authorize_withdrawal_receipt(
  p_withdrawal_id uuid,
  p_access_type text DEFAULT 'view'
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $$
DECLARE v_uid uuid := auth.uid(); v_w public.withdrawal_requests%ROWTYPE; v_access text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION USING ERRCODE='28000', MESSAGE='WITHDRAWAL_AUTH_REQUIRED'; END IF;
  v_access := lower(coalesce(p_access_type, 'view'));
  IF v_access NOT IN ('view', 'download') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='WITHDRAWAL_INVALID_ACCESS_TYPE';
  END IF;
  SELECT * INTO v_w FROM public.withdrawal_requests WHERE id = p_withdrawal_id;
  IF NOT FOUND OR v_w.receipt_path IS NULL OR v_w.status <> 'PAID' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RECEIPT_NOT_FOUND');
  END IF;
  IF v_w.user_id <> v_uid AND NOT public.can_manage_withdrawals(v_uid, 'receipt') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='WITHDRAWAL_FORBIDDEN';
  END IF;
  PERFORM private.add_financial_audit(
    v_uid,
    CASE WHEN v_access = 'download' THEN 'WITHDRAWAL_RECEIPT_DOWNLOADED' ELSE 'WITHDRAWAL_RECEIPT_VIEWED' END,
    v_w.id, NULL, NULL, NULL, NULL, NULL,
    jsonb_build_object('access_type', v_access)
  );
  RETURN jsonb_build_object('ok', true, 'path', v_w.receipt_path, 'access_type', v_access);
END;
$$;

-- ---------------------------------------------------------------------------
-- Consultas do Financeiro/Admin com filtros e contadores reais.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_finance_dashboard_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_uid uuid := auth.uid(); v_result jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.can_manage_withdrawals(v_uid, 'view') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='WITHDRAWAL_FORBIDDEN';
  END IF;
  SELECT jsonb_build_object(
    'revenue_received_cents',
      coalesce((SELECT sum(round(value * 100)::bigint) FROM public.asaas_payments
                WHERE lower(status) IN ('paid','received')), 0)
      + coalesce((SELECT sum(round(amount * 100)::bigint) FROM public.cakto_payments
                  WHERE lower(status) IN ('paid','pago','approved','completed','confirmed')), 0),
    'revenue_pending_cents',
      coalesce((SELECT sum(round(value * 100)::bigint) FROM public.asaas_payments
                WHERE lower(status) IN ('pending','created','waiting_payment','confirmed')), 0)
      + coalesce((SELECT sum(round(amount * 100)::bigint) FROM public.cakto_payments
                  WHERE lower(status) IN ('pending','pendente','created','waiting_payment')), 0),
    'commissions_paid_cents',
      coalesce((SELECT sum(amount_cents) FROM public.withdrawal_requests WHERE status='PAID'), 0),
    'commissions_payable_cents',
      coalesce((SELECT sum(amount_cents) FROM public.comissoes WHERE status='AVAILABLE'), 0)
      + coalesce((SELECT sum(amount_cents) FROM public.withdrawal_commissions WHERE active), 0),
    'open_withdrawals',
      (SELECT count(*) FROM public.withdrawal_requests
       WHERE status IN ('PENDING_REVIEW','APPROVED','AWAITING_PAYMENT','MANUAL_REVIEW')),
    'pending_review_withdrawals',
      (SELECT count(*) FROM public.withdrawal_requests WHERE status='PENDING_REVIEW'),
    'paid_withdrawals',
      (SELECT count(*) FROM public.withdrawal_requests WHERE status='PAID'),
    'commission_count', (SELECT count(*) FROM public.comissoes),
    'payment_count',
      (SELECT count(*) FROM public.asaas_payments WHERE lower(status) IN ('paid','received'))
      + (SELECT count(*) FROM public.cakto_payments WHERE lower(status) IN ('paid','pago','approved','completed','confirmed'))
  ) INTO v_result;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_finance_withdrawals(
  p_scope text DEFAULT 'OPEN',
  p_search text DEFAULT NULL,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_bank text DEFAULT NULL,
  p_paid_by uuid DEFAULT NULL,
  p_user_type text DEFAULT NULL,
  p_min_cents bigint DEFAULT NULL,
  p_max_cents bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE v_uid uuid := auth.uid(); v_result jsonb; v_search text := public.normalize_whitespace(p_search);
BEGIN
  IF v_uid IS NULL OR NOT public.can_manage_withdrawals(v_uid, 'view') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='WITHDRAWAL_FORBIDDEN';
  END IF;
  SELECT coalesce(jsonb_agg(item ORDER BY (item->>'requested_at') DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id', w.id, 'user_id', w.user_id, 'requester_name', p.nome,
      'requester_email', p.email, 'user_type', w.user_type,
      'amount_cents', w.amount_cents, 'net_amount_cents', w.net_amount_cents,
      'bank_name', w.bank_name, 'holder_name', w.holder_name,
      'pix_key_type', w.pix_key_type, 'pix_key_masked', w.pix_key_masked,
      'status', w.status, 'requested_at', w.requested_at,
      'approved_at', w.approved_at, 'paid_at', w.paid_at,
      'paid_by', w.paid_by, 'paid_by_name', payer.nome,
      'rejection_reason', w.rejection_reason,
      'receipt_available', w.status='PAID' AND w.receipt_file_name IS NOT NULL,
      'contract_count', (SELECT count(*) FROM public.withdrawal_commissions wc WHERE wc.withdrawal_id=w.id)
    ) AS item
    FROM public.withdrawal_requests w
    JOIN public.profiles p ON p.id = w.user_id
    LEFT JOIN public.profiles payer ON payer.id = w.paid_by
    WHERE (
      upper(coalesce(p_scope, 'OPEN')) = 'ALL'
      OR (upper(coalesce(p_scope, 'OPEN')) = 'PAID' AND w.status = 'PAID')
      OR (upper(coalesce(p_scope, 'OPEN')) = 'OPEN' AND w.status <> 'PAID')
    )
      AND (p_start_date IS NULL OR w.requested_at::date >= p_start_date)
      AND (p_end_date IS NULL OR w.requested_at::date <= p_end_date)
      AND (nullif(public.normalize_whitespace(p_bank), '') IS NULL OR w.bank_name ILIKE '%' || public.normalize_whitespace(p_bank) || '%')
      AND (p_paid_by IS NULL OR w.paid_by = p_paid_by)
      AND (nullif(public.normalize_whitespace(p_user_type), '') IS NULL OR lower(w.user_type)=lower(public.normalize_whitespace(p_user_type)))
      AND (p_min_cents IS NULL OR w.amount_cents >= p_min_cents)
      AND (p_max_cents IS NULL OR w.amount_cents <= p_max_cents)
      AND (
        v_search = ''
        OR p.nome ILIKE '%' || v_search || '%'
        OR p.email ILIKE '%' || v_search || '%'
        OR w.pix_key_masked ILIKE '%' || v_search || '%'
        OR EXISTS (
          SELECT 1 FROM public.withdrawal_commissions wc
          JOIN public.apolices a ON a.id=wc.contract_id
          WHERE wc.withdrawal_id=w.id AND a.numero ILIKE '%' || v_search || '%'
        )
        OR w.pix_key_fingerprint = encode(digest(public.normalize_pix_key(w.pix_key_type, v_search), 'sha256'),'hex')
      )
    LIMIT 1000
  ) rows;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_finance_commissions()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_uid uuid := auth.uid(); v_result jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.can_manage_withdrawals(v_uid, 'view') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='WITHDRAWAL_FORBIDDEN';
  END IF;
  SELECT coalesce(jsonb_agg(item ORDER BY (item->>'created_at') DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id', c.id, 'user_id', c.beneficiario_id, 'user_name', p.nome,
      'user_email', p.email, 'user_type', c.beneficiario_tipo,
      'contract_id', c.contrato_id, 'contract_number', a.numero,
      'base_amount_cents', c.base_amount_cents,
      'percentage_applied', c.percentual_aplicado,
      'level_applied', c.nivel_aplicado,
      'amount_cents', c.amount_cents, 'status', c.status,
      'available_at', c.released_at, 'withdrawal_id', c.withdrawal_id,
      'created_at', c.created_at
    ) AS item
    FROM public.comissoes c
    JOIN public.profiles p ON p.id=c.beneficiario_id
    JOIN public.apolices a ON a.id=c.contrato_id
    ORDER BY c.created_at DESC
    LIMIT 2000
  ) rows;
  RETURN v_result;
END;
$$;

-- Somente as funções de intenção/consulta são expostas ao papel authenticated.
REVOKE ALL ON FUNCTION public.request_withdrawal(text,text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_withdrawal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_withdrawal(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_withdrawal_upload_context(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_withdrawal_as_paid(uuid,text,text,text,bigint,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_financial_summary() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_commissions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_withdrawals() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_commission_contracts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_withdrawal_details(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reveal_withdrawal_pix(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.authorize_withdrawal_receipt(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_finance_dashboard_summary() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_finance_withdrawals(text,text,date,date,text,uuid,text,bigint,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_finance_commissions() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.request_withdrawal(text,text,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_withdrawal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_withdrawal(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_withdrawal_upload_context(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_withdrawal_as_paid(uuid,text,text,text,bigint,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_financial_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_commissions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_withdrawals() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_commission_contracts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_withdrawal_details(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reveal_withdrawal_pix(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_withdrawal_receipt(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_finance_dashboard_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_finance_withdrawals(text,text,date,date,text,uuid,text,bigint,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_finance_commissions() TO authenticated;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
