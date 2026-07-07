
-- Ampliar status permitidos
ALTER TABLE public.consultas_credito DROP CONSTRAINT IF EXISTS consultas_credito_status_check;
ALTER TABLE public.consultas_credito ADD CONSTRAINT consultas_credito_status_check
  CHECK (status = ANY (ARRAY['aprovado','pendente','reprovado','pendente_documentacao','dados_complementares','finalizada','aguardando_ativacao','ativado']));

-- Campos de ativação
ALTER TABLE public.consultas_credito
  ADD COLUMN IF NOT EXISTS activation_token text UNIQUE,
  ADD COLUMN IF NOT EXISTS activation_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS activation_cpf_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS activation_last_access_at timestamptz,
  ADD COLUMN IF NOT EXISTS activation_status text DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS activation_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS biometria_status text DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS biometria_image_url text,
  ADD COLUMN IF NOT EXISTS biometria_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS contract_accepted boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS contract_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_ip text,
  ADD COLUMN IF NOT EXISTS accepted_user_agent text,
  ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS payment_confirmed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_consultas_activation_token ON public.consultas_credito(activation_token) WHERE activation_token IS NOT NULL;

-- Função segura para validar token + CPF (acessível sem auth via RPC)
CREATE OR REPLACE FUNCTION public.validar_ativacao_token(_token text, _cpf text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.consultas_credito%ROWTYPE;
  v_cpf_norm text;
  v_stored_cpf text;
BEGIN
  IF _token IS NULL OR length(_token) < 16 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'token_invalido');
  END IF;

  SELECT * INTO v_row FROM public.consultas_credito WHERE activation_token = _token LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'token_nao_encontrado');
  END IF;

  IF v_row.activation_token_expires_at IS NOT NULL AND v_row.activation_token_expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'token_expirado');
  END IF;

  IF v_row.activation_status = 'concluido' OR v_row.status = 'ativado' THEN
    RETURN jsonb_build_object('ok', true, 'already_active', true, 'consulta_id', v_row.id);
  END IF;

  IF v_row.activation_cpf_attempts >= 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bloqueado_tentativas');
  END IF;

  v_cpf_norm := regexp_replace(coalesce(_cpf,''), '\D', '', 'g');
  v_stored_cpf := regexp_replace(coalesce(v_row.tenant_document,''), '\D', '', 'g');

  IF length(v_cpf_norm) <> 11 OR v_cpf_norm <> v_stored_cpf THEN
    UPDATE public.consultas_credito
      SET activation_cpf_attempts = activation_cpf_attempts + 1
      WHERE id = v_row.id;
    RETURN jsonb_build_object('ok', false, 'error', 'cpf_invalido');
  END IF;

  UPDATE public.consultas_credito
    SET activation_last_access_at = now(),
        activation_cpf_attempts = 0
    WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'ok', true,
    'consulta_id', v_row.id,
    'tenant_name', v_row.tenant_name,
    'tenant_email', v_row.tenant_email,
    'property_address', v_row.property_address,
    'rent_value', v_row.rent_value,
    'valor_premio_mensal', v_row.valor_premio_mensal,
    'insurance_payment_method', v_row.insurance_payment_method,
    'insurance_payment_method_label', v_row.insurance_payment_method_label,
    'biometria_status', v_row.biometria_status,
    'contract_accepted', v_row.contract_accepted,
    'payment_status', v_row.payment_status,
    'activation_status', v_row.activation_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validar_ativacao_token(text, text) TO anon, authenticated;

-- Função has_role usada nos checks padrão
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND role::text = _role);
$$;
