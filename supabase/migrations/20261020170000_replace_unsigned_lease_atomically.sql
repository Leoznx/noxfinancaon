-- Finaliza a substituicao do contrato de locacao em uma unica operacao.
--
-- A policy anterior validava o estado novo com a mesma funcao usada para o
-- estado antigo. Ao trocar pendente_assinatura por assinado_imobiliaria, o
-- WITH CHECK deixava de ser verdadeiro e o Postgres rejeitava a atualizacao
-- depois que o arquivo ja tinha sido enviado ao Storage.

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

  UPDATE public.documentos_proposta
  SET file_name = v_file_name,
      file_url = v_file_url,
      file_type = v_file_type,
      uploaded_by = v_uid,
      document_subtype = 'assinado_imobiliaria'
  WHERE id = p_document_id
  RETURNING * INTO v_updated;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_unsigned_lease_document(uuid, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_unsigned_lease_document(uuid, text, text, text)
  TO authenticated;

-- Solicitantes e imobiliarias passam a atualizar o documento exclusivamente
-- pela funcao atomica acima. A policy administrativa de manutencao permanece.
DROP POLICY IF EXISTS "Proposal owner edits unsigned lease document"
  ON public.documentos_proposta;

COMMENT ON FUNCTION public.replace_unsigned_lease_document(uuid, text, text, text) IS
  'Substitui uma unica vez um contrato de locacao pendente pelo arquivo assinado ja enviado ao Storage.';
