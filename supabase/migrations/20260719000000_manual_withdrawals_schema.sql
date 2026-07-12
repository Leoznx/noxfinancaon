-- Sistema canônico de saque manual de comissões.
--
-- Esta migration preserva os UUIDs e o histórico da tabela legada
-- `solicitacoes_saque`, fecha os caminhos de escrita direta encontrados na
-- auditoria e passa a representar dinheiro em centavos. Nenhuma transferência
-- Pix/Asaas é criada aqui: o pagamento da comissão continua sendo manual.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- A chave simétrica fica fora do schema exposto pela API. Apenas funções
-- SECURITY DEFINER abaixo conseguem lê-la. Isso também permite criptografar os
-- registros legados na própria migration, antes de apagar a coluna plaintext.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.withdrawal_crypto_secrets (
  key_version integer PRIMARY KEY,
  secret text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.withdrawal_crypto_secrets FROM PUBLIC, anon, authenticated;

INSERT INTO private.withdrawal_crypto_secrets (key_version, secret, active)
SELECT 1, encode(extensions.gen_random_bytes(32), 'hex'), true
WHERE NOT EXISTS (SELECT 1 FROM private.withdrawal_crypto_secrets);

CREATE OR REPLACE FUNCTION private.withdrawal_crypto_key(_version integer DEFAULT NULL)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, pg_catalog
AS $$
  SELECT secret
  FROM private.withdrawal_crypto_secrets
  WHERE (_version IS NULL AND active) OR key_version = _version
  ORDER BY CASE WHEN _version IS NULL THEN active ELSE true END DESC, key_version DESC
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION private.withdrawal_crypto_key(integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.normalize_whitespace(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT trim(regexp_replace(coalesce(_value, ''), '\s+', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.normalize_pix_key(_type text, _value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE upper(trim(coalesce(_type, '')))
    WHEN 'CPF' THEN regexp_replace(coalesce(_value, ''), '\D', '', 'g')
    WHEN 'CNPJ' THEN regexp_replace(coalesce(_value, ''), '\D', '', 'g')
    WHEN 'EMAIL' THEN lower(regexp_replace(trim(coalesce(_value, '')), '\s+', '', 'g'))
    WHEN 'E-MAIL' THEN lower(regexp_replace(trim(coalesce(_value, '')), '\s+', '', 'g'))
    WHEN 'PHONE' THEN regexp_replace(coalesce(_value, ''), '\D', '', 'g')
    WHEN 'TELEFONE' THEN regexp_replace(coalesce(_value, ''), '\D', '', 'g')
    ELSE trim(coalesce(_value, ''))
  END
$$;

CREATE OR REPLACE FUNCTION public.mask_pix_key(_type text, _value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  v_type text := upper(trim(coalesce(_type, '')));
  v text := public.normalize_pix_key(_type, _value);
  v_at integer;
BEGIN
  IF v_type = 'CPF' THEN
    RETURN '***.***.***-' || right(v, 2);
  ELSIF v_type = 'CNPJ' THEN
    RETURN '**.***.***/****-' || right(v, 2);
  ELSIF v_type IN ('EMAIL', 'E-MAIL') THEN
    v_at := strpos(v, '@');
    IF v_at > 1 THEN
      RETURN left(v, 1) || '***' || substr(v, v_at);
    END IF;
    RETURN '***';
  ELSIF v_type IN ('PHONE', 'TELEFONE') THEN
    RETURN '(**) *****-' || right(v, 4);
  ELSE
    IF length(v) <= 8 THEN RETURN left(v, 2) || '****' || right(v, 2); END IF;
    RETURN left(v, 4) || '****-****-****-****-********' || right(v, 4);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Autorização canônica para as ações de saque.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_manage_withdrawals(
  _uid uuid,
  _action text DEFAULT 'view'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT coalesce(
    public.is_admin(_uid)
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = _uid
        AND (
          p.role::text IN ('admin', 'admin_master')
          OR (
            p.role::text = 'financeiro'
            AND NOT EXISTS (
              SELECT 1 FROM public.internal_users legacy_internal
              WHERE legacy_internal.auth_user_id = _uid
            )
          )
        )
    )
    OR public.has_internal_role(_uid, 'admin_master'::public.internal_role)
    OR EXISTS (
      SELECT 1
      FROM public.internal_users iu
      JOIN public.role_permissions rp
        ON rp.role = iu.role
       AND rp.module IN ('financeiro', 'saques')
      WHERE iu.auth_user_id = _uid
        AND iu.status::text = 'ativo'
        AND iu.role = 'financeiro'::public.internal_role
        AND rp.can_view
        AND (
          lower(coalesce(_action, 'view')) IN ('view', 'list', 'receipt')
          OR rp.can_approve
        )
    ),
    false
  )
$$;
REVOKE ALL ON FUNCTION public.can_manage_withdrawals(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_withdrawals(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_audit_withdrawals(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT coalesce(
    public.is_admin(_uid)
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = _uid AND role::text IN ('admin', 'admin_master')
    )
    OR public.has_internal_role(_uid, 'admin_master'::public.internal_role),
    false
  )
$$;
REVOKE ALL ON FUNCTION public.can_audit_withdrawals(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_audit_withdrawals(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_view_policy(_uid uuid, _policy_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.apolices a
    LEFT JOIN public.consultas_credito q ON q.id = a.consulta_id
    WHERE a.id = _policy_id
      AND (
        a.corretor_profile_id = _uid
        OR a.imobiliaria_profile_id = _uid
        OR a.proprietario_profile_id = _uid
        OR q.profile_id_solicitante = _uid
        OR q.tenant_user_id = _uid
        OR q.billing_responsible_user_id = _uid
        OR public.can_manage_withdrawals(_uid, 'view')
        OR EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = _uid AND p.role::text IN ('analista', 'juridico')
        )
        OR public.has_internal_role(_uid, 'juridico'::public.internal_role)
      )
  )
$$;
REVOKE ALL ON FUNCTION public.can_view_policy(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_policy(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Corte das policies abertas que permitiam a anônimos forjar um pagamento e,
-- por consequência, liberar uma comissão.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.apolices FROM anon;
REVOKE ALL ON public.mensalidades FROM anon;
REVOKE ALL ON public.comissoes FROM anon;

DROP POLICY IF EXISTS "App reads apolices" ON public.apolices;
DROP POLICY IF EXISTS "App inserts apolices" ON public.apolices;
DROP POLICY IF EXISTS "App updates apolices" ON public.apolices;
DROP POLICY IF EXISTS "Admins possess full access on apolices" ON public.apolices;
DROP POLICY IF EXISTS "Corretor vê só suas apólices" ON public.apolices;

DROP POLICY IF EXISTS "App reads mensalidades" ON public.mensalidades;
DROP POLICY IF EXISTS "App inserts mensalidades" ON public.mensalidades;
DROP POLICY IF EXISTS "App updates mensalidades" ON public.mensalidades;
DROP POLICY IF EXISTS "Users view relevant mensalidades" ON public.mensalidades;

REVOKE INSERT, UPDATE, DELETE ON public.apolices FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.mensalidades FROM authenticated;
GRANT SELECT ON public.apolices, public.mensalidades TO authenticated;

CREATE POLICY "Policy participants and authorized staff read policies"
  ON public.apolices FOR SELECT TO authenticated
  USING (public.can_view_policy(auth.uid(), id));

CREATE POLICY "Authorized admins manage policies"
  ON public.apolices FOR ALL TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.has_internal_role(auth.uid(), 'admin_master'::public.internal_role)
  );

CREATE POLICY "Policy participants and authorized staff read installments"
  ON public.mensalidades FOR SELECT TO authenticated
  USING (public.can_view_policy(auth.uid(), apolice_id));

-- ---------------------------------------------------------------------------
-- Evolução da fonte legada, sem criar uma segunda tabela mutável.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.withdrawal_requests') IS NULL
     AND to_regclass('public.solicitacoes_saque') IS NOT NULL THEN
    ALTER TABLE public.solicitacoes_saque RENAME TO withdrawal_requests;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'withdrawal_requests' AND column_name = 'profile_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'withdrawal_requests' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.withdrawal_requests RENAME COLUMN profile_id TO user_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'withdrawal_requests' AND column_name = 'perfil_tipo'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'withdrawal_requests' AND column_name = 'user_type'
  ) THEN
    ALTER TABLE public.withdrawal_requests RENAME COLUMN perfil_tipo TO user_type;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'withdrawal_requests' AND column_name = 'pix_tipo'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'withdrawal_requests' AND column_name = 'pix_key_type'
  ) THEN
    ALTER TABLE public.withdrawal_requests RENAME COLUMN pix_tipo TO pix_key_type;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'withdrawal_requests' AND column_name = 'aprovado_por'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'withdrawal_requests' AND column_name = 'approved_by'
  ) THEN
    ALTER TABLE public.withdrawal_requests RENAME COLUMN aprovado_por TO approved_by;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'withdrawal_requests' AND column_name = 'aprovado_em'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'withdrawal_requests' AND column_name = 'approved_at'
  ) THEN
    ALTER TABLE public.withdrawal_requests RENAME COLUMN aprovado_em TO approved_at;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'withdrawal_requests' AND column_name = 'pago_por'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'withdrawal_requests' AND column_name = 'paid_by'
  ) THEN
    ALTER TABLE public.withdrawal_requests RENAME COLUMN pago_por TO paid_by;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'withdrawal_requests' AND column_name = 'pago_em'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'withdrawal_requests' AND column_name = 'paid_at'
  ) THEN
    ALTER TABLE public.withdrawal_requests RENAME COLUMN pago_em TO paid_at;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'withdrawal_requests' AND column_name = 'motivo_rejeicao'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'withdrawal_requests' AND column_name = 'rejection_reason'
  ) THEN
    ALTER TABLE public.withdrawal_requests RENAME COLUMN motivo_rejeicao TO rejection_reason;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'withdrawal_requests' AND column_name = 'observacoes_internas'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'withdrawal_requests' AND column_name = 'internal_notes'
  ) THEN
    ALTER TABLE public.withdrawal_requests RENAME COLUMN observacoes_internas TO internal_notes;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'withdrawal_requests' AND column_name = 'comprovante_url'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'withdrawal_requests' AND column_name = 'legacy_receipt_url'
  ) THEN
    ALTER TABLE public.withdrawal_requests RENAME COLUMN comprovante_url TO legacy_receipt_url;
  END IF;
END $$;

ALTER TABLE public.withdrawal_requests
  DROP CONSTRAINT IF EXISTS solicitacoes_saque_status_check,
  DROP CONSTRAINT IF EXISTS withdrawal_requests_status_check,
  DROP CONSTRAINT IF EXISTS solicitacoes_saque_pix_tipo_check,
  DROP CONSTRAINT IF EXISTS withdrawal_requests_pix_key_type_check;

ALTER TABLE public.withdrawal_requests
  ADD COLUMN IF NOT EXISTS amount_cents bigint,
  ADD COLUMN IF NOT EXISTS fee_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount_cents bigint,
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS holder_name text,
  ADD COLUMN IF NOT EXISTS pix_key_encrypted bytea,
  ADD COLUMN IF NOT EXISTS pix_key_masked text,
  ADD COLUMN IF NOT EXISTS pix_key_fingerprint text,
  ADD COLUMN IF NOT EXISTS pix_key_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS receipt_path text,
  ADD COLUMN IF NOT EXISTS receipt_file_name text,
  ADD COLUMN IF NOT EXISTS receipt_mime_type text,
  ADD COLUMN IF NOT EXISTS receipt_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS receipt_sha256 text,
  ADD COLUMN IF NOT EXISTS receipt_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS receipt_uploaded_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS payment_notes text,
  ADD COLUMN IF NOT EXISTS idempotency_key uuid,
  ADD COLUMN IF NOT EXISTS requires_manual_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Converte os valores legados antes de remover as colunas decimais/PIX aberto.
UPDATE public.withdrawal_requests
SET
  amount_cents = coalesce(amount_cents, round(coalesce(valor_bruto, 0) * 100)::bigint),
  fee_cents = coalesce(round(coalesce(taxa_saque, 0) * 100)::bigint, 0),
  net_amount_cents = coalesce(net_amount_cents, round(coalesce(valor_liquido, valor_bruto, 0) * 100)::bigint),
  requested_at = coalesce(requested_at, created_at),
  reviewed_at = coalesce(reviewed_at, approved_at),
  idempotency_key = coalesce(idempotency_key, gen_random_uuid()),
  pix_key_type = CASE lower(trim(coalesce(pix_key_type, '')))
    WHEN 'cpf' THEN 'CPF'
    WHEN 'cnpj' THEN 'CNPJ'
    WHEN 'email' THEN 'EMAIL'
    WHEN 'e-mail' THEN 'EMAIL'
    WHEN 'telefone' THEN 'PHONE'
    WHEN 'phone' THEN 'PHONE'
    ELSE 'RANDOM'
  END,
  status = CASE upper(trim(coalesce(status, '')))
    WHEN 'PENDENTE' THEN 'PENDING_REVIEW'
    WHEN 'PENDING_REVIEW' THEN 'PENDING_REVIEW'
    WHEN 'APROVADA' THEN 'AWAITING_PAYMENT'
    WHEN 'APROVADO' THEN 'AWAITING_PAYMENT'
    WHEN 'APPROVED' THEN 'AWAITING_PAYMENT'
    WHEN 'AWAITING_PAYMENT' THEN 'AWAITING_PAYMENT'
    WHEN 'PAGA' THEN 'PAID'
    WHEN 'PAGO' THEN 'PAID'
    WHEN 'PAID' THEN 'PAID'
    WHEN 'REJEITADA' THEN 'REJECTED'
    WHEN 'REJEITADO' THEN 'REJECTED'
    WHEN 'REJECTED' THEN 'REJECTED'
    WHEN 'CANCELADA' THEN 'CANCELLED'
    WHEN 'CANCELADO' THEN 'CANCELLED'
    WHEN 'CANCELLED' THEN 'CANCELLED'
    WHEN 'MANUAL_REVIEW' THEN 'MANUAL_REVIEW'
    ELSE 'MANUAL_REVIEW'
  END;

-- Usa a diferença efetivamente registrada entre bruto/líquido no histórico
-- legado. Isso reconcilia a divergência antiga (migration R$ 3,20 x frontend
-- R$ 3,50) sem inventar uma nova taxa; todo saque novo terá fee_cents = 0.
UPDATE public.withdrawal_requests
SET
  net_amount_cents = least(amount_cents, coalesce(net_amount_cents, amount_cents)),
  fee_cents = amount_cents - least(amount_cents, coalesce(net_amount_cents, amount_cents));

UPDATE public.withdrawal_requests w
SET
  bank_name = coalesce(
    nullif(public.normalize_whitespace(w.bank_name), ''),
    (
      SELECT nullif(public.normalize_whitespace(d.bank_name), '')
      FROM public.dados_financeiros_recebimento d
      WHERE d.user_id = w.user_id AND d.financial_data_status = 'ativo'
      LIMIT 1
    ),
    'Não informado — registro legado'
  ),
  holder_name = coalesce(
    nullif(public.normalize_whitespace(w.holder_name), ''),
    (
      SELECT nullif(public.normalize_whitespace(d.receiver_full_name), '')
      FROM public.dados_financeiros_recebimento d
      WHERE d.user_id = w.user_id AND d.financial_data_status = 'ativo'
      LIMIT 1
    ),
    (SELECT p.nome FROM public.profiles p WHERE p.id = w.user_id),
    'Titular não identificado — registro legado'
  ),
  requires_manual_review = w.requires_manual_review OR NOT EXISTS (
    SELECT 1
    FROM public.dados_financeiros_recebimento d
    WHERE d.user_id = w.user_id
      AND d.financial_data_status = 'ativo'
      AND nullif(public.normalize_whitespace(d.bank_name), '') IS NOT NULL
      AND nullif(public.normalize_whitespace(d.receiver_full_name), '') IS NOT NULL
  );

-- A coluna pix_chave é NOT NULL no legado. O UPDATE criptografa e cria apenas
-- máscara/fingerprint; em seguida a coluna aberta é removida definitivamente.
UPDATE public.withdrawal_requests
SET
  pix_key_encrypted = coalesce(
    pix_key_encrypted,
    extensions.pgp_sym_encrypt(
      public.normalize_pix_key(pix_key_type, pix_chave),
      private.withdrawal_crypto_key(pix_key_version),
      'cipher-algo=aes256,compress-algo=1'
    )
  ),
  pix_key_masked = coalesce(
    pix_key_masked,
    public.mask_pix_key(pix_key_type, pix_chave)
  ),
  pix_key_fingerprint = coalesce(
    pix_key_fingerprint,
    encode(extensions.digest(public.normalize_pix_key(pix_key_type, pix_chave), 'sha256'), 'hex')
  );

UPDATE public.withdrawal_requests
SET status = 'MANUAL_REVIEW'
WHERE requires_manual_review
  AND status IN ('PENDING_REVIEW', 'APPROVED', 'AWAITING_PAYMENT');

ALTER TABLE public.withdrawal_requests
  ALTER COLUMN amount_cents SET NOT NULL,
  ALTER COLUMN net_amount_cents SET NOT NULL,
  ALTER COLUMN bank_name SET NOT NULL,
  ALTER COLUMN holder_name SET NOT NULL,
  ALTER COLUMN pix_key_type SET NOT NULL,
  ALTER COLUMN pix_key_encrypted SET NOT NULL,
  ALTER COLUMN pix_key_masked SET NOT NULL,
  ALTER COLUMN pix_key_fingerprint SET NOT NULL,
  ALTER COLUMN requested_at SET NOT NULL,
  ALTER COLUMN idempotency_key SET NOT NULL,
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.withdrawal_requests
  ADD CONSTRAINT withdrawal_requests_amount_positive CHECK (amount_cents > 0),
  ADD CONSTRAINT withdrawal_requests_fee_nonnegative CHECK (fee_cents >= 0),
  ADD CONSTRAINT withdrawal_requests_net_consistent CHECK (net_amount_cents = amount_cents - fee_cents),
  ADD CONSTRAINT withdrawal_requests_status_check CHECK (
    status IN (
      'PENDING_REVIEW', 'APPROVED', 'AWAITING_PAYMENT', 'PAID',
      'REJECTED', 'CANCELLED', 'MANUAL_REVIEW'
    )
  ),
  ADD CONSTRAINT withdrawal_requests_pix_type_check CHECK (
    pix_key_type IN ('CPF', 'CNPJ', 'EMAIL', 'PHONE', 'RANDOM')
  ),
  ADD CONSTRAINT withdrawal_requests_receipt_metadata_check CHECK (
    status <> 'PAID'
    OR (
      receipt_path IS NOT NULL
      AND receipt_file_name IS NOT NULL
      AND receipt_mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
      AND receipt_size_bytes BETWEEN 1 AND 10485760
      AND receipt_sha256 ~ '^[0-9a-f]{64}$'
      AND paid_at IS NOT NULL
      AND paid_by IS NOT NULL
    )
  );

ALTER TABLE public.withdrawal_requests
  DROP COLUMN IF EXISTS pix_chave,
  DROP COLUMN IF EXISTS valor_bruto,
  DROP COLUMN IF EXISTS taxa_saque,
  DROP COLUMN IF EXISTS valor_liquido;

-- Se o legado já contiver mais de uma solicitação ativa para a mesma pessoa,
-- preserva todas, mas encerra as mais antigas de modo explícito antes de criar
-- a restrição que passa a impedir a reincidência.
WITH ranked_active AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id
      ORDER BY requested_at DESC, created_at DESC, id DESC
    ) AS position
  FROM public.withdrawal_requests
  WHERE status IN ('PENDING_REVIEW', 'APPROVED', 'AWAITING_PAYMENT', 'MANUAL_REVIEW')
)
UPDATE public.withdrawal_requests w
SET
  status = 'CANCELLED',
  cancelled_at = coalesce(w.cancelled_at, now()),
  requires_manual_review = true,
  internal_notes = concat_ws(
    E'\n',
    nullif(w.internal_notes, ''),
    'Encerrado na migração por duplicidade de solicitação ativa legada.'
  ),
  updated_at = now()
FROM ranked_active r
WHERE r.id = w.id AND r.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_requests_user_idempotency_uq
  ON public.withdrawal_requests(user_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_requests_one_active_per_user_uq
  ON public.withdrawal_requests(user_id)
  WHERE status IN ('PENDING_REVIEW', 'APPROVED', 'AWAITING_PAYMENT', 'MANUAL_REVIEW');
CREATE INDEX IF NOT EXISTS withdrawal_requests_status_requested_idx
  ON public.withdrawal_requests(status, requested_at DESC);
CREATE INDEX IF NOT EXISTS withdrawal_requests_user_requested_idx
  ON public.withdrawal_requests(user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS withdrawal_requests_pix_fingerprint_idx
  ON public.withdrawal_requests(pix_key_fingerprint);

DELETE FROM public.configuracoes_sistema WHERE chave = 'taxa_saque_brl';

-- ---------------------------------------------------------------------------
-- Comissões: centavos, snapshots e estados canônicos.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'comissoes' AND column_name = 'solicitacao_saque_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'comissoes' AND column_name = 'withdrawal_id'
  ) THEN
    ALTER TABLE public.comissoes RENAME COLUMN solicitacao_saque_id TO withdrawal_id;
  END IF;
END $$;

ALTER TABLE public.comissoes
  DROP CONSTRAINT IF EXISTS comissoes_status_check;

ALTER TABLE public.comissoes
  ADD COLUMN IF NOT EXISTS base_amount_cents bigint,
  ADD COLUMN IF NOT EXISTS amount_cents bigint,
  ADD COLUMN IF NOT EXISTS source_event_key text,
  ADD COLUMN IF NOT EXISTS release_event_id text,
  ADD COLUMN IF NOT EXISTS released_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversal_reason text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.comissoes
SET
  amount_cents = coalesce(amount_cents, round(valor * 100)::bigint),
  base_amount_cents = coalesce(
    base_amount_cents,
    CASE
      WHEN coalesce(percentual_aplicado, 0) > 0
        THEN round((valor / percentual_aplicado) * 10000)::bigint
      ELSE round(valor * 100)::bigint
    END
  ),
  source_event_key = coalesce(source_event_key, 'legacy:' || id::text),
  released_at = coalesce(released_at, disponivel_em),
  paid_at = coalesce(paid_at, sacada_em),
  status = CASE upper(trim(coalesce(status, '')))
    WHEN 'PENDENTE' THEN 'PENDING'
    WHEN 'PENDING' THEN 'PENDING'
    WHEN 'DISPONIVEL' THEN 'AVAILABLE'
    WHEN 'DISPONÍVEL' THEN 'AVAILABLE'
    WHEN 'AVAILABLE' THEN 'AVAILABLE'
    WHEN 'RESERVED' THEN 'RESERVED'
    WHEN 'RESERVADA' THEN 'RESERVED'
    WHEN 'SACADA' THEN 'PAID'
    WHEN 'PAGA' THEN 'PAID'
    WHEN 'PAID' THEN 'PAID'
    WHEN 'CANCELADA' THEN 'REVERSED'
    WHEN 'ESTORNADA' THEN 'REVERSED'
    WHEN 'REVERSED' THEN 'REVERSED'
    WHEN 'MANUAL_REVIEW' THEN 'MANUAL_REVIEW'
    ELSE 'MANUAL_REVIEW'
  END;

ALTER TABLE public.comissoes
  ALTER COLUMN amount_cents SET NOT NULL,
  ALTER COLUMN base_amount_cents SET NOT NULL,
  ALTER COLUMN source_event_key SET NOT NULL,
  ALTER COLUMN status SET NOT NULL,
  ADD CONSTRAINT comissoes_amount_cents_positive CHECK (amount_cents > 0),
  ADD CONSTRAINT comissoes_base_amount_cents_nonnegative CHECK (base_amount_cents >= 0),
  ADD CONSTRAINT comissoes_status_check CHECK (
    status IN ('PENDING', 'AVAILABLE', 'RESERVED', 'PAID', 'REVERSED', 'MANUAL_REVIEW')
  );

CREATE UNIQUE INDEX IF NOT EXISTS comissoes_source_event_uq
  ON public.comissoes(source_event_key);
CREATE INDEX IF NOT EXISTS comissoes_beneficiary_status_cents_idx
  ON public.comissoes(beneficiario_id, status, created_at);

DROP POLICY IF EXISTS "Admins possess full access on comissoes" ON public.comissoes;
DROP POLICY IF EXISTS "Corretor vê só suas comissões" ON public.comissoes;
DROP POLICY IF EXISTS "Users can view own comissoes" ON public.comissoes;
DROP POLICY IF EXISTS "usuario_ve_proprias_comissoes" ON public.comissoes;
DROP POLICY IF EXISTS "admin_ve_todas_comissoes" ON public.comissoes;
REVOKE INSERT, UPDATE, DELETE ON public.comissoes FROM authenticated;
GRANT SELECT ON public.comissoes TO authenticated;
CREATE POLICY "Users read own commissions and finance reads all"
  ON public.comissoes FOR SELECT TO authenticated
  USING (
    beneficiario_id = auth.uid()
    OR public.can_manage_withdrawals(auth.uid(), 'view')
  );

-- Snapshot imutável que liga exatamente as comissões/contratos ao saque.
CREATE TABLE IF NOT EXISTS public.withdrawal_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_id uuid NOT NULL REFERENCES public.withdrawal_requests(id) ON DELETE RESTRICT,
  commission_id uuid NOT NULL REFERENCES public.comissoes(id) ON DELETE RESTRICT,
  contract_id uuid NOT NULL REFERENCES public.apolices(id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  base_amount_cents bigint NOT NULL CHECK (base_amount_cents >= 0),
  percentage_applied numeric(7,4),
  level_applied text,
  active boolean NOT NULL DEFAULT true,
  released_at timestamptz,
  release_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(withdrawal_id, commission_id)
);

INSERT INTO public.withdrawal_commissions (
  withdrawal_id, commission_id, contract_id, amount_cents,
  base_amount_cents, percentage_applied, level_applied, active, released_at, release_reason
)
SELECT
  c.withdrawal_id,
  c.id,
  c.contrato_id,
  c.amount_cents,
  c.base_amount_cents,
  c.percentual_aplicado,
  c.nivel_aplicado,
  w.status NOT IN ('PAID', 'REJECTED', 'CANCELLED'),
  CASE WHEN w.status IN ('PAID', 'REJECTED', 'CANCELLED')
    THEN coalesce(w.paid_at, w.rejected_at, w.cancelled_at, w.updated_at)
    ELSE NULL
  END,
  CASE WHEN w.status = 'PAID' THEN 'PAID'
       WHEN w.status = 'REJECTED' THEN 'REJECTED'
       WHEN w.status = 'CANCELLED' THEN 'CANCELLED'
       ELSE NULL END
FROM public.comissoes c
JOIN public.withdrawal_requests w ON w.id = c.withdrawal_id
ON CONFLICT (withdrawal_id, commission_id) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_commissions_one_active_commission_uq
  ON public.withdrawal_commissions(commission_id)
  WHERE active;
CREATE INDEX IF NOT EXISTS withdrawal_commissions_withdrawal_idx
  ON public.withdrawal_commissions(withdrawal_id);
CREATE INDEX IF NOT EXISTS withdrawal_commissions_contract_idx
  ON public.withdrawal_commissions(contract_id);

WITH linked AS (
  SELECT withdrawal_id, sum(amount_cents)::bigint AS linked_cents
  FROM public.withdrawal_commissions
  GROUP BY withdrawal_id
)
UPDATE public.withdrawal_requests w
SET
  status = CASE
    WHEN w.status IN ('PENDING_REVIEW', 'APPROVED', 'AWAITING_PAYMENT') THEN 'MANUAL_REVIEW'
    ELSE w.status
  END,
  requires_manual_review = true,
  updated_at = now()
FROM linked l
WHERE l.withdrawal_id = w.id
  AND l.linked_cents <> w.amount_cents;

UPDATE public.withdrawal_requests w
SET
  status = 'MANUAL_REVIEW',
  requires_manual_review = true,
  updated_at = now()
WHERE w.status IN ('PENDING_REVIEW', 'APPROVED', 'AWAITING_PAYMENT')
  AND NOT EXISTS (
    SELECT 1 FROM public.withdrawal_commissions wc WHERE wc.withdrawal_id = w.id
  );

-- ---------------------------------------------------------------------------
-- Auditoria financeira e razão de movimentações (auditoria != saldo).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.financial_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  withdrawal_id uuid REFERENCES public.withdrawal_requests(id) ON DELETE SET NULL,
  commission_id uuid REFERENCES public.comissoes(id) ON DELETE SET NULL,
  contract_id uuid REFERENCES public.apolices(id) ON DELETE SET NULL,
  previous_status text,
  new_status text,
  amount_cents bigint,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS financial_audit_withdrawal_idx
  ON public.financial_audit_logs(withdrawal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS financial_audit_actor_idx
  ON public.financial_audit_logs(actor_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.commission_financial_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  withdrawal_id uuid REFERENCES public.withdrawal_requests(id) ON DELETE RESTRICT,
  commission_id uuid REFERENCES public.comissoes(id) ON DELETE RESTRICT,
  contract_id uuid REFERENCES public.apolices(id) ON DELETE RESTRICT,
  entry_type text NOT NULL CHECK (
    entry_type IN (
      'COMMISSION_CREATED', 'COMMISSION_RELEASED', 'WITHDRAWAL_RESERVED',
      'WITHDRAWAL_RELEASED', 'WITHDRAWAL_PAID', 'REVERSAL', 'ADJUSTMENT_REQUIRED'
    )
  ),
  amount_cents bigint NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commission_ledger_user_idx
  ON public.commission_financial_ledger(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS commission_ledger_withdrawal_idx
  ON public.commission_financial_ledger(withdrawal_id, created_at DESC);

ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_financial_ledger ENABLE ROW LEVEL SECURITY;

-- Todas as policies legadas da tabela renomeada são removidas explicitamente.
DROP POLICY IF EXISTS "Users can manage own saques" ON public.withdrawal_requests;
DROP POLICY IF EXISTS "usuario_ve_proprios_saques" ON public.withdrawal_requests;
DROP POLICY IF EXISTS "usuario_cria_proprio_saque" ON public.withdrawal_requests;
DROP POLICY IF EXISTS "admin_gerencia_saques" ON public.withdrawal_requests;
DROP POLICY IF EXISTS "saques financeiro" ON public.withdrawal_requests;

REVOKE ALL ON public.withdrawal_requests FROM anon, authenticated;
REVOKE ALL ON public.withdrawal_commissions FROM anon, authenticated;
REVOKE ALL ON public.financial_audit_logs FROM anon, authenticated;
REVOKE ALL ON public.commission_financial_ledger FROM anon, authenticated;

GRANT SELECT (
  id, user_id, user_type, amount_cents, fee_cents, net_amount_cents, status,
  bank_name, holder_name, pix_key_type, pix_key_masked, requested_at,
  reviewed_at, reviewed_by, approved_at, approved_by, paid_at, paid_by,
  rejected_at, rejected_by, rejection_reason, cancelled_at, cancelled_by,
  receipt_file_name, receipt_mime_type, receipt_size_bytes, receipt_uploaded_at,
  payment_notes, created_at, updated_at, requires_manual_review
) ON public.withdrawal_requests TO authenticated;
GRANT SELECT ON public.withdrawal_commissions TO authenticated;
GRANT SELECT ON public.commission_financial_ledger TO authenticated;
GRANT SELECT ON public.financial_audit_logs TO authenticated;

CREATE POLICY "Users read own withdrawals and finance reads all"
  ON public.withdrawal_requests FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.can_manage_withdrawals(auth.uid(), 'view')
  );

CREATE POLICY "Users read own withdrawal links and finance reads all"
  ON public.withdrawal_commissions FOR SELECT TO authenticated
  USING (
    public.can_manage_withdrawals(auth.uid(), 'view')
    OR EXISTS (
      SELECT 1 FROM public.withdrawal_requests w
      WHERE w.id = withdrawal_commissions.withdrawal_id
        AND w.user_id = auth.uid()
    )
  );

CREATE POLICY "Users read own ledger and finance reads all"
  ON public.commission_financial_ledger FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.can_manage_withdrawals(auth.uid(), 'view')
  );

CREATE POLICY "Admins read financial audit"
  ON public.financial_audit_logs FOR SELECT TO authenticated
  USING (public.can_audit_withdrawals(auth.uid()));

-- ---------------------------------------------------------------------------
-- Gatilhos de integridade e compatibilidade somente leitura.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_financial_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS withdrawal_requests_updated_at ON public.withdrawal_requests;
CREATE TRIGGER withdrawal_requests_updated_at
  BEFORE UPDATE ON public.withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_financial_updated_at();

DROP TRIGGER IF EXISTS comissoes_financial_updated_at ON public.comissoes;
CREATE TRIGGER comissoes_financial_updated_at
  BEFORE UPDATE ON public.comissoes
  FOR EACH ROW EXECUTE FUNCTION public.set_financial_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_withdrawal_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  IF OLD.status = 'PENDING_REVIEW'
     AND NEW.status IN ('APPROVED', 'AWAITING_PAYMENT', 'REJECTED', 'CANCELLED', 'MANUAL_REVIEW') THEN
    RETURN NEW;
  ELSIF OLD.status = 'APPROVED'
     AND NEW.status IN ('AWAITING_PAYMENT', 'REJECTED', 'CANCELLED', 'MANUAL_REVIEW') THEN
    RETURN NEW;
  ELSIF OLD.status = 'AWAITING_PAYMENT'
     AND NEW.status IN ('PAID', 'REJECTED', 'CANCELLED', 'MANUAL_REVIEW') THEN
    RETURN NEW;
  ELSIF OLD.status = 'MANUAL_REVIEW'
     AND NEW.status IN ('PENDING_REVIEW', 'APPROVED', 'AWAITING_PAYMENT', 'REJECTED', 'CANCELLED') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '23514',
    MESSAGE = format('WITHDRAWAL_INVALID_TRANSITION:%s:%s', OLD.status, NEW.status);
END;
$$;

DROP TRIGGER IF EXISTS enforce_withdrawal_status_transition ON public.withdrawal_requests;
CREATE TRIGGER enforce_withdrawal_status_transition
  BEFORE UPDATE OF status ON public.withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_withdrawal_status_transition();

DROP VIEW IF EXISTS public.saldos_comissao;
CREATE VIEW public.saldos_comissao
WITH (security_invoker = true)
AS
SELECT
  p.id AS profile_id,
  p.nome,
  p.role AS tipo_perfil,
  coalesce(sum(c.amount_cents) FILTER (WHERE c.status IN ('PENDING', 'MANUAL_REVIEW')), 0)::numeric / 100 AS saldo_pendente,
  coalesce(sum(c.amount_cents) FILTER (WHERE c.status = 'AVAILABLE'), 0)::numeric / 100 AS saldo_disponivel,
  coalesce((
    SELECT sum(w.amount_cents)
    FROM public.withdrawal_requests w
    WHERE w.user_id = p.id AND w.status = 'PAID'
  ), 0)::numeric / 100 AS total_sacado,
  coalesce(sum(c.amount_cents) FILTER (WHERE c.status <> 'REVERSED'), 0)::numeric / 100 AS total_acumulado
FROM public.profiles p
LEFT JOIN public.comissoes c ON c.beneficiario_id = p.id
WHERE p.id = auth.uid() OR public.can_manage_withdrawals(auth.uid(), 'view')
GROUP BY p.id, p.nome, p.role;
GRANT SELECT ON public.saldos_comissao TO authenticated;

-- Compatibilidade para integrações antigas: leitura apenas, chave sempre
-- mascarada e sem URL pública de comprovante. O app novo usa withdrawal_requests.
DROP VIEW IF EXISTS public.solicitacoes_saque;
CREATE VIEW public.solicitacoes_saque
WITH (security_invoker = true)
AS
SELECT
  id,
  user_id AS profile_id,
  user_type AS perfil_tipo,
  amount_cents::numeric / 100 AS valor_bruto,
  fee_cents::numeric / 100 AS taxa_saque,
  net_amount_cents::numeric / 100 AS valor_liquido,
  pix_key_masked AS pix_chave,
  lower(pix_key_type) AS pix_tipo,
  status,
  approved_by AS aprovado_por,
  approved_at AS aprovado_em,
  paid_by AS pago_por,
  paid_at AS pago_em,
  NULL::text AS comprovante_url,
  rejection_reason AS motivo_rejeicao,
  NULL::text AS observacoes_internas,
  created_at
FROM public.withdrawal_requests;
REVOKE ALL ON public.solicitacoes_saque FROM anon, authenticated;
GRANT SELECT ON public.solicitacoes_saque TO authenticated;

-- ---------------------------------------------------------------------------
-- Bucket privado. Não existe policy de INSERT/SELECT direto: as Edge Functions
-- autenticadas usam service role, emitem URL assinada curta e auditam o acesso.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'withdrawal-receipts',
  'withdrawal-receipts',
  false,
  10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Anyone authenticated can view proofs" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload proofs" ON storage.objects;
DROP POLICY IF EXISTS "withdrawal_receipts_read" ON storage.objects;
DROP POLICY IF EXISTS "withdrawal_receipts_insert" ON storage.objects;
DROP POLICY IF EXISTS "withdrawal_receipts_update" ON storage.objects;
DROP POLICY IF EXISTS "withdrawal_receipts_delete" ON storage.objects;

-- Realtime é usado apenas para invalidar/atualizar as telas; a RLS continua
-- determinando quais linhas cada usuário consegue receber.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'withdrawal_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.withdrawal_requests;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'comissoes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.comissoes;
  END IF;
END $$;

ALTER TABLE public.withdrawal_requests REPLICA IDENTITY FULL;
ALTER TABLE public.comissoes REPLICA IDENTITY FULL;

GRANT ALL ON public.withdrawal_requests, public.withdrawal_commissions,
  public.financial_audit_logs, public.commission_financial_ledger TO service_role;
