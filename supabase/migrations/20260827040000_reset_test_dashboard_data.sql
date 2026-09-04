-- Limpeza segura e reutilizavel dos dados criados por contas de teste/demo.
--
-- A funcao preserva auth.users, profiles e os cadastros-base de cada papel. Assim
-- as contas demonstrativas continuam acessiveis, mas seus dashboards voltam ao
-- estado inicial. O modo padrao e somente de previa; a exclusao exige p_execute.

CREATE OR REPLACE FUNCTION public.reset_nox_test_dashboards(p_execute boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, storage, pg_temp
AS $$
DECLARE
  v_preview jsonb;
  v_test_profile_count integer;
  v_test_consultation_count integer;
  v_total_consultation_count integer;
BEGIN
  -- As tabelas temporarias tambem tornam a limpeza atomica: qualquer erro causa
  -- rollback integral, sem deixar um contrato apagado pela metade.
  CREATE TEMP TABLE _nox_test_profiles ON COMMIT DROP AS
  SELECT p.id, lower(coalesce(p.email, '')) AS email
  FROM public.profiles p
  WHERE lower(coalesce(p.email, '')) IN (
      'corretor@nox.com',
      'imobiliaria@nox.com',
      'proprietario@nox.com',
      'inquilino@nox.com'
    )
    OR lower(coalesce(p.email, '')) ~ '(^|[+._-])(test|teste|demo|mock|qa)([+._@-]|$)'
    OR lower(coalesce(p.nome, '')) ~ '\m(test|teste|demo|mock)\M';

  SELECT count(*) INTO v_test_profile_count FROM _nox_test_profiles;
  IF v_test_profile_count = 0 OR v_test_profile_count > 30 THEN
    RAISE EXCEPTION
      'Limpeza cancelada: quantidade inesperada de perfis de teste (%).',
      v_test_profile_count;
  END IF;

  CREATE TEMP TABLE _nox_test_internal_users ON COMMIT DROP AS
  SELECT internal_user.id
  FROM public.internal_users AS internal_user
  JOIN _nox_test_profiles AS profile
    ON profile.id = internal_user.auth_user_id;

  CREATE TEMP TABLE _nox_test_consultations ON COMMIT DROP AS
  SELECT consultation.id, consultation.imovel_id, consultation.inquilino_id
  FROM public.consultas_credito AS consultation
  WHERE consultation.profile_id_solicitante IN (SELECT id FROM _nox_test_profiles)
    OR consultation.tenant_user_id IN (SELECT id FROM _nox_test_profiles)
    OR lower(coalesce(consultation.tenant_email, '')) IN (SELECT email FROM _nox_test_profiles)
    OR lower(coalesce(consultation.tenant_email, '')) ~ '(^|[+._-])(test|teste|demo|mock|qa)([+._@-]|$)'
    OR lower(coalesce(consultation.tenant_name, '')) ~ '\m(test|teste|demo|mock)\M'
    OR regexp_replace(coalesce(consultation.tenant_document, ''), '\D', '', 'g') IN (
      '99999999999', '88888888888', '00000000000'
    )
    OR regexp_replace(coalesce(consultation.documento, ''), '\D', '', 'g') IN (
      '99999999999', '88888888888', '00000000000'
    )
    OR lower(coalesce(consultation.automacao_origem, '')) = 'mock'
    OR lower(coalesce(consultation.origem, '')) IN ('demo', 'teste', 'test', 'mock');

  SELECT count(*) INTO v_test_consultation_count FROM _nox_test_consultations;
  SELECT count(*) INTO v_total_consultation_count FROM public.consultas_credito;
  IF v_test_consultation_count > 500
    OR (
      v_total_consultation_count > 0
      AND v_test_consultation_count = v_total_consultation_count
    )
  THEN
    RAISE EXCEPTION
      'Limpeza cancelada: o conjunto de consultas de teste e amplo demais (% de %).',
      v_test_consultation_count,
      v_total_consultation_count;
  END IF;

  CREATE TEMP TABLE _nox_test_policies ON COMMIT DROP AS
  SELECT policy.id
  FROM public.apolices AS policy
  WHERE policy.consulta_id IN (SELECT id FROM _nox_test_consultations)
    OR policy.corretor_profile_id IN (SELECT id FROM _nox_test_profiles)
    OR policy.imobiliaria_profile_id IN (SELECT id FROM _nox_test_profiles)
    OR policy.proprietario_profile_id IN (SELECT id FROM _nox_test_profiles);

  CREATE TEMP TABLE _nox_test_signatures ON COMMIT DROP AS
  SELECT signature.id
  FROM public.contract_signatures AS signature
  WHERE signature.consultation_id IN (SELECT id FROM _nox_test_consultations)
    OR signature.policy_id IN (SELECT id FROM _nox_test_policies)
    OR signature.tenant_user_id IN (SELECT id FROM _nox_test_profiles);

  CREATE TEMP TABLE _nox_test_commissions ON COMMIT DROP AS
  SELECT commission.id
  FROM public.comissoes AS commission
  WHERE commission.beneficiario_id IN (SELECT id FROM _nox_test_profiles)
    OR commission.contrato_id IN (SELECT id FROM _nox_test_consultations)
    OR commission.contrato_id IN (SELECT id FROM _nox_test_policies)
    OR commission.contrato_id IN (SELECT id FROM _nox_test_signatures);

  CREATE TEMP TABLE _nox_test_seller_commissions ON COMMIT DROP AS
  SELECT commission.id
  FROM public.seller_commissions AS commission
  WHERE commission.seller_id IN (SELECT id FROM _nox_test_internal_users)
    OR commission.contract_id IN (SELECT id FROM _nox_test_consultations)
    OR commission.contract_id IN (SELECT id FROM _nox_test_policies)
    OR commission.apolice_id IN (SELECT id FROM _nox_test_policies);

  CREATE TEMP TABLE _nox_test_installments ON COMMIT DROP AS
  SELECT installment.id
  FROM public.mensalidades AS installment
  WHERE installment.apolice_id IN (SELECT id FROM _nox_test_policies)
    OR installment.id IN (
      SELECT seller_commission.mensalidade_id
      FROM public.seller_commissions AS seller_commission
      WHERE seller_commission.id IN (SELECT id FROM _nox_test_seller_commissions)
        AND seller_commission.mensalidade_id IS NOT NULL
    );

  CREATE TEMP TABLE _nox_test_tenant_invoices ON COMMIT DROP AS
  SELECT invoice.id
  FROM public.faturas_inquilino AS invoice
  WHERE invoice.consulta_id IN (SELECT id FROM _nox_test_consultations)
    OR invoice.apolice_id IN (SELECT id FROM _nox_test_policies)
    OR invoice.tenant_user_id IN (SELECT id FROM _nox_test_profiles)
    OR invoice.recipient_user_id IN (SELECT id FROM _nox_test_profiles);

  CREATE TEMP TABLE _nox_test_withdrawals ON COMMIT DROP AS
  SELECT withdrawal.id
  FROM public.withdrawal_requests AS withdrawal
  WHERE withdrawal.user_id IN (SELECT id FROM _nox_test_profiles)
    OR EXISTS (
      SELECT 1
      FROM public.withdrawal_commissions AS linked
      WHERE linked.withdrawal_id = withdrawal.id
        AND (
          linked.commission_id IN (SELECT id FROM _nox_test_commissions)
          OR linked.contract_id IN (SELECT id FROM _nox_test_consultations)
          OR linked.contract_id IN (SELECT id FROM _nox_test_policies)
        )
    );

  CREATE TEMP TABLE _nox_test_partnerships ON COMMIT DROP AS
  SELECT partnership.id
  FROM public.seller_client_partnerships AS partnership
  WHERE partnership.seller_id IN (SELECT id FROM _nox_test_internal_users)
    OR partnership.client_profile_id IN (SELECT id FROM _nox_test_profiles)
    OR partnership.created_by IN (SELECT id FROM _nox_test_profiles)
    OR lower(coalesce(partnership.registered_email, '')) IN (SELECT email FROM _nox_test_profiles)
    OR lower(coalesce(partnership.registered_email, '')) ~ '(^|[+._-])(test|teste|demo|mock|qa)([+._@-]|$)';

  CREATE TEMP TABLE _nox_test_leads ON COMMIT DROP AS
  SELECT lead.id
  FROM public.sales_leads AS lead
  WHERE lead.assigned_seller_id IN (SELECT id FROM _nox_test_internal_users)
    OR lead.converted_consulta_id IN (SELECT id FROM _nox_test_consultations)
    OR lower(coalesce(lead.email, '')) IN (SELECT email FROM _nox_test_profiles)
    OR lower(coalesce(lead.email, '')) ~ '(^|[+._-])(test|teste|demo|mock|qa)([+._@-]|$)'
    OR lower(coalesce(lead.full_name, '')) ~ '\m(test|teste|demo|mock)\M';

  CREATE TEMP TABLE _nox_test_notifications ON COMMIT DROP AS
  SELECT notification.id
  FROM public.notificacoes AS notification
  WHERE notification.user_id IN (SELECT id FROM _nox_test_profiles)
    OR EXISTS (
      SELECT 1
      FROM _nox_test_consultations AS consultation
      WHERE coalesce(notification.link, '') LIKE '%' || consultation.id::text || '%'
    )
    OR EXISTS (
      SELECT 1
      FROM _nox_test_policies AS policy
      WHERE coalesce(notification.link, '') LIKE '%' || policy.id::text || '%'
    )
  UNION
  SELECT event.notification_id
  FROM public.important_notification_events AS event
  WHERE event.notification_id IS NOT NULL
    AND (
      event.user_id IN (SELECT id FROM _nox_test_profiles)
      OR EXISTS (
        SELECT 1
        FROM _nox_test_consultations AS consultation
        WHERE event.event_key LIKE '%' || consultation.id::text || '%'
      )
      OR EXISTS (
        SELECT 1
        FROM _nox_test_policies AS policy
        WHERE event.event_key LIKE '%' || policy.id::text || '%'
      )
    );

  CREATE TEMP TABLE _nox_test_marketing_contacts ON COMMIT DROP AS
  SELECT contact.id
  FROM public.marketing_contacts AS contact
  WHERE lower(coalesce(contact.email, '')) IN (SELECT email FROM _nox_test_profiles)
    OR lower(coalesce(contact.email, '')) ~ '(^|[+._-])(test|teste|demo|mock|qa)([+._@-]|$)'
    OR lower(coalesce(contact.full_name, '')) ~ '\m(test|teste|demo|mock)\M'
    OR regexp_replace(coalesce(contact.document, ''), '\D', '', 'g') IN (
      '99999999999', '88888888888', '00000000000'
    )
    OR contact.source_id IN (SELECT id FROM _nox_test_consultations)
    OR contact.source_id IN (SELECT id FROM _nox_test_profiles);

  CREATE TEMP TABLE _nox_test_properties ON COMMIT DROP AS
  SELECT property.id
  FROM public.imoveis AS property
  WHERE property.proprietario_id IN (
      SELECT owner.id
      FROM public.proprietarios AS owner
      WHERE owner.profile_id IN (SELECT id FROM _nox_test_profiles)
    )
    OR property.imobiliaria_id IN (
      SELECT agency.id
      FROM public.imobiliarias AS agency
      WHERE lower(coalesce(agency.contato_email, '')) IN (SELECT email FROM _nox_test_profiles)
    );

  v_preview := jsonb_build_object(
    'test_profiles_preserved', v_test_profile_count,
    'consultations', v_test_consultation_count,
    'policies', (SELECT count(*) FROM _nox_test_policies),
    'contract_signatures', (SELECT count(*) FROM _nox_test_signatures),
    'commissions', (SELECT count(*) FROM _nox_test_commissions),
    'seller_commissions', (SELECT count(*) FROM _nox_test_seller_commissions),
    'installments', (SELECT count(*) FROM _nox_test_installments),
    'tenant_invoices', (SELECT count(*) FROM _nox_test_tenant_invoices),
    'withdrawals', (SELECT count(*) FROM _nox_test_withdrawals),
    'notifications', (SELECT count(*) FROM _nox_test_notifications),
    'leads', (SELECT count(*) FROM _nox_test_leads),
    'partnerships', (SELECT count(*) FROM _nox_test_partnerships),
    'marketing_contacts', (SELECT count(*) FROM _nox_test_marketing_contacts),
    'properties', (SELECT count(*) FROM _nox_test_properties)
  );

  IF NOT p_execute THEN
    RETURN jsonb_build_object('executed', false, 'would_remove', v_preview);
  END IF;

  -- Notificacoes e entregas push.
  DELETE FROM public.push_delivery_log
  WHERE notification_id IN (SELECT id FROM _nox_test_notifications)
    OR user_id IN (SELECT id FROM _nox_test_profiles);

  DELETE FROM public.important_notification_events
  WHERE notification_id IN (SELECT id FROM _nox_test_notifications)
    OR user_id IN (SELECT id FROM _nox_test_profiles);

  DELETE FROM public.notificacoes
  WHERE id IN (SELECT id FROM _nox_test_notifications);

  DELETE FROM public.commission_reminder_schedule
  WHERE user_id IN (SELECT id FROM _nox_test_profiles);

  DELETE FROM public.push_tokens
  WHERE user_id IN (SELECT id FROM _nox_test_profiles);

  -- Assinatura, documentos e notificacoes de contrato.
  DELETE FROM public.contract_notification_deliveries
  WHERE contract_signature_id IN (SELECT id FROM _nox_test_signatures);

  DELETE FROM public.contract_signature_events
  WHERE contract_signature_id IN (SELECT id FROM _nox_test_signatures);

  DELETE FROM public.documentos_proposta
  WHERE consulta_id IN (SELECT id FROM _nox_test_consultations)
    OR apolice_id IN (SELECT id FROM _nox_test_policies)
    OR tenant_user_id IN (SELECT id FROM _nox_test_profiles)
    OR uploaded_by IN (SELECT id FROM _nox_test_profiles)
    OR contract_signature_id IN (SELECT id FROM _nox_test_signatures);

  DELETE FROM public.documentos_contrato
  WHERE apolice_id IN (SELECT id FROM _nox_test_policies);

  DELETE FROM public.contract_signatures
  WHERE id IN (SELECT id FROM _nox_test_signatures);

  -- Comissoes e saques derivados dos contratos de teste.
  DELETE FROM private.withdrawal_crypto_secrets
  WHERE withdrawal_id IN (SELECT id FROM _nox_test_withdrawals);

  DELETE FROM public.withdrawal_commissions
  WHERE withdrawal_id IN (SELECT id FROM _nox_test_withdrawals)
    OR commission_id IN (SELECT id FROM _nox_test_commissions)
    OR contract_id IN (SELECT id FROM _nox_test_consultations)
    OR contract_id IN (SELECT id FROM _nox_test_policies);

  DELETE FROM public.commission_financial_ledger
  WHERE user_id IN (SELECT id FROM _nox_test_profiles)
    OR withdrawal_id IN (SELECT id FROM _nox_test_withdrawals)
    OR commission_id IN (SELECT id FROM _nox_test_commissions)
    OR contract_id IN (SELECT id FROM _nox_test_consultations)
    OR contract_id IN (SELECT id FROM _nox_test_policies);

  DELETE FROM public.financial_audit_logs
  WHERE actor_user_id IN (SELECT id FROM _nox_test_profiles)
    OR withdrawal_id IN (SELECT id FROM _nox_test_withdrawals)
    OR commission_id IN (SELECT id FROM _nox_test_commissions)
    OR contract_id IN (SELECT id FROM _nox_test_consultations)
    OR contract_id IN (SELECT id FROM _nox_test_policies);

  DELETE FROM public.commission_release_events
  WHERE contract_id IN (SELECT id FROM _nox_test_consultations)
    OR contract_id IN (SELECT id FROM _nox_test_policies)
    OR legacy_installment_id IN (SELECT id FROM _nox_test_installments);

  DELETE FROM public.seller_commissions
  WHERE id IN (SELECT id FROM _nox_test_seller_commissions);

  DELETE FROM public.comissoes
  WHERE id IN (SELECT id FROM _nox_test_commissions);

  DELETE FROM public.withdrawal_requests
  WHERE id IN (SELECT id FROM _nox_test_withdrawals);

  DELETE FROM public.dados_financeiros_recebimento
  WHERE user_id IN (SELECT id FROM _nox_test_profiles);

  -- CRM e dashboards dos vendedores usados em teste.
  DELETE FROM public.seller_appointments
  WHERE seller_id IN (SELECT id FROM _nox_test_internal_users)
    OR lead_id IN (SELECT id FROM _nox_test_leads)
    OR partnership_id IN (SELECT id FROM _nox_test_partnerships);

  DELETE FROM public.lead_followups
  WHERE lead_id IN (SELECT id FROM _nox_test_leads)
    OR vendedor_id IN (SELECT id FROM _nox_test_internal_users);

  DELETE FROM public.lead_history
  WHERE lead_id IN (SELECT id FROM _nox_test_leads)
    OR user_id IN (SELECT id FROM _nox_test_profiles);

  DELETE FROM public.seller_client_phone_contacts
  WHERE seller_id IN (SELECT id FROM _nox_test_internal_users)
    OR partnership_id IN (SELECT id FROM _nox_test_partnerships)
    OR created_by IN (SELECT id FROM _nox_test_profiles)
    OR lower(coalesce(client_email, '')) IN (SELECT email FROM _nox_test_profiles);

  DELETE FROM public.seller_client_partnerships
  WHERE id IN (SELECT id FROM _nox_test_partnerships);

  DELETE FROM public.sales_leads
  WHERE id IN (SELECT id FROM _nox_test_leads);

  DELETE FROM public.seller_performance
  WHERE seller_id IN (SELECT id FROM _nox_test_internal_users);

  DELETE FROM public.seller_goals
  WHERE seller_id IN (SELECT id FROM _nox_test_internal_users);

  DELETE FROM public.lead_distribution_queue
  WHERE vendedor_id IN (SELECT id FROM _nox_test_internal_users);

  -- Marketing gerado por consultas/contas de teste.
  DELETE FROM public.marketing_conversion_events
  WHERE contact_id IN (SELECT id FROM _nox_test_marketing_contacts)
    OR source_id IN (SELECT id FROM _nox_test_consultations)
    OR source_id IN (SELECT id FROM _nox_test_profiles);

  DELETE FROM public.marketing_contacts
  WHERE id IN (SELECT id FROM _nox_test_marketing_contacts);

  -- Cobranca consolidada. Um lote misto nunca e apagado: somente seus itens de
  -- teste sao removidos, preservando itens reais do mesmo lote.
  DELETE FROM public.financial_notifications
  WHERE invoice_id IN (SELECT id FROM _nox_test_tenant_invoices)
    OR recipient_id IN (SELECT id FROM _nox_test_profiles);

  DELETE FROM public.payment_reissue_requests
  WHERE requested_by IN (SELECT id FROM _nox_test_profiles)
    OR invoice_id IN (SELECT id FROM _nox_test_tenant_invoices);

  DELETE FROM public.whatsapp_billing_requests
  WHERE requested_by IN (SELECT id FROM _nox_test_profiles)
    OR invoice_id IN (SELECT id FROM _nox_test_tenant_invoices);

  DELETE FROM public.consolidated_invoice_items
  WHERE fatura_id IN (SELECT id FROM _nox_test_tenant_invoices)
    OR consulta_id IN (SELECT id FROM _nox_test_consultations)
    OR tenant_user_id IN (SELECT id FROM _nox_test_profiles);

  DELETE FROM public.faturas_inquilino
  WHERE id IN (SELECT id FROM _nox_test_tenant_invoices);

  DELETE FROM public.mensalidades
  WHERE id IN (SELECT id FROM _nox_test_installments);

  DELETE FROM public.asaas_payments
  WHERE consultation_id IN (SELECT id FROM _nox_test_consultations)
    OR proposal_id IN (SELECT id FROM _nox_test_consultations)
    OR user_id IN (SELECT id FROM _nox_test_profiles)
    OR tenant_user_id IN (SELECT id FROM _nox_test_profiles)
    OR recipient_user_id IN (SELECT id FROM _nox_test_profiles);

  -- Historico e entidades centrais do contrato.
  DELETE FROM public.proposta_historico
  WHERE consulta_id IN (SELECT id FROM _nox_test_consultations)
    OR created_by IN (SELECT id FROM _nox_test_profiles);

  DELETE FROM public.apolices
  WHERE id IN (SELECT id FROM _nox_test_policies);

  DELETE FROM public.consultas_credito
  WHERE id IN (SELECT id FROM _nox_test_consultations);

  DELETE FROM public.imoveis
  WHERE id IN (SELECT id FROM _nox_test_properties)
    AND NOT EXISTS (
      SELECT 1
      FROM public.consultas_credito AS remaining
      WHERE remaining.imovel_id = imoveis.id
    );

  -- Filas/documentos de aprovacao e rastros administrativos das contas teste.
  DELETE FROM public.verificacoes_documento
  WHERE user_id IN (SELECT id FROM _nox_test_profiles);

  DELETE FROM public.internal_audit_logs
  WHERE actor_user_id IN (SELECT id FROM _nox_test_profiles);

  DELETE FROM public.audit_logs
  WHERE performed_by IN (SELECT id FROM _nox_test_profiles);

  DELETE FROM public.email_verification_sends
  WHERE lower(email) IN (SELECT email FROM _nox_test_profiles);

  RETURN jsonb_build_object('executed', true, 'removed', v_preview);
END;
$$;
REVOKE ALL ON FUNCTION public.reset_nox_test_dashboards(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_nox_test_dashboards(boolean) FROM anon;
REVOKE ALL ON FUNCTION public.reset_nox_test_dashboards(boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reset_nox_test_dashboards(boolean) TO service_role;
COMMENT ON FUNCTION public.reset_nox_test_dashboards(boolean) IS
  'Previsualiza ou remove atomicamente dados de contratos/dashboards ligados a contas claramente marcadas como teste ou demo, preservando as contas-base.';
