import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import {
  asaasFetch,
  corsHeaders,
  describePaymentError,
  HttpError,
  jsonResponse,
  mapAsaasStatus,
  normalizeDocumento,
  paymentErrorStatus,
  requireUser,
  sanitizeAsaasResponse,
  toMoney,
} from "../_shared/asaas.ts";
import { assertHasGlobalBillingRole } from "../_shared/billing-auth.ts";
import {
  buildBillingKey,
  normalizePaymentStatus,
  normalizeSubscriptionStatus,
} from "../_shared/billing-state.ts";
import { materializeInvoice, publicRecipient } from "../_shared/contract-billing.ts";
import { resolveContractPeriodMonths } from "../_shared/contract-period.ts";
import {
  buildD4SignSigner,
  dispatchD4SignContract,
  ensurePendingPolicy,
  resolveContractTemplate,
} from "../_shared/d4sign.ts";
import {
  buildImportedMonthlySchedule,
  isCompatibleSubscriptionAmount,
  providerRows,
  selectCustomerByDocument,
  selectNoxCardSubscriptions,
  subscriptionInstallmentCount,
} from "../_shared/existing-subscription.ts";

type ImportBody = {
  proposalId?: string;
  action?: "preview" | "import";
};

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function normalizedEmail(value: unknown) {
  const email = String(value || "")
    .trim()
    .toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function providerTimestamp(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return new Date().toISOString();
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00-03:00` : raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function maskedProviderId(value: unknown) {
  const id = String(value || "");
  return id.length <= 8 ? id : `...${id.slice(-8)}`;
}

async function loadConsultation(supabase: any, proposalId: string) {
  const { data, error } = await supabase
    .from("consultas_credito")
    .select(
      "*, inquilinos(*), imoveis(*), planos(*), responsavel_profile:profiles!consultas_credito_profile_id_solicitante_fkey(id, nome, email, telefone, cnpj, role)",
    )
    .eq("id", proposalId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "Proposta nao encontrada.");
  return data;
}

async function loadAgency(supabase: any, consultation: any) {
  const propertyAgencyId = consultation?.imoveis?.imobiliaria_id;
  if (propertyAgencyId) {
    const { data } = await supabase
      .from("imobiliarias")
      .select("*")
      .eq("id", propertyAgencyId)
      .maybeSingle();
    if (data) return data;
  }
  const requester = consultation?.responsavel_profile;
  if (requester?.role === "imobiliaria" && requester?.email) {
    const { data } = await supabase
      .from("imobiliarias")
      .select("*")
      .ilike("contato_email", requester.email)
      .maybeSingle();
    if (data) return data;
  }
  if (consultation?.profile_id_solicitante) {
    const { data: broker } = await supabase
      .from("corretores")
      .select("imobiliaria_id")
      .eq("profile_id", consultation.profile_id_solicitante)
      .maybeSingle();
    if (broker?.imobiliaria_id) {
      const { data } = await supabase
        .from("imobiliarias")
        .select("*")
        .eq("id", broker.imobiliaria_id)
        .maybeSingle();
      return data || null;
    }
  }
  return null;
}

async function loadTenantProfile(supabase: any, consultation: any, providerCustomer: any) {
  if (consultation?.tenant_user_id) {
    const { data } = await supabase
      .from("profiles")
      .select("id, role, nome, email, telefone, asaas_customer_id")
      .eq("id", consultation.tenant_user_id)
      .maybeSingle();
    if (data) return data;
  }
  const email = normalizedEmail(providerCustomer?.email || consultation?.tenant_email);
  if (!email) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, role, nome, email, telefone, asaas_customer_id")
    .ilike("email", email)
    .limit(2);
  if ((data || []).length > 1) {
    throw new HttpError(409, "Mais de um perfil usa o e-mail do inquilino. Revise o cadastro.");
  }
  const profile = data?.[0] || null;
  if (profile?.role && profile.role !== "inquilino") {
    throw new HttpError(409, "O e-mail do inquilino esta vinculado a outro tipo de perfil.");
  }
  return profile;
}

function contractMissingFields(consultation: any, providerCustomer: any, agency: any) {
  const property = consultation?.imoveis || {};
  const tenant = consultation?.inquilinos || {};
  const merged = {
    ...consultation,
    tenant_name: firstText(consultation?.tenant_name, providerCustomer?.name, tenant?.nome),
    tenant_email: normalizedEmail(
      consultation?.tenant_email || providerCustomer?.email || tenant?.email,
    ),
    tenant_telefone: firstText(
      consultation?.tenant_telefone,
      providerCustomer?.mobilePhone,
      providerCustomer?.phone,
      tenant?.telefone,
    ),
  };
  const required: Array<[string, unknown]> = [
    ["nome do inquilino", merged.tenant_name],
    ["CPF do inquilino", consultation?.tenant_document || consultation?.documento || tenant?.cpf],
    ["e-mail do inquilino", merged.tenant_email],
    ["telefone do inquilino", merged.tenant_telefone],
    [
      "data de nascimento do inquilino",
      consultation?.tenant_data_nascimento || tenant?.data_nascimento,
    ],
    ["plano contratado", consultation?.planos?.nome],
    [
      "valor do aluguel",
      consultation?.rent_value || consultation?.valor_aluguel || property?.valor_aluguel,
    ],
    ["tipo do imovel", consultation?.imovel_subtipo || property?.tipo || consultation?.tipo_imovel],
    [
      "endereco do imovel",
      consultation?.imovel_endereco || property?.endereco || consultation?.property_address,
    ],
    ["bairro do imovel", consultation?.imovel_bairro || property?.bairro],
    ["cidade do imovel", consultation?.imovel_cidade || property?.cidade],
    ["UF do imovel", consultation?.imovel_estado || property?.estado],
    ["CEP do imovel", consultation?.imovel_cep || property?.cep],
    ["razao social da administradora", agency?.razao_social || agency?.nome_fantasia],
    ["CNPJ da administradora", agency?.cnpj],
    ["endereco da administradora", agency?.endereco],
    ["cidade da administradora", agency?.cidade],
    ["UF da administradora", agency?.estado],
    ["CEP da administradora", agency?.cep],
  ];
  const missing = required
    .filter(([, value]) => !String(value || "").trim())
    .map(([label]) => label);
  try {
    resolveContractTemplate(consultation?.planos?.nome);
  } catch {
    missing.push("modelo D4Sign do plano");
  }
  try {
    buildD4SignSigner(merged);
  } catch {
    if (!missing.includes("e-mail do inquilino")) missing.push("e-mail valido do inquilino");
    if (!missing.includes("telefone do inquilino")) missing.push("telefone valido do inquilino");
  }
  return { missing, merged };
}

async function providerSnapshot(supabase: any, consultation: any) {
  const document = normalizeDocumento(
    consultation?.tenant_document || consultation?.documento || consultation?.inquilinos?.cpf,
  );
  if (document.length !== 11) {
    throw new HttpError(409, "A proposta precisa ter o CPF valido do inquilino.");
  }
  const customerResponse = await asaasFetch(
    `/customers?cpfCnpj=${encodeURIComponent(document)}&limit=100`,
  );
  const customers = selectCustomerByDocument(customerResponse, document);
  if (!customers.length) throw new HttpError(404, "Cliente nao encontrado no Asaas para este CPF.");
  if (customers.length > 1) {
    throw new HttpError(409, "Ha mais de um cliente Asaas com este CPF. Revise antes de importar.");
  }
  const customer = customers[0];
  const subscriptionResponse = await asaasFetch(
    `/subscriptions?customer=${encodeURIComponent(customer.id)}&billingType=CREDIT_CARD&status=ACTIVE&limit=100`,
  );
  const subscriptions = selectNoxCardSubscriptions(subscriptionResponse, customer.id);
  if (!subscriptions.length) {
    throw new HttpError(404, "Assinatura NOX mensal ativa no cartao nao encontrada.");
  }
  if (subscriptions.length > 1) {
    throw new HttpError(409, "Mais de uma assinatura NOX ativa foi encontrada. Revise no Asaas.");
  }
  const subscription = subscriptions[0];
  const paymentResponse = await asaasFetch(
    `/subscriptions/${encodeURIComponent(subscription.id)}/payments`,
  );
  const payments = providerRows(paymentResponse).sort((a, b) =>
    String(a?.dueDate || "").localeCompare(String(b?.dueDate || "")),
  );
  const firstPayment = payments[0];
  if (!firstPayment?.id || !firstPayment?.dueDate) {
    throw new HttpError(409, "A assinatura ainda nao possui a primeira cobranca materializada.");
  }
  const paymentStatus = normalizePaymentStatus(mapAsaasStatus(firstPayment.status));
  if (!["confirmed", "paid"].includes(paymentStatus)) {
    throw new HttpError(409, "A primeira cobranca do cartao ainda nao esta confirmada.");
  }
  const contractMonths = resolveContractPeriodMonths(consultation);
  const installmentCount = subscriptionInstallmentCount({
    subscription,
    firstDueDate: firstPayment.dueDate,
  });
  if (installmentCount !== contractMonths) {
    throw new HttpError(
      409,
      `A assinatura Asaas possui ${installmentCount || "prazo indefinido"} cobrancas, mas o contrato exige ${contractMonths}.`,
    );
  }
  const contractualMonthly = toMoney(consultation?.valor_premio_mensal);
  const providerMonthly = toMoney(subscription?.value || firstPayment?.value);
  if (!isCompatibleSubscriptionAmount(providerMonthly, contractualMonthly)) {
    throw new HttpError(
      409,
      "O valor recorrente do Asaas nao e compativel com o premio mensal do contrato.",
    );
  }
  const schedule = buildImportedMonthlySchedule({
    firstDueDate: firstPayment.dueDate,
    totalInstallments: contractMonths,
  });
  if (subscription?.endDate && schedule.at(-1)?.dueDate !== subscription.endDate) {
    throw new HttpError(409, "A data final da assinatura nao coincide com as 12 mensalidades.");
  }
  const agency = await loadAgency(supabase, consultation);
  const readiness = contractMissingFields(consultation, customer, agency);
  const tenantProfile = await loadTenantProfile(supabase, consultation, customer);
  const tenantContact = {
    paymentResponsible: "tenant" as const,
    recipientType: "tenant" as const,
    recipientUserId: null,
    recipientTenantId: tenantProfile?.id || consultation?.tenant_user_id || null,
    recipientName: firstText(readiness.merged.tenant_name, customer.name),
    recipientEmail: normalizedEmail(readiness.merged.tenant_email),
    recipientPhone: firstText(readiness.merged.tenant_telefone),
  };
  return {
    customer,
    subscription,
    firstPayment,
    paymentStatus,
    contractMonths,
    contractualMonthly,
    providerMonthly,
    schedule,
    agency,
    readiness,
    tenantProfile,
    tenantContact,
  };
}

function previewResponse(
  snapshot: Awaited<ReturnType<typeof providerSnapshot>>,
  imported: boolean,
) {
  const { customer, subscription, firstPayment, paymentStatus } = snapshot;
  return {
    ok: true,
    found: true,
    imported,
    contractReady: snapshot.readiness.missing.length === 0,
    missingContractFields: snapshot.readiness.missing,
    tenant: publicRecipient(snapshot.tenantContact),
    provider: {
      customerId: maskedProviderId(customer.id),
      subscriptionId: maskedProviderId(subscription.id),
      paymentId: maskedProviderId(firstPayment.id),
      billingType: subscription.billingType,
      cycle: subscription.cycle,
      status: normalizeSubscriptionStatus(subscription.status),
      paymentStatus,
      description: subscription.description,
      grossMonthlyAmount: snapshot.providerMonthly,
      contractualMonthlyAmount: snapshot.contractualMonthly,
      cardFeeDifference: toMoney(snapshot.providerMonthly - snapshot.contractualMonthly),
      firstDueDate: firstPayment.dueDate,
      confirmedAt: providerTimestamp(
        firstPayment.confirmedDate ||
          firstPayment.paymentDate ||
          firstPayment.clientPaymentDate ||
          firstPayment.dateCreated,
      ),
      nextDueDate: subscription.nextDueDate || snapshot.schedule[1]?.dueDate || null,
      endDate: subscription.endDate || snapshot.schedule.at(-1)?.dueDate || null,
      installments: snapshot.contractMonths,
    },
  };
}

async function findImportedSubscription(supabase: any, proposalId: string, providerId: string) {
  const { data: byProvider } = await supabase
    .from("asaas_subscriptions")
    .select("*")
    .eq("asaas_subscription_id", providerId)
    .maybeSingle();
  if (byProvider && byProvider.consultation_id !== proposalId) {
    throw new HttpError(409, "Esta assinatura Asaas ja esta vinculada a outro contrato.");
  }
  if (byProvider) return byProvider;
  const { data: byContract } = await supabase
    .from("asaas_subscriptions")
    .select("*")
    .eq("consultation_id", proposalId)
    .in("status", ["pending", "active", "suspended"])
    .maybeSingle();
  if (byContract?.asaas_subscription_id && byContract.asaas_subscription_id !== providerId) {
    throw new HttpError(409, "O contrato ja possui outra assinatura recorrente vinculada.");
  }
  return byContract || null;
}

async function persistImport(
  supabase: any,
  userId: string,
  consultation: any,
  snapshot: Awaited<ReturnType<typeof providerSnapshot>>,
) {
  const {
    customer,
    subscription,
    firstPayment,
    paymentStatus,
    contractMonths,
    providerMonthly,
    contractualMonthly,
    schedule,
    tenantProfile,
    tenantContact,
  } = snapshot;
  if (snapshot.readiness.missing.length) {
    throw new HttpError(
      409,
      `Complete os dados do contrato antes do envio: ${snapshot.readiness.missing.join(", ")}.`,
    );
  }
  const providerEventAt = providerTimestamp(
    firstPayment.lastUpdated ||
      firstPayment.confirmedDate ||
      firstPayment.paymentDate ||
      firstPayment.dateCreated,
  );
  const confirmedAt = providerTimestamp(
    firstPayment.confirmedDate ||
      firstPayment.paymentDate ||
      firstPayment.clientPaymentDate ||
      firstPayment.dateCreated,
  );
  const externalReference = `nox:${consultation.id}:subscription:imported:${subscription.id}`;
  const safeProvider = {
    source: "manual_asaas_import",
    subscription: sanitizeAsaasResponse(subscription),
    firstPayment: sanitizeAsaasResponse(firstPayment),
  };

  if (tenantProfile?.id) {
    const currentName = String(tenantProfile.nome || "").trim();
    const documentLikeName = /^\D*\d[\d./ -]*$/.test(currentName);
    const { error } = await supabase
      .from("profiles")
      .update({
        nome: !currentName || documentLikeName ? tenantContact.recipientName : currentName,
        email: tenantProfile.email || tenantContact.recipientEmail,
        telefone: tenantProfile.telefone || tenantContact.recipientPhone,
        asaas_customer_id: customer.id,
      })
      .eq("id", tenantProfile.id);
    if (error) throw error;
  }

  if (consultation?.inquilino_id) {
    const { error } = await supabase
      .from("inquilinos")
      .update({
        nome: tenantContact.recipientName,
        profile_id: tenantProfile?.id || consultation?.tenant_user_id || null,
        asaas_customer_id: customer.id,
      })
      .eq("id", consultation.inquilino_id);
    if (error) throw error;
  }

  const contactPatch = {
    tenant_name: tenantContact.recipientName,
    tenant_email: tenantContact.recipientEmail,
    tenant_telefone: tenantContact.recipientPhone,
    tenant_user_id: tenantProfile?.id || consultation?.tenant_user_id || null,
    payment_type: "inquilino",
    billing_responsible_role: "inquilino",
    billing_responsible_user_id: null,
    asaas_customer_id: customer.id,
  };
  // Audita a alteracao se o payment_type anterior era diferente - evita
  // "overwrite silencioso" quando a imobiliaria pagava e o import sobrescreve
  // para inquilino.
  if (
    consultation?.payment_type &&
    consultation.payment_type !== contactPatch.payment_type
  ) {
    await supabase.from("proposta_historico").insert({
      consulta_id: consultation.id,
      tipo_evento: "import_subscription_payment_type_change",
      descricao: `Import de assinatura mudou responsavel de pagamento de "${consultation.payment_type}" para "inquilino".`,
      created_by: userId,
    } as any);
  }
  const { error: contactError } = await supabase
    .from("consultas_credito")
    .update(contactPatch)
    .eq("id", consultation.id);
  if (contactError) throw contactError;
  const currentConsultation = { ...consultation, ...contactPatch };
  const recipient = {
    ...tenantContact,
    recipientTenantId: contactPatch.tenant_user_id,
  };

  let localSubscription = await findImportedSubscription(
    supabase,
    consultation.id,
    subscription.id,
  );
  const subscriptionPayload = {
    consultation_id: consultation.id,
    created_by: localSubscription?.created_by || userId,
    tenant_user_id: contactPatch.tenant_user_id,
    payment_responsible: "tenant",
    recipient_type: "tenant",
    recipient_user_id: null,
    recipient_tenant_id: contactPatch.tenant_user_id,
    recipient_name: recipient.recipientName,
    recipient_email: recipient.recipientEmail,
    recipient_phone: recipient.recipientPhone,
    mode: "direct",
    status: "active",
    card_registration_status: "not_required",
    payment_status: paymentStatus,
    asaas_customer_id: customer.id,
    asaas_subscription_id: subscription.id,
    external_reference: localSubscription?.external_reference || externalReference,
    idempotency_key: localSubscription?.idempotency_key || externalReference,
    initial_amount: providerMonthly,
    monthly_amount: providerMonthly,
    next_due_date: subscription.nextDueDate || schedule[1]?.dueDate || schedule[0].dueDate,
    recurrence_start_date: subscription.nextDueDate || schedule[1]?.dueDate || schedule[0].dueDate,
    recurrence_end_date: subscription.endDate || schedule.at(-1)?.dueDate,
    recurrence_total_payments: Math.max(0, contractMonths - 1),
    fire_insurance_payment_mode: consultation?.fire_insurance_payment_mode || "embutido",
    split_initial_payment: false,
    raw_response: safeProvider,
    provider_event_at: providerTimestamp(subscription.lastUpdated || subscription.dateCreated),
    activated_at: localSubscription?.activated_at || new Date().toISOString(),
  };
  if (localSubscription) {
    const { data, error } = await supabase
      .from("asaas_subscriptions")
      .update(subscriptionPayload)
      .eq("id", localSubscription.id)
      .select("*")
      .maybeSingle();
    if (error || !data) throw error || new Error("subscription_import_update_failed");
    localSubscription = data;
  } else {
    const { data, error } = await supabase
      .from("asaas_subscriptions")
      .insert(subscriptionPayload)
      .select("*")
      .maybeSingle();
    if (error || !data) throw error || new Error("subscription_import_insert_failed");
    localSubscription = data;
  }

  let localPayment: any = null;
  const { data: foundPayment, error: findPaymentError } = await supabase
    .from("asaas_payments")
    .select("*")
    .eq("asaas_payment_id", firstPayment.id)
    .maybeSingle();
  if (findPaymentError) throw findPaymentError;
  if (foundPayment && foundPayment.consultation_id !== consultation.id) {
    throw new HttpError(409, "A primeira cobranca ja esta vinculada a outro contrato.");
  }
  const paymentKey = `nox:provider-payment:${firstPayment.id}`;
  const paymentPayload = {
    consultation_id: consultation.id,
    proposal_id: consultation.id,
    plan_id: consultation.plano_id,
    user_id: foundPayment?.user_id || userId,
    tenant_user_id: contactPatch.tenant_user_id,
    asaas_customer_id: customer.id,
    asaas_payment_id: firstPayment.id,
    external_reference: foundPayment?.external_reference || paymentKey,
    idempotency_key: foundPayment?.idempotency_key || paymentKey,
    charge_kind: "initial",
    payment_method: "credit_card",
    value: toMoney(firstPayment.value || providerMonthly),
    status: paymentStatus,
    due_date: firstPayment.dueDate,
    confirmed_at: paymentStatus === "confirmed" ? confirmedAt : foundPayment?.confirmed_at || null,
    received_at:
      paymentStatus === "paid"
        ? providerTimestamp(
            firstPayment.paymentDate || firstPayment.clientPaymentDate || confirmedAt,
          )
        : foundPayment?.received_at || null,
    boleto_url: null,
    boleto_barcode: null,
    raw_response: sanitizeAsaasResponse(firstPayment),
    provider_event_at: providerEventAt,
    payment_responsible: "tenant",
    recipient_type: "tenant",
    recipient_user_id: null,
    recipient_tenant_id: contactPatch.tenant_user_id,
    recipient_name: recipient.recipientName,
    recipient_email: recipient.recipientEmail,
    recipient_phone: recipient.recipientPhone,
  };
  if (foundPayment) {
    const { data, error } = await supabase
      .from("asaas_payments")
      .update(paymentPayload)
      .eq("id", foundPayment.id)
      .select("*")
      .maybeSingle();
    if (error || !data) throw error || new Error("payment_import_update_failed");
    localPayment = data;
  } else {
    const { data, error } = await supabase
      .from("asaas_payments")
      .insert(paymentPayload)
      .select("*")
      .maybeSingle();
    if (error || !data) throw error || new Error("payment_import_insert_failed");
    localPayment = data;
  }

  const firstInvoice = await materializeInvoice(supabase, {
    consultation: currentConsultation,
    recipient,
    billingKey: buildBillingKey(consultation.id, "initial", 1),
    installmentNumber: 1,
    installmentTotal: contractMonths,
    dueDate: firstPayment.dueDate,
    value: toMoney(firstPayment.value || providerMonthly),
    status: paymentStatus,
    chargeKind: "initial",
    paymentMethod: "credit_card",
    components: {
      source: "manual_asaas_import",
      contractualMonthlyAmount: contractualMonthly,
      providerGrossAmount: providerMonthly,
      providerFeeDifference: toMoney(providerMonthly - contractualMonthly),
      includesFirstMonthlyPayment: true,
      contractMonths,
      providerSubscriptionId: subscription.id,
    },
    paymentUrl: firstPayment.invoiceUrl || null,
    localPaymentId: localPayment.id,
    subscriptionId: localSubscription.id,
    referenceMonth: `${firstPayment.dueDate.slice(0, 7)}-01`,
    providerEventAt,
  });
  const { error: firstInvoiceError } = await supabase
    .from("faturas_inquilino")
    .update({
      status: paymentStatus,
      confirmed_at: confirmedAt,
      pago_em: confirmedAt,
      asaas_payment_id: localPayment.id,
      asaas_subscription_id: localSubscription.id,
    })
    .eq("id", firstInvoice.id);
  if (firstInvoiceError) throw firstInvoiceError;

  for (const item of schedule.slice(1)) {
    await materializeInvoice(supabase, {
      consultation: currentConsultation,
      recipient,
      billingKey: buildBillingKey(consultation.id, "monthly", item.dueDate.slice(0, 7)),
      installmentNumber: item.installmentNumber,
      installmentTotal: contractMonths,
      dueDate: item.dueDate,
      value: providerMonthly,
      status: "pending",
      chargeKind: "monthly",
      paymentMethod: "credit_card",
      components: {
        source: "subscription_projection",
        contractualMonthlyAmount: contractualMonthly,
        providerGrossAmount: providerMonthly,
        providerFeeDifference: toMoney(providerMonthly - contractualMonthly),
        providerSubscriptionId: subscription.id,
      },
      subscriptionId: localSubscription.id,
      referenceMonth: `${item.dueDate.slice(0, 7)}-01`,
    });
  }

  const { error: subscriptionLinkError } = await supabase
    .from("asaas_subscriptions")
    .update({ initial_invoice_id: firstInvoice.id })
    .eq("id", localSubscription.id);
  if (subscriptionLinkError) throw subscriptionLinkError;
  const { error: consultationError } = await supabase
    .from("consultas_credito")
    .update({
      ...contactPatch,
      asaas_payment_id: firstPayment.id,
      external_reference: paymentKey,
      payment_method: "credit_card",
      payment_value: toMoney(firstPayment.value || providerMonthly),
      payment_due_date: firstPayment.dueDate,
      payment_confirmed_at: confirmedAt,
      payment_received_at: paymentStatus === "paid" ? paymentPayload.received_at : null,
      payment_data: {
        source: "manual_asaas_import",
        providerSubscriptionId: subscription.id,
        providerPaymentId: firstPayment.id,
        providerStatus: firstPayment.status,
        providerGrossAmount: providerMonthly,
        contractualMonthlyAmount: contractualMonthly,
      },
      payment_status: paymentStatus,
      payment_state: paymentStatus,
      payment_provider_event_at: providerEventAt,
      card_setup_mode: "direct",
      policy_status: "issued_pending",
    })
    .eq("id", consultation.id);
  if (consultationError) throw consultationError;

  const { data: history } = await supabase
    .from("proposta_historico")
    .select("id")
    .eq("consulta_id", consultation.id)
    .eq("tipo_evento", "assinatura_asaas_importada")
    .limit(1);
  if (!history?.length) {
    await supabase.from("proposta_historico").insert({
      consulta_id: consultation.id,
      tipo_evento: "assinatura_asaas_importada",
      descricao: `Assinatura mensal de cartao conciliada com o Asaas: primeira parcela ${paymentStatus} e ${contractMonths - 1} futuras em aberto.`,
    });
  }

  await ensurePendingPolicy(supabase, consultation.id);
  const signature = await dispatchD4SignContract(supabase, consultation.id);
  if (!signature.ok) {
    return {
      imported: true,
      contractSent: false,
      signatureStatus: signature.status || "error",
      signatureError: signature.error || "d4sign_dispatch_failed",
      localSubscriptionId: localSubscription.id,
      firstInvoiceId: firstInvoice.id,
    };
  }
  const { data: updatedConsultation } = await supabase
    .from("consultas_credito")
    .select("tenant_user_id")
    .eq("id", consultation.id)
    .maybeSingle();
  if (updatedConsultation?.tenant_user_id) {
    await supabase
      .from("asaas_subscriptions")
      .update({
        tenant_user_id: updatedConsultation.tenant_user_id,
        recipient_tenant_id: updatedConsultation.tenant_user_id,
      })
      .eq("id", localSubscription.id);
  }
  return {
    imported: true,
    contractSent: true,
    signatureStatus: signature.status || "awaiting_signature",
    localSubscriptionId: localSubscription.id,
    firstInvoiceId: firstInvoice.id,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") {
    return jsonResponse(req, { ok: false, error: "Metodo nao permitido." }, 405);
  }
  try {
    const { supabase, user } = await requireUser(req);
    await assertHasGlobalBillingRole(supabase, user.id);
    const body = (await req.json()) as ImportBody;
    const proposalId = String(body.proposalId || "").trim();
    const action = body.action || "preview";
    if (!proposalId) throw new HttpError(400, "Proposta nao encontrada.");
    if (!["preview", "import"].includes(action)) throw new HttpError(400, "Acao invalida.");
    const consultation = await loadConsultation(supabase, proposalId);
    const snapshot = await providerSnapshot(supabase, consultation);
    const existing = await findImportedSubscription(supabase, proposalId, snapshot.subscription.id);
    if (action === "preview") {
      return jsonResponse(req, previewResponse(snapshot, Boolean(existing?.initial_invoice_id)));
    }
    const imported = await persistImport(supabase, user.id, consultation, snapshot);
    return jsonResponse(req, {
      ...previewResponse(snapshot, true),
      ...imported,
    });
  } catch (error) {
    console.error("[asaas-import-existing-subscription] erro", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(
      req,
      {
        ok: false,
        error: describePaymentError(error, "Nao foi possivel conciliar a assinatura existente."),
      },
      paymentErrorStatus(error, 500),
    );
  }
});
