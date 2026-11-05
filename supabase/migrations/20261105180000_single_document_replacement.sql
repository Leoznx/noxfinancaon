-- Permite corrigir uma unica vez cada documento do dossie da apolice.
-- O limite fica no banco (e nao apenas no botao) e a via manual assinada da
-- Apolice - NOX continua sujeita aos mesmos requisitos de pagamento/ativacao.

ALTER TABLE public.documentos_proposta
  ADD COLUMN IF NOT EXISTS replacement_count smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS replaced_at timestamptz,
  ADD COLUMN IF NOT EXISTS replaced_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'documentos_proposta_single_replacement_check'
      AND conrelid = 'public.documentos_proposta'::regclass
  ) THEN
    ALTER TABLE public.documentos_proposta
      ADD CONSTRAINT documentos_proposta_single_replacement_check
      CHECK (replacement_count BETWEEN 0 AND 1) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.contract_signatures
  ADD COLUMN IF NOT EXISTS manual_signed_file_url text,
  ADD COLUMN IF NOT EXISTS manual_signed_file_bucket text,
  ADD COLUMN IF NOT EXISTS manual_signed_file_name text,
  ADD COLUMN IF NOT EXISTS manual_signed_uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.replace_proposal_document_once(
  p_document_id uuid,
  p_file_name text,
  p_file_url text,
  p_file_type text
)
RETURNS public.documentos_proposta
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_document public.documentos_proposta%ROWTYPE;
  v_updated public.documentos_proposta%ROWTYPE;
  v_consulta public.consultas_credito%ROWTYPE;
  v_signature public.contract_signatures%ROWTYPE;
  v_file_name text := btrim(coalesce(p_file_name, ''));
  v_file_url text := btrim(coalesce(p_file_url, ''));
  v_file_type text := lower(btrim(coalesce(p_file_type, '')));
  v_file_bucket text;
  v_expected_prefix text;
  v_replacement_prefix text;
  v_is_policy_document boolean;
  v_event_description text;
  v_metadata jsonb;
  v_required jsonb;
  v_pending_key text;
  v_ready_key text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UNAUTHENTICATED';
  END IF;

  SELECT document.*
  INTO v_document
  FROM public.documentos_proposta AS document
  WHERE document.id = p_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'DOCUMENT_NOT_FOUND';
  END IF;

  IF v_document.consulta_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'DOCUMENT_WITHOUT_CONSULTATION';
  END IF;

  SELECT consultation.*
  INTO v_consulta
  FROM public.consultas_credito AS consultation
  WHERE consultation.id = v_document.consulta_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'CONSULTATION_NOT_FOUND';
  END IF;

  IF NOT (
    public.eh_dono_ou_imobiliaria_da_consulta(v_consulta.profile_id_solicitante)
    OR public.eh_staff_interno_consultas()
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'DOCUMENT_REPLACEMENT_FORBIDDEN';
  END IF;

  IF coalesce(v_document.replacement_count, 0) >= 1 THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'DOCUMENT_ALREADY_REPLACED';
  END IF;

  v_is_policy_document := v_document.contract_signature_id IS NOT NULL;
  IF NOT v_is_policy_document AND coalesce(v_document.document_type, '') NOT IN (
    'contrato_locacao',
    'vistoria_imovel',
    'comprovante_residencia',
    'comprovante_residencia_imovel',
    'documento_foto',
    'documento_inquilino'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DOCUMENT_TYPE_NOT_REPLACEABLE';
  END IF;

  IF v_is_policy_document THEN
    SELECT signature.*
    INTO v_signature
    FROM public.contract_signatures AS signature
    WHERE signature.id = v_document.contract_signature_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'CONTRACT_SIGNATURE_NOT_FOUND';
    END IF;

    IF v_signature.status IN ('signed', 'active')
       OR v_signature.signature_status = 'signed'
       OR v_signature.signed_at IS NOT NULL
       OR v_document.document_subtype IN ('contratos-assinados', 'assinado_manual') THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POLICY_DOCUMENT_ALREADY_SIGNED';
    END IF;
    IF v_signature.status = 'cancelled'
       OR v_signature.signature_status = 'cancelled'
       OR lower(coalesce(v_consulta.policy_status, '')) = 'cancelled'
       OR lower(coalesce(v_consulta.status, '')) IN ('cancelado', 'cancelada', 'cancelled') THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POLICY_DOCUMENT_CANCELLED';
    END IF;
  END IF;

  IF v_file_name = '' OR char_length(v_file_name) > 255 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_FILE_NAME';
  END IF;

  IF v_file_type NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_FILE_TYPE';
  END IF;
  IF v_is_policy_document AND v_file_type <> 'application/pdf' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SIGNED_POLICY_MUST_BE_PDF';
  END IF;

  v_replacement_prefix := CASE
    WHEN v_is_policy_document THEN 'apolice_nox'
    ELSE v_document.document_type
  END;
  v_expected_prefix := v_uid::text || '/' || v_document.consulta_id::text || '/' || v_replacement_prefix || '-';
  IF v_file_url = '' OR strpos(v_file_url, v_expected_prefix) <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_FILE_PATH';
  END IF;

  SELECT object.bucket_id
  INTO v_file_bucket
  FROM storage.objects AS object
  WHERE object.bucket_id IN ('approval-documents', 'anexos', 'documentos-proposta')
    AND object.name = v_file_url
  ORDER BY CASE object.bucket_id
    WHEN 'approval-documents' THEN 1
    WHEN 'anexos' THEN 2
    ELSE 3
  END
  LIMIT 1;

  IF v_file_bucket IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'UPLOADED_FILE_NOT_FOUND';
  END IF;

  UPDATE public.documentos_proposta
  SET file_name = v_file_name,
      file_url = v_file_url,
      file_type = v_file_type,
      uploaded_by = v_uid,
      replacement_count = 1,
      replaced_at = now(),
      replaced_by = v_uid,
      document_subtype = CASE
        WHEN v_is_policy_document THEN 'assinado_manual'
        WHEN v_document.document_type = 'contrato_locacao' THEN 'assinado_imobiliaria'
        ELSE document_subtype
      END,
      apolice_id = coalesce(
        apolice_id,
        (
          SELECT policy.id
          FROM public.apolices AS policy
          WHERE policy.consulta_id = v_document.consulta_id
          ORDER BY policy.created_at DESC
          LIMIT 1
        )
      )
  WHERE id = p_document_id
  RETURNING * INTO v_updated;

  IF v_document.document_type IN ('contrato_locacao', 'vistoria_imovel') THEN
    v_pending_key := CASE v_document.document_type
      WHEN 'contrato_locacao' THEN 'contrato_locacao_pendencia'
      ELSE 'vistoria_imovel_pendencia'
    END;
    v_ready_key := CASE v_document.document_type
      WHEN 'contrato_locacao' THEN 'contrato_locacao_pronto'
      ELSE 'vistoria_imovel_pronta'
    END;
    v_metadata := coalesce(v_consulta.documentos, '{}'::jsonb) #> '{dados_complementares}';
    v_metadata := coalesce(v_metadata, '{}'::jsonb);
    v_metadata := jsonb_set(v_metadata, ARRAY[v_ready_key], 'true'::jsonb, true);
    v_metadata := jsonb_set(v_metadata, ARRAY[v_pending_key], 'null'::jsonb, true);
    IF v_document.document_type = 'contrato_locacao' THEN
      v_metadata := jsonb_set(v_metadata, '{contrato_locacao_assinado}', 'true'::jsonb, true);
    END IF;
    v_required := coalesce(v_metadata -> 'documentos_obrigatorios', '[]'::jsonb);
    IF NOT v_required @> jsonb_build_array(v_document.document_type) THEN
      v_required := v_required || jsonb_build_array(v_document.document_type);
    END IF;
    v_metadata := jsonb_set(v_metadata, '{documentos_obrigatorios}', v_required, true);

    UPDATE public.consultas_credito
    SET documentos = jsonb_set(
      coalesce(documentos, '{}'::jsonb),
      '{dados_complementares}',
      v_metadata,
      true
    )
    WHERE id = v_document.consulta_id;
  END IF;

  IF v_is_policy_document THEN
    UPDATE public.contract_signatures
    SET status = CASE WHEN status = 'active' THEN status ELSE 'signed' END,
        signature_status = 'signed',
        signed_at = coalesce(signed_at, now()),
        manual_signed_file_url = v_file_url,
        manual_signed_file_bucket = v_file_bucket,
        manual_signed_file_name = v_file_name,
        manual_signed_uploaded_by = v_uid,
        error_code = NULL,
        error_message = NULL
    WHERE id = v_document.contract_signature_id;

    UPDATE public.consultas_credito
    SET signature_status = 'signed',
        contract_accepted = true,
        contract_accepted_at = coalesce(contract_accepted_at, now()),
        status = CASE
          WHEN lower(coalesce(status, '')) IN ('ativado', 'ativada', 'active') THEN status
          WHEN lower(coalesce(payment_state, payment_status, '')) IN (
            'confirmed', 'paid', 'received', 'recebido', 'pago', 'approved'
          ) THEN status
          ELSE 'aguardando_ativacao'
        END,
        substatus = CASE
          WHEN lower(coalesce(status, '')) IN ('ativado', 'ativada', 'active') THEN substatus
          WHEN lower(coalesce(payment_state, payment_status, '')) IN (
            'confirmed', 'paid', 'received', 'recebido', 'pago', 'approved'
          ) THEN substatus
          ELSE 'assinatura_concluida_aguardando_pagamento'
        END,
        activation_status = CASE
          WHEN lower(coalesce(status, '')) IN ('ativado', 'ativada', 'active') THEN activation_status
          WHEN lower(coalesce(payment_state, payment_status, '')) IN (
            'confirmed', 'paid', 'received', 'recebido', 'pago', 'approved'
          ) THEN activation_status
          ELSE 'aguardando_pagamento'
        END,
        policy_status = CASE
          WHEN lower(coalesce(policy_status, '')) IN ('active', 'cancelled') THEN policy_status
          ELSE 'issued_pending'
        END
    WHERE id = v_document.consulta_id;
  END IF;

  v_event_description := CASE
    WHEN v_is_policy_document THEN 'Apólice - NOX assinada anexada manualmente em Documentos.'
    WHEN v_document.document_type = 'contrato_locacao' THEN 'Contrato de locação substituído em Documentos.'
    WHEN v_document.document_type = 'vistoria_imovel' THEN 'Vistoria do imóvel substituída em Documentos.'
    WHEN v_document.document_type IN ('comprovante_residencia', 'comprovante_residencia_imovel')
      THEN 'Comprovante de residência substituído em Documentos.'
    ELSE 'Documento com foto substituído em Documentos.'
  END;

  INSERT INTO public.proposta_historico (
    consulta_id,
    tipo_evento,
    descricao,
    metadata,
    created_by
  ) VALUES (
    v_document.consulta_id,
    CASE WHEN v_is_policy_document THEN 'apolice_nox_assinada_manual' ELSE 'documento_substituido' END,
    v_event_description,
    jsonb_build_object(
      'document_id', v_updated.id,
      'document_type', v_updated.document_type,
      'replacement_count', v_updated.replacement_count
    ),
    v_uid
  );

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_proposal_document_once(uuid, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_proposal_document_once(uuid, text, text, text)
  TO authenticated;

COMMENT ON FUNCTION public.replace_proposal_document_once(uuid, text, text, text) IS
  'Substitui uma unica vez um documento elegivel do dossie e registra a via manual assinada da Apolice - NOX.';

-- Clientes antigos continuam funcionando, mas passam pelo mesmo contador
-- atomico, impedindo uma segunda troca ao alternar entre site e aplicativo.
CREATE OR REPLACE FUNCTION public.replace_unsigned_lease_document(
  p_document_id uuid,
  p_file_name text,
  p_file_url text,
  p_file_type text
)
RETURNS public.documentos_proposta
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated public.documentos_proposta%ROWTYPE;
BEGIN
  SELECT replacement.*
  INTO v_updated
  FROM public.replace_proposal_document_once(
    p_document_id,
    p_file_name,
    p_file_url,
    p_file_type
  ) AS replacement;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_unsigned_lease_document(uuid, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_unsigned_lease_document(uuid, text, text, text)
  TO authenticated;

COMMENT ON FUNCTION public.replace_unsigned_lease_document(uuid, text, text, text) IS
  'Compatibilidade: substitui uma unica vez o contrato de locacao usando a regra geral do dossie.';
