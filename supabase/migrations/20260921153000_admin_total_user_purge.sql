-- Exclusao administrativa integral de uma conta. A funcao fica restrita ao
-- service_role e e chamada somente pela Edge Function que valida o Admin.
-- Todos os deletes abaixo participam da mesma transacao.

CREATE OR REPLACE FUNCTION public.admin_purge_user_data(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, storage, pg_temp
AS $$
DECLARE
  v_email text;
  v_internal_count integer;
  v_consultation_count integer;
  v_policy_count integer;
BEGIN
  SELECT lower(profile.email)
  INTO v_email
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Usuario nao encontrado.';
  END IF;

  CREATE TEMP TABLE _purge_internal ON COMMIT DROP AS
  SELECT employee.id
  FROM public.internal_users AS employee
  WHERE employee.auth_user_id = p_user_id;

  CREATE TEMP TABLE _purge_tenants ON COMMIT DROP AS
  SELECT tenant.id
  FROM public.inquilinos AS tenant
  WHERE tenant.profile_id = p_user_id;

  CREATE TEMP TABLE _purge_brokers ON COMMIT DROP AS
  SELECT broker.id
  FROM public.corretores AS broker
  WHERE broker.profile_id = p_user_id;

  CREATE TEMP TABLE _purge_owners ON COMMIT DROP AS
  SELECT owner.id
  FROM public.proprietarios AS owner
  WHERE owner.profile_id = p_user_id;

  CREATE TEMP TABLE _purge_agencies ON COMMIT DROP AS
  SELECT agency.id
  FROM public.imobiliarias AS agency
  WHERE lower(agency.contato_email) = v_email;

  CREATE TEMP TABLE _purge_properties ON COMMIT DROP AS
  SELECT property.id
  FROM public.imoveis AS property
  WHERE property.proprietario_id IN (SELECT id FROM _purge_owners)
     OR property.imobiliaria_id IN (SELECT id FROM _purge_agencies);

  CREATE TEMP TABLE _purge_consultations ON COMMIT DROP AS
  SELECT consultation.id
  FROM public.consultas_credito AS consultation
  WHERE consultation.profile_id_solicitante = p_user_id
     OR consultation.tenant_user_id = p_user_id
     OR lower(coalesce(consultation.tenant_email, '')) = v_email
     OR consultation.inquilino_id IN (SELECT id FROM _purge_tenants)
     OR consultation.imovel_id IN (SELECT id FROM _purge_properties);

  CREATE TEMP TABLE _purge_policies ON COMMIT DROP AS
  SELECT policy.id
  FROM public.apolices AS policy
  WHERE policy.consulta_id IN (SELECT id FROM _purge_consultations)
     OR policy.corretor_profile_id = p_user_id
     OR policy.imobiliaria_profile_id = p_user_id
     OR policy.proprietario_profile_id = p_user_id;

  CREATE TEMP TABLE _purge_signatures ON COMMIT DROP AS
  SELECT signature.id
  FROM public.contract_signatures AS signature
  WHERE signature.consultation_id IN (SELECT id FROM _purge_consultations)
     OR signature.policy_id IN (SELECT id FROM _purge_policies)
     OR signature.tenant_user_id = p_user_id;

  CREATE TEMP TABLE _purge_commissions ON COMMIT DROP AS
  SELECT commission.id
  FROM public.comissoes AS commission
  WHERE commission.beneficiario_id = p_user_id
     OR commission.contrato_id IN (SELECT id FROM _purge_policies);

  CREATE TEMP TABLE _purge_seller_commissions ON COMMIT DROP AS
  SELECT commission.id
  FROM public.seller_commissions AS commission
  WHERE commission.seller_id IN (SELECT id FROM _purge_internal)
     OR commission.contract_id IN (SELECT id FROM _purge_consultations)
     OR commission.contract_id IN (SELECT id FROM _purge_policies)
     OR commission.apolice_id IN (SELECT id FROM _purge_policies);

  CREATE TEMP TABLE _purge_installments ON COMMIT DROP AS
  SELECT installment.id
  FROM public.mensalidades AS installment
  WHERE installment.apolice_id IN (SELECT id FROM _purge_policies)
     OR installment.id IN (
       SELECT commission.mensalidade_id
       FROM public.seller_commissions AS commission
       WHERE commission.id IN (SELECT id FROM _purge_seller_commissions)
         AND commission.mensalidade_id IS NOT NULL
     );

  CREATE TEMP TABLE _purge_invoices ON COMMIT DROP AS
  SELECT invoice.id
  FROM public.faturas_inquilino AS invoice
  WHERE invoice.consulta_id IN (SELECT id FROM _purge_consultations)
     OR invoice.apolice_id IN (SELECT id FROM _purge_policies)
     OR invoice.tenant_user_id = p_user_id
     OR invoice.recipient_user_id = p_user_id;

  CREATE TEMP TABLE _purge_withdrawals ON COMMIT DROP AS
  SELECT withdrawal.id
  FROM public.withdrawal_requests AS withdrawal
  WHERE withdrawal.user_id = p_user_id
     OR EXISTS (
       SELECT 1
       FROM public.withdrawal_commissions AS linked
       WHERE linked.withdrawal_id = withdrawal.id
         AND (
           linked.commission_id IN (SELECT id FROM _purge_commissions)
           OR linked.contract_id IN (SELECT id FROM _purge_policies)
         )
     );

  CREATE TEMP TABLE _purge_partnerships ON COMMIT DROP AS
  SELECT partnership.id
  FROM public.seller_client_partnerships AS partnership
  WHERE partnership.seller_id IN (SELECT id FROM _purge_internal)
     OR partnership.client_profile_id = p_user_id
     OR partnership.created_by = p_user_id
     OR lower(coalesce(partnership.registered_email, '')) = v_email;

  CREATE TEMP TABLE _purge_leads ON COMMIT DROP AS
  SELECT lead.id
  FROM public.sales_leads AS lead
  WHERE lead.assigned_seller_id IN (SELECT id FROM _purge_internal)
     OR lead.converted_consulta_id IN (SELECT id FROM _purge_consultations)
     OR lower(coalesce(lead.email, '')) = v_email;

  CREATE TEMP TABLE _purge_notifications ON COMMIT DROP AS
  SELECT notification.id
  FROM public.notificacoes AS notification
  WHERE notification.user_id = p_user_id;

  CREATE TEMP TABLE _purge_marketing_contacts ON COMMIT DROP AS
  SELECT contact.id
  FROM public.marketing_contacts AS contact
  WHERE lower(coalesce(contact.email, '')) = v_email
     OR contact.source_id = p_user_id
     OR contact.source_id IN (SELECT id FROM _purge_consultations);

  SELECT count(*) INTO v_internal_count FROM _purge_internal;
  SELECT count(*) INTO v_consultation_count FROM _purge_consultations;
  SELECT count(*) INTO v_policy_count FROM _purge_policies;

  -- Ponto e fotos: os objetos do Storage sao removidos pela Edge Function.
  DELETE FROM public.time_clock_email_deliveries
  WHERE punch_id IN (
    SELECT punch.id FROM public.time_clock_punches AS punch
    WHERE punch.auth_user_id = p_user_id
       OR punch.employee_id IN (SELECT id FROM _purge_internal)
  );
  DELETE FROM public.time_clock_punches
  WHERE auth_user_id = p_user_id
     OR employee_id IN (SELECT id FROM _purge_internal);

  -- Notificacoes e dispositivos.
  DELETE FROM public.push_delivery_log
  WHERE user_id = p_user_id
     OR notification_id IN (SELECT id FROM _purge_notifications);
  DELETE FROM public.important_notification_events
  WHERE user_id = p_user_id
     OR notification_id IN (SELECT id FROM _purge_notifications);
  DELETE FROM public.notificacoes WHERE id IN (SELECT id FROM _purge_notifications);
  DELETE FROM public.commission_reminder_schedule WHERE user_id = p_user_id;
  DELETE FROM public.push_tokens WHERE user_id = p_user_id;
  DELETE FROM public.notification_preferences WHERE user_id = p_user_id;

  -- Contratos, documentos e assinaturas.
  DELETE FROM public.contract_notification_deliveries
  WHERE contract_signature_id IN (SELECT id FROM _purge_signatures);
  DELETE FROM public.contract_signature_events
  WHERE contract_signature_id IN (SELECT id FROM _purge_signatures);
  DELETE FROM public.documentos_proposta
  WHERE consulta_id IN (SELECT id FROM _purge_consultations)
     OR apolice_id IN (SELECT id FROM _purge_policies)
     OR tenant_user_id = p_user_id
     OR uploaded_by = p_user_id
     OR contract_signature_id IN (SELECT id FROM _purge_signatures);
  DELETE FROM public.documentos_contrato
  WHERE apolice_id IN (SELECT id FROM _purge_policies);
  DELETE FROM public.contract_signatures WHERE id IN (SELECT id FROM _purge_signatures);

  -- Saques, comissoes e lancamentos financeiros pertencentes a conta.
  DELETE FROM private.withdrawal_crypto_secrets
  WHERE withdrawal_id IN (SELECT id FROM _purge_withdrawals);
  DELETE FROM public.withdrawal_commissions
  WHERE withdrawal_id IN (SELECT id FROM _purge_withdrawals)
     OR commission_id IN (SELECT id FROM _purge_commissions)
     OR contract_id IN (SELECT id FROM _purge_policies);
  DELETE FROM public.commission_financial_ledger
  WHERE user_id = p_user_id
     OR withdrawal_id IN (SELECT id FROM _purge_withdrawals)
     OR commission_id IN (SELECT id FROM _purge_commissions)
     OR contract_id IN (SELECT id FROM _purge_policies);
  DELETE FROM public.financial_audit_logs
  WHERE actor_user_id = p_user_id
     OR withdrawal_id IN (SELECT id FROM _purge_withdrawals)
     OR commission_id IN (SELECT id FROM _purge_commissions)
     OR contract_id IN (SELECT id FROM _purge_policies);
  DELETE FROM public.commission_release_events
  WHERE contract_id IN (SELECT id FROM _purge_policies)
     OR legacy_installment_id IN (SELECT id FROM _purge_installments);
  DELETE FROM public.seller_commissions WHERE id IN (SELECT id FROM _purge_seller_commissions);
  DELETE FROM public.comissoes WHERE id IN (SELECT id FROM _purge_commissions);
  DELETE FROM public.withdrawal_requests WHERE id IN (SELECT id FROM _purge_withdrawals);
  DELETE FROM public.dados_financeiros_recebimento WHERE user_id = p_user_id;

  -- Vinculos comerciais de SDR/Closer e do cliente cadastrado.
  DELETE FROM public.seller_signup_attributions
  WHERE registered_profile_id = p_user_id
     OR seller_id IN (SELECT id FROM _purge_internal)
     OR link_id IN (
       SELECT link.id FROM public.seller_signup_links AS link
       WHERE link.seller_id IN (SELECT id FROM _purge_internal)
          OR link.source_sdr_id IN (SELECT id FROM _purge_internal)
     );
  DELETE FROM public.seller_signup_link_send_events
  WHERE seller_id IN (SELECT id FROM _purge_internal)
     OR source_sdr_id IN (SELECT id FROM _purge_internal)
     OR claimed_profile_id = p_user_id;
  DELETE FROM public.seller_signup_links
  WHERE seller_id IN (SELECT id FROM _purge_internal)
     OR source_sdr_id IN (SELECT id FROM _purge_internal);
  DELETE FROM public.seller_referral_invites
  WHERE sdr_id IN (SELECT id FROM _purge_internal)
     OR referred_profile_id = p_user_id;
  DELETE FROM public.seller_client_phone_contacts
  WHERE seller_id IN (SELECT id FROM _purge_internal)
     OR partnership_id IN (SELECT id FROM _purge_partnerships)
     OR created_by = p_user_id
     OR lower(coalesce(client_email, '')) = v_email;
  DELETE FROM public.seller_appointments
  WHERE seller_id IN (SELECT id FROM _purge_internal)
     OR sdr_id IN (SELECT id FROM _purge_internal)
     OR assigned_closer_id IN (SELECT id FROM _purge_internal)
     OR tracked_profile_id = p_user_id
     OR partnership_id IN (SELECT id FROM _purge_partnerships)
     OR lead_id IN (SELECT id FROM _purge_leads);
  DELETE FROM public.seller_client_partnerships WHERE id IN (SELECT id FROM _purge_partnerships);
  DELETE FROM public.lead_followups
  WHERE lead_id IN (SELECT id FROM _purge_leads)
     OR vendedor_id IN (SELECT id FROM _purge_internal);
  DELETE FROM public.lead_history
  WHERE lead_id IN (SELECT id FROM _purge_leads)
     OR user_id = p_user_id;
  DELETE FROM public.sales_leads WHERE id IN (SELECT id FROM _purge_leads);
  DELETE FROM public.seller_performance WHERE seller_id IN (SELECT id FROM _purge_internal);
  DELETE FROM public.seller_goals WHERE seller_id IN (SELECT id FROM _purge_internal);
  DELETE FROM public.lead_distribution_queue WHERE vendedor_id IN (SELECT id FROM _purge_internal);

  DELETE FROM public.marketing_conversion_events
  WHERE contact_id IN (SELECT id FROM _purge_marketing_contacts)
     OR source_id = p_user_id
     OR source_id IN (SELECT id FROM _purge_consultations);
  DELETE FROM public.marketing_contacts WHERE id IN (SELECT id FROM _purge_marketing_contacts);

  -- Cobranca e pagamentos associados aos contratos removidos.
  DELETE FROM public.financial_notifications
  WHERE invoice_id IN (SELECT id FROM _purge_invoices)
     OR recipient_id = p_user_id;
  DELETE FROM public.payment_reissue_requests
  WHERE requested_by = p_user_id OR invoice_id IN (SELECT id FROM _purge_invoices);
  DELETE FROM public.whatsapp_billing_requests
  WHERE requested_by = p_user_id OR invoice_id IN (SELECT id FROM _purge_invoices);
  DELETE FROM public.consolidated_invoice_items
  WHERE fatura_id IN (SELECT id FROM _purge_invoices)
     OR consulta_id IN (SELECT id FROM _purge_consultations)
     OR tenant_user_id = p_user_id;
  DELETE FROM public.faturas_inquilino WHERE id IN (SELECT id FROM _purge_invoices);
  DELETE FROM public.mensalidades WHERE id IN (SELECT id FROM _purge_installments);
  DELETE FROM public.asaas_payments
  WHERE consultation_id IN (SELECT id FROM _purge_consultations)
     OR proposal_id IN (SELECT id FROM _purge_consultations)
     OR user_id = p_user_id
     OR tenant_user_id = p_user_id
     OR recipient_user_id = p_user_id;
  DELETE FROM public.cakto_payments
  WHERE consultation_id IN (SELECT id FROM _purge_consultations);

  -- Entidades centrais criadas pela conta.
  DELETE FROM public.proposta_historico
  WHERE consulta_id IN (SELECT id FROM _purge_consultations)
     OR created_by = p_user_id;
  DELETE FROM public.seller_referral_rewards
  WHERE policy_id IN (SELECT id FROM _purge_policies)
     OR sdr_id IN (SELECT id FROM _purge_internal);
  DELETE FROM public.apolices WHERE id IN (SELECT id FROM _purge_policies);
  UPDATE public.consultas_credito
  SET corretor_id = NULL
  WHERE corretor_id IN (SELECT id FROM _purge_brokers)
    AND id NOT IN (SELECT id FROM _purge_consultations);
  DELETE FROM public.consultas_credito WHERE id IN (SELECT id FROM _purge_consultations);
  DELETE FROM public.imoveis WHERE id IN (SELECT id FROM _purge_properties);

  -- Cadastros auxiliares, solicitacoes e referencias pessoais.
  DELETE FROM public.verificacoes_documento WHERE user_id = p_user_id;
  DELETE FROM public.affiliate_applications WHERE user_id = p_user_id OR lower(email) = v_email;
  DELETE FROM public.support_tickets WHERE user_id = p_user_id;
  DELETE FROM public.broker_agency_invitations
  WHERE broker_profile_id = p_user_id OR agency_profile_id = p_user_id;
  DELETE FROM public.referral_rewards WHERE user_id = p_user_id;
  DELETE FROM public.referrals WHERE referrer_user_id = p_user_id OR referred_user_id = p_user_id;
  DELETE FROM public.email_verification_sends WHERE lower(email) = v_email;
  DELETE FROM public.eventos_funil WHERE profile_id = p_user_id;
  DELETE FROM public.leads_contato WHERE lower(email) = v_email;
  DELETE FROM public.internal_audit_logs WHERE actor_user_id = p_user_id;
  DELETE FROM public.audit_logs WHERE performed_by = p_user_id;
  DELETE FROM public.nox_employee_invites WHERE created_by = p_user_id OR used_by = p_user_id;

  -- Referencias de aprovacao/historico nao pertencem a conta excluida; apenas
  -- perdem o ator, sem apagar o registro de outro cliente.
  UPDATE public.profiles SET aprovado_por = NULL WHERE aprovado_por = p_user_id;
  UPDATE public.withdrawal_requests
  SET approved_by = CASE WHEN approved_by = p_user_id THEN NULL ELSE approved_by END,
      paid_by = CASE WHEN paid_by = p_user_id THEN NULL ELSE paid_by END,
      reviewed_by = CASE WHEN reviewed_by = p_user_id THEN NULL ELSE reviewed_by END,
      rejected_by = CASE WHEN rejected_by = p_user_id THEN NULL ELSE rejected_by END,
      cancelled_by = CASE WHEN cancelled_by = p_user_id THEN NULL ELSE cancelled_by END,
      receipt_uploaded_by = CASE WHEN receipt_uploaded_by = p_user_id THEN NULL ELSE receipt_uploaded_by END
  WHERE approved_by = p_user_id
     OR paid_by = p_user_id
     OR reviewed_by = p_user_id
     OR rejected_by = p_user_id
     OR cancelled_by = p_user_id
     OR receipt_uploaded_by = p_user_id;
  UPDATE public.consultas_credito
  SET approved_by = CASE WHEN approved_by = p_user_id THEN NULL ELSE approved_by END,
      rejected_by = CASE WHEN rejected_by = p_user_id THEN NULL ELSE rejected_by END
  WHERE approved_by = p_user_id OR rejected_by = p_user_id;
  UPDATE public.apolices
  SET corretor_profile_id = CASE WHEN corretor_profile_id = p_user_id THEN NULL ELSE corretor_profile_id END,
      imobiliaria_profile_id = CASE WHEN imobiliaria_profile_id = p_user_id THEN NULL ELSE imobiliaria_profile_id END,
      proprietario_profile_id = CASE WHEN proprietario_profile_id = p_user_id THEN NULL ELSE proprietario_profile_id END,
      commission_origin_broker_profile_id = CASE WHEN commission_origin_broker_profile_id = p_user_id THEN NULL ELSE commission_origin_broker_profile_id END,
      commission_origin_agency_profile_id = CASE WHEN commission_origin_agency_profile_id = p_user_id THEN NULL ELSE commission_origin_agency_profile_id END
  WHERE corretor_profile_id = p_user_id
     OR imobiliaria_profile_id = p_user_id
     OR proprietario_profile_id = p_user_id
     OR commission_origin_broker_profile_id = p_user_id
     OR commission_origin_agency_profile_id = p_user_id;
  UPDATE public.comissoes
  SET origin_broker_profile_id = CASE WHEN origin_broker_profile_id = p_user_id THEN NULL ELSE origin_broker_profile_id END,
      origin_agency_profile_id = CASE WHEN origin_agency_profile_id = p_user_id THEN NULL ELSE origin_agency_profile_id END
  WHERE origin_broker_profile_id = p_user_id OR origin_agency_profile_id = p_user_id;
  UPDATE public.leads_contato SET responsavel_id = NULL WHERE responsavel_id = p_user_id;

  DELETE FROM public.imobiliarias WHERE id IN (SELECT id FROM _purge_agencies);
  DELETE FROM public.internal_users WHERE id IN (SELECT id FROM _purge_internal);
  DELETE FROM public.profiles WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'profile_id', p_user_id,
    'email', v_email,
    'internal_users_removed', v_internal_count,
    'consultations_removed', v_consultation_count,
    'policies_removed', v_policy_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_purge_user_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_user_data(uuid) TO service_role;

COMMENT ON FUNCTION public.admin_purge_user_data(uuid) IS
  'Remove de forma transacional os dados e vinculos de uma conta antes da exclusao definitiva no Auth.';
