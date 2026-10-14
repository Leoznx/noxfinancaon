-- Permite ao solicitante (ou à imobiliária responsável) substituir o contrato
-- de locação enquanto ele continua marcado como não assinado. O arquivo deixa
-- de ser editável assim que a assinatura D4Sign é concluída.

CREATE OR REPLACE FUNCTION public.can_edit_unsigned_lease_document(
  _uid uuid,
  _document_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT _uid IS NOT NULL
    AND _uid = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.documentos_proposta documento
      JOIN public.consultas_credito consulta
        ON consulta.id = documento.consulta_id
      WHERE documento.id = _document_id
        AND documento.document_type = 'contrato_locacao'
        AND documento.document_subtype = 'pendente_assinatura'
        AND (
          public.eh_dono_ou_imobiliaria_da_consulta(consulta.profile_id_solicitante)
          OR public.eh_staff_interno_consultas()
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.contract_signatures assinatura
          WHERE assinatura.consultation_id = consulta.id
            AND (
              assinatura.status IN ('signed', 'active')
              OR assinatura.signature_status = 'signed'
              OR assinatura.signed_at IS NOT NULL
            )
        )
    )
$$;

REVOKE ALL ON FUNCTION public.can_edit_unsigned_lease_document(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_edit_unsigned_lease_document(uuid, uuid)
  TO authenticated, service_role;

DROP POLICY IF EXISTS "Consultation participants read proposal documents"
  ON public.documentos_proposta;
CREATE POLICY "Consultation participants read proposal documents"
  ON public.documentos_proposta
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.consultas_credito consulta
      WHERE consulta.id = documentos_proposta.consulta_id
        AND (
          public.eh_dono_ou_imobiliaria_da_consulta(consulta.profile_id_solicitante)
          OR consulta.tenant_user_id = auth.uid()
          OR public.eh_staff_interno_consultas()
          OR EXISTS (
            SELECT 1
            FROM public.apolices apolice
            WHERE apolice.consulta_id = consulta.id
              AND public.can_view_policy(auth.uid(), apolice.id)
          )
        )
    )
  );

DROP POLICY IF EXISTS "Proposal owner edits unsigned lease document"
  ON public.documentos_proposta;
CREATE POLICY "Proposal owner edits unsigned lease document"
  ON public.documentos_proposta
  FOR UPDATE
  TO authenticated
  USING (public.can_edit_unsigned_lease_document(auth.uid(), id))
  WITH CHECK (public.can_edit_unsigned_lease_document(auth.uid(), id));

-- A imobiliária responsável também precisa enxergar o estado da assinatura
-- das consultas criadas pelos seus corretores.
DROP POLICY IF EXISTS "contract_signatures_select_related"
  ON public.contract_signatures;
CREATE POLICY "contract_signatures_select_related"
  ON public.contract_signatures
  FOR SELECT
  TO authenticated
  USING (
    tenant_user_id = auth.uid()
    OR public.is_internal(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.consultas_credito consulta
      WHERE consulta.id = contract_signatures.consultation_id
        AND (
          public.eh_dono_ou_imobiliaria_da_consulta(consulta.profile_id_solicitante)
          OR EXISTS (
            SELECT 1
            FROM public.apolices apolice
            WHERE apolice.consulta_id = consulta.id
              AND public.can_view_policy(auth.uid(), apolice.id)
          )
        )
    )
  );

-- Os documentos da proposta usam o caminho <uploader>/<consulta>/<arquivo>.
-- A leitura abaixo mantém o bucket privado e libera apenas participantes da
-- consulta. O upload de substituição continua limitado às policies existentes
-- do próprio usuário.
DROP POLICY IF EXISTS "Policy participants read proposal document files"
  ON storage.objects;
CREATE POLICY "Policy participants read proposal document files"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id IN ('approval-documents', 'anexos', 'documentos-proposta')
    AND EXISTS (
      SELECT 1
      FROM public.consultas_credito consulta
      WHERE consulta.id::text = (storage.foldername(name))[2]
        AND (
          public.eh_dono_ou_imobiliaria_da_consulta(consulta.profile_id_solicitante)
          OR consulta.tenant_user_id = auth.uid()
          OR public.eh_staff_interno_consultas()
          OR EXISTS (
            SELECT 1
            FROM public.apolices apolice
            WHERE apolice.consulta_id = consulta.id
              AND public.can_view_policy(auth.uid(), apolice.id)
          )
        )
    )
  );

DROP POLICY IF EXISTS "tenant_reads_signed_contracts" ON storage.objects;
CREATE POLICY "tenant_reads_signed_contracts"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'contratos-assinados'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_internal(auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.consultas_credito consulta
        WHERE consulta.id::text = (storage.foldername(name))[2]
          AND (
            consulta.tenant_user_id = auth.uid()
            OR public.eh_dono_ou_imobiliaria_da_consulta(consulta.profile_id_solicitante)
            OR EXISTS (
              SELECT 1
              FROM public.apolices apolice
              WHERE apolice.consulta_id = consulta.id
                AND public.can_view_policy(auth.uid(), apolice.id)
            )
          )
      )
    )
  );
