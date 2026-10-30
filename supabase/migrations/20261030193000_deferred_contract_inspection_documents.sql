-- Permite concluir a contratação quando contrato de locação e/ou vistoria ainda
-- não estão prontos. O arquivo pendente é anexado depois pela área de Documentos
-- e a pendência é baixada de forma atômica.

CREATE OR REPLACE FUNCTION public.attach_deferred_proposal_document(
  p_consulta_id uuid,
  p_document_type text,
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
  v_uid uuid := auth.uid();
  v_consulta public.consultas_credito%ROWTYPE;
  v_apolice_id uuid;
  v_document public.documentos_proposta%ROWTYPE;
  v_file_name text := btrim(coalesce(p_file_name, ''));
  v_file_url text := btrim(coalesce(p_file_url, ''));
  v_file_type text := lower(btrim(coalesce(p_file_type, '')));
  v_document_type text := lower(btrim(coalesce(p_document_type, '')));
  v_expected_prefix text;
  v_pending_key text;
  v_ready_key text;
  v_metadata jsonb;
  v_required jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UNAUTHENTICATED';
  END IF;

  IF v_document_type NOT IN ('contrato_locacao', 'vistoria_imovel') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_DEFERRED_DOCUMENT_TYPE';
  END IF;

  v_pending_key := CASE v_document_type
    WHEN 'contrato_locacao' THEN 'contrato_locacao_pendencia'
    ELSE 'vistoria_imovel_pendencia'
  END;
  v_ready_key := CASE v_document_type
    WHEN 'contrato_locacao' THEN 'contrato_locacao_pronto'
    ELSE 'vistoria_imovel_pronta'
  END;

  -- Serializa dois cliques simultâneos para a mesma pendência sem criar uma
  -- restrição global que pudesse invalidar documentos históricos legítimos.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_consulta_id::text || ':' || v_document_type, 0));

  SELECT consulta.*
  INTO v_consulta
  FROM public.consultas_credito consulta
  WHERE consulta.id = p_consulta_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'CONSULTATION_NOT_FOUND';
  END IF;

  IF NOT (
    public.eh_dono_ou_imobiliaria_da_consulta(v_consulta.profile_id_solicitante)
    OR public.eh_staff_interno_consultas()
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'DEFERRED_DOCUMENT_UPLOAD_FORBIDDEN';
  END IF;

  SELECT apolice.id
  INTO v_apolice_id
  FROM public.apolices apolice
  WHERE apolice.consulta_id = p_consulta_id
  ORDER BY apolice.created_at DESC
  LIMIT 1;

  IF v_apolice_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'POLICY_NOT_CREATED';
  END IF;

  v_metadata := coalesce(v_consulta.documentos, '{}'::jsonb) #> '{dados_complementares}';
  v_metadata := coalesce(v_metadata, '{}'::jsonb);
  IF nullif(btrim(coalesce(v_metadata ->> v_pending_key, '')), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'DEFERRED_DOCUMENT_NOT_PENDING';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.documentos_proposta documento
    WHERE documento.consulta_id = p_consulta_id
      AND documento.document_type = v_document_type
      AND documento.contract_signature_id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'DEFERRED_DOCUMENT_ALREADY_ATTACHED';
  END IF;

  IF v_file_name = '' OR char_length(v_file_name) > 255 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_FILE_NAME';
  END IF;

  IF v_file_type NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_FILE_TYPE';
  END IF;

  v_expected_prefix := v_uid::text || '/' || p_consulta_id::text || '/' || v_document_type || '-';
  IF v_file_url = '' OR strpos(v_file_url, v_expected_prefix) <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_FILE_PATH';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects objeto
    WHERE objeto.bucket_id IN ('approval-documents', 'anexos', 'documentos-proposta')
      AND objeto.name = v_file_url
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'UPLOADED_FILE_NOT_FOUND';
  END IF;

  INSERT INTO public.documentos_proposta (
    consulta_id,
    apolice_id,
    tenant_user_id,
    file_name,
    file_url,
    file_type,
    document_type,
    document_subtype,
    uploaded_by
  ) VALUES (
    p_consulta_id,
    v_apolice_id,
    v_consulta.tenant_user_id,
    v_file_name,
    v_file_url,
    v_file_type,
    v_document_type,
    CASE WHEN v_document_type = 'contrato_locacao' THEN 'assinado_todas_partes' ELSE NULL END,
    v_uid
  )
  RETURNING * INTO v_document;

  v_metadata := jsonb_set(v_metadata, ARRAY[v_ready_key], 'true'::jsonb, true);
  v_metadata := jsonb_set(v_metadata, ARRAY[v_pending_key], 'null'::jsonb, true);
  IF v_document_type = 'contrato_locacao' THEN
    v_metadata := jsonb_set(v_metadata, '{contrato_locacao_assinado}', 'true'::jsonb, true);
  END IF;
  v_required := coalesce(v_metadata -> 'documentos_obrigatorios', '[]'::jsonb);
  IF NOT v_required @> jsonb_build_array(v_document_type) THEN
    v_required := v_required || jsonb_build_array(v_document_type);
  END IF;
  v_metadata := jsonb_set(v_metadata, '{documentos_obrigatorios}', v_required, true);

  UPDATE public.consultas_credito
  SET documentos = jsonb_set(
    coalesce(documentos, '{}'::jsonb),
    '{dados_complementares}',
    v_metadata,
    true
  )
  WHERE id = p_consulta_id;

  INSERT INTO public.proposta_historico (
    consulta_id,
    tipo_evento,
    descricao,
    metadata,
    created_by
  ) VALUES (
    p_consulta_id,
    'documento_pendente_anexado',
    CASE v_document_type
      WHEN 'contrato_locacao' THEN 'Contrato de locação pendente anexado em Documentos.'
      ELSE 'Vistoria do imóvel pendente anexada em Documentos.'
    END,
    jsonb_build_object('document_type', v_document_type, 'document_id', v_document.id),
    v_uid
  );

  RETURN v_document;
END;
$$;

REVOKE ALL ON FUNCTION public.attach_deferred_proposal_document(uuid, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attach_deferred_proposal_document(uuid, text, text, text, text)
  TO authenticated;

COMMENT ON FUNCTION public.attach_deferred_proposal_document(uuid, text, text, text, text) IS
  'Anexa contrato de locacao ou vistoria previamente adiados e baixa a pendencia de forma atomica.';

-- Mantém compatibilidade com contratos antigos enviados como "não assinados",
-- mas atualiza a linguagem e baixa a pendência armazenada na consulta.
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
  v_uid uuid := auth.uid();
  v_document public.documentos_proposta%ROWTYPE;
  v_updated public.documentos_proposta%ROWTYPE;
  v_file_name text := btrim(coalesce(p_file_name, ''));
  v_file_url text := btrim(coalesce(p_file_url, ''));
  v_file_type text := lower(btrim(coalesce(p_file_type, '')));
  v_expected_prefix text;
  v_apolice_id uuid;
  v_metadata jsonb;
  v_required jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UNAUTHENTICATED';
  END IF;

  SELECT documento.*
  INTO v_document
  FROM public.documentos_proposta documento
  WHERE documento.id = p_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'DOCUMENT_NOT_FOUND';
  END IF;

  IF v_document.document_type IS DISTINCT FROM 'contrato_locacao'
     OR v_document.document_subtype IS DISTINCT FROM 'pendente_assinatura' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'DOCUMENT_ALREADY_REPLACED';
  END IF;

  IF NOT public.can_edit_unsigned_lease_document(v_uid, p_document_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'DOCUMENT_REPLACEMENT_FORBIDDEN';
  END IF;

  IF v_file_name = '' OR char_length(v_file_name) > 255 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_FILE_NAME';
  END IF;

  IF v_file_type NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_FILE_TYPE';
  END IF;

  v_expected_prefix := v_uid::text || '/' || v_document.consulta_id::text || '/contrato_locacao-';
  IF v_file_url = '' OR strpos(v_file_url, v_expected_prefix) <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_FILE_PATH';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects objeto
    WHERE objeto.bucket_id IN ('approval-documents', 'anexos', 'documentos-proposta')
      AND objeto.name = v_file_url
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'UPLOADED_FILE_NOT_FOUND';
  END IF;

  SELECT apolice.id
  INTO v_apolice_id
  FROM public.apolices apolice
  WHERE apolice.consulta_id = v_document.consulta_id
  ORDER BY apolice.created_at DESC
  LIMIT 1;

  UPDATE public.documentos_proposta
  SET apolice_id = coalesce(apolice_id, v_apolice_id),
      file_name = v_file_name,
      file_url = v_file_url,
      file_type = v_file_type,
      uploaded_by = v_uid,
      document_subtype = 'assinado_imobiliaria'
  WHERE id = p_document_id
  RETURNING * INTO v_updated;

  SELECT coalesce(consulta.documentos, '{}'::jsonb) #> '{dados_complementares}'
  INTO v_metadata
  FROM public.consultas_credito consulta
  WHERE consulta.id = v_document.consulta_id
  FOR UPDATE;
  v_metadata := coalesce(v_metadata, '{}'::jsonb);
  v_metadata := jsonb_set(v_metadata, '{contrato_locacao_pronto}', 'true'::jsonb, true);
  v_metadata := jsonb_set(v_metadata, '{contrato_locacao_assinado}', 'true'::jsonb, true);
  v_metadata := jsonb_set(v_metadata, '{contrato_locacao_pendencia}', 'null'::jsonb, true);
  v_required := coalesce(v_metadata -> 'documentos_obrigatorios', '[]'::jsonb);
  IF NOT v_required @> '["contrato_locacao"]'::jsonb THEN
    v_required := v_required || '["contrato_locacao"]'::jsonb;
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

  INSERT INTO public.proposta_historico (
    consulta_id,
    tipo_evento,
    descricao,
    metadata,
    created_by
  ) VALUES (
    v_document.consulta_id,
    'documento_pendente_anexado',
    'Contrato de locação pendente atualizado em Documentos.',
    jsonb_build_object('document_type', 'contrato_locacao', 'document_id', v_updated.id),
    v_uid
  );

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_unsigned_lease_document(uuid, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_unsigned_lease_document(uuid, text, text, text)
  TO authenticated;

COMMENT ON FUNCTION public.replace_unsigned_lease_document(uuid, text, text, text) IS
  'Substitui uma unica vez um contrato pendente pelo arquivo pronto e baixa a pendencia da consulta.';
