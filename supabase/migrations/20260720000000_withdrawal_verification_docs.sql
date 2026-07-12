-- ============================================================================
-- Documento de identidade (frente/verso/segurando o documento) no detalhe do
-- saque: get_withdrawal_details() passa a incluir metadados de
-- verificacoes_documento (sem os paths, só presença/status), e uma nova RPC
-- authorize_withdrawal_verification_docs() — no mesmo molde de
-- authorize_withdrawal_receipt() — libera os paths reais só pra quem já pode
-- gerenciar o saque (dono ou can_manage_withdrawals), pra assinatura de URL
-- feita pela edge function withdrawal-verification-docs.
-- ============================================================================

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
    'verification', (
      SELECT jsonb_build_object(
        'document_type', vd.document_type,
        'verification_status', vd.verification_status,
        'has_front', vd.document_front_url IS NOT NULL,
        'has_back', vd.document_back_url IS NOT NULL,
        'has_holder_photo', vd.selfie_url IS NOT NULL,
        'submitted_at', vd.submitted_at
      ) FROM public.verificacoes_documento vd WHERE vd.user_id = v_w.user_id
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

-- ---------------------------------------------------------------------------
-- Autoriza a leitura dos paths reais de documentos de identidade do
-- solicitante de um saque (não expostos por get_withdrawal_details). Usada
-- pela edge function withdrawal-verification-docs pra gerar signed URLs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.authorize_withdrawal_verification_docs(p_withdrawal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_w public.withdrawal_requests%ROWTYPE;
  v_doc public.verificacoes_documento%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION USING ERRCODE='28000', MESSAGE='WITHDRAWAL_AUTH_REQUIRED'; END IF;
  SELECT * INTO v_w FROM public.withdrawal_requests WHERE id = p_withdrawal_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;
  IF v_w.user_id <> v_uid AND NOT public.can_manage_withdrawals(v_uid, 'view') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='WITHDRAWAL_FORBIDDEN';
  END IF;

  SELECT * INTO v_doc FROM public.verificacoes_documento WHERE user_id = v_w.user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VERIFICATION_NOT_FOUND');
  END IF;

  PERFORM private.add_financial_audit(
    v_uid, 'WITHDRAWAL_VERIFICATION_DOCS_VIEWED', v_w.id, NULL, NULL, NULL, NULL, NULL, NULL
  );

  RETURN jsonb_build_object(
    'ok', true,
    'front_path', v_doc.document_front_url,
    'back_path', v_doc.document_back_url,
    'holder_photo_path', v_doc.selfie_url
  );
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_withdrawal_verification_docs(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.authorize_withdrawal_verification_docs(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_withdrawal_verification_docs(uuid) TO service_role;
