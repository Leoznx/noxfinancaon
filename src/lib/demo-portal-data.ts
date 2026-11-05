import type {
  CommissionContract,
  UserCommission,
  UserFinancialSummary,
  UserWithdrawal,
} from "@/lib/withdrawals";
import type { TenantBillingConsultation, TenantBillingItem } from "@/lib/tenant-billing";
import type { TenantInvoiceSummary } from "@/lib/tenant-invoice-summary";
import type { ContractBillingRow } from "@/lib/contract-billing";
import type { TenantInvoiceDisplayRow } from "@/lib/tenant-invoice-display";
import { getDemoCareerScenario } from "@/lib/demo-career";

export const DEMO_RECORD_PREFIX = "d3000000-0000-4000-8000-";

const id = (value: number) => `${DEMO_RECORD_PREFIX}${String(value).padStart(12, "0")}`;

export const DEMO_CONTRACT_NUMBERS = [
  "2026-004812",
  "2026-004967",
  "2026-005103",
  "2026-005284",
  "2026-005419",
  "2026-005588",
  "2026-005731",
  "2026-005906",
  "2026-006044",
  "2026-006218",
  "2026-006395",
  "2026-006527",
  "2026-006684",
  "2026-006843",
  "2026-007012",
] as const;

const demoContractNumber = (index: number) =>
  DEMO_CONTRACT_NUMBERS[index] ?? `2026-${String(6000 + index).padStart(6, "0")}`;

function shiftedDate(days: number, dateOnly = false) {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + days);
  return dateOnly ? value.toISOString().slice(0, 10) : value.toISOString();
}

export function isDemoRecordId(value?: string | null) {
  return Boolean(value?.startsWith(DEMO_RECORD_PREFIX));
}

const people = [
  ["Mariana Costa", "390.482.760-18", "Balneário Camboriú", "SC", "Avenida Brasil, 840"],
  ["Rafael Martins", "827.144.950-02", "Itajaí", "SC", "Rua Brusque, 315"],
  ["Camila Rodrigues", "541.760.320-45", "Florianópolis", "SC", "Rua Bocaiúva, 1270"],
  ["Eduardo Almeida", "158.903.640-71", "Joinville", "SC", "Rua Blumenau, 552"],
  ["Juliana Ferreira", "604.275.890-36", "Camboriú", "SC", "Rua Monte Agulhas Negras, 91"],
  [
    "Lucas Nascimento",
    "973.416.280-09",
    "Navegantes",
    "SC",
    "Avenida Prefeito Cirino Adolfo Cabral, 410",
  ],
  ["Beatriz Oliveira", "216.598.430-84", "São José", "SC", "Rua Koesa, 233"],
] as const;

const commissionTenantNames = [
  ...people.slice(0, 6).map((person) => person[0]),
  "Beatriz Oliveira",
  "Felipe Santos",
  "Larissa Moreira",
  "André Carvalho",
  "Patrícia Gomes",
  "Rodrigo Vieira",
  "Natália Rocha",
  "Marcelo Teixeira",
  "Isabela Freitas",
] as const;

export function getDemoConsultations() {
  const states = [
    { status: "aprovado", resultado: "aprovado", policy: 101 },
    { status: "em_analise", resultado: "em_analise", policy: null },
    { status: "recusado", resultado: "recusado", policy: null },
    { status: "aprovado", resultado: "aprovado", policy: 102 },
    { status: "falta_documentos", resultado: "pendente", policy: null },
    { status: "aprovado", resultado: "aprovado", policy: 103 },
    { status: "processando", resultado: "pendente", policy: null },
  ] as const;

  return people.map((person, index) => {
    const state = states[index];
    return {
      id: id(index + 1),
      demo_record: true,
      status: state.status,
      resultado: state.resultado,
      substatus: null,
      technical_status: state.status,
      last_error_category: null,
      automation_step: state.status === "processando" ? "consultando_bureaus" : "demonstracao",
      policy_status: state.policy ? "ativa" : null,
      created_at: shiftedDate(-(index * 4 + 2)),
      updated_at: shiftedDate(-index),
      tenant_name: person[0],
      tenant_document: person[1],
      documento: person[1],
      property_address: `${person[4]}, ${person[2]} - ${person[3]}`,
      rent_value: 2200 + index * 310,
      payment_status: state.policy ? "paid" : null,
      inquilinos: { nome: person[0], cpf: person[1], cnpj: null },
      imoveis: {
        logradouro: person[4].split(",")[0],
        numero: person[4].split(",")[1]?.trim() || "100",
        bairro: "Centro",
        cidade: person[2],
        estado: person[3],
        cep: `88${300 + index * 7}-0${10 + index}`,
        valor_aluguel: 2200 + index * 310,
      },
      planos: { nome: index % 2 === 0 ? "Plano Essencial" : "Plano Completo" },
      apolices: state.policy ? [{ id: id(state.policy), status: "ativa" }] : [],
      solicitante: { nome: index % 2 === 0 ? "Vértice Imobiliária" : "João Corretor" },
      raw_cliente_nome: person[0],
      raw_customer_name: null,
      raw_nome_cliente: null,
      raw_identity_error_code: null,
    };
  });
}

export function getDemoPolicies() {
  return people.slice(0, 6).map((person, index) => ({
    id: id(101 + index),
    demo_record: true,
    numero: demoContractNumber(index),
    status: index === 4 ? "emitida_pendente" : "ativa",
    vigencia_inicio: shiftedDate(-(35 + index * 12)),
    vigencia_fim: shiftedDate(330 - index * 12),
    valor_premio: 1260 + index * 285,
    consulta: {
      profile_id_solicitante: id(900 + index),
      inquilino: { nome: person[0], cpf: person[1] },
      imovel: { endereco: person[4], cidade: person[2], estado: person[3] },
      plano: { nome: index % 2 === 0 ? "Plano Essencial" : "Plano Completo" },
      solicitante: { nome: index % 2 === 0 ? "Vértice Imobiliária" : "João Corretor" },
    },
    imobiliaria: { nome: "Vértice Imobiliária" },
  }));
}

export function getDemoTenantInvoiceSummaries(): TenantInvoiceSummary[] {
  const statuses: TenantInvoiceSummary["status"][] = [
    "a_vencer",
    "em_dia",
    "vencido",
    "a_vencer",
    "em_dia",
    "vencido",
  ];
  return people.slice(0, 6).map((person, index) => ({
    apolice_id: id(101 + index),
    numero: demoContractNumber(index),
    inquilino_nome: person[0],
    inquilino_doc: person[1],
    cidade: `${person[2]}, ${person[3]}`,
    valor_parcela: 189.9 + index * 47.5,
    proximo_venc: shiftedDate(index === 2 || index === 5 ? -(4 + index) : 5 + index * 3, true),
    status: statuses[index],
  }));
}

function getDemoPolicyIndex(policyId: string) {
  if (!isDemoRecordId(policyId)) return -1;
  const index = Number(policyId.slice(-12)) - 101;
  return Number.isInteger(index) && index >= 0 && index < 6 ? index : -1;
}

function getDemoPolicyInvoices(policyIndex: number): TenantInvoiceDisplayRow[] {
  const consultationId = id(policyIndex + 1);
  const amount = 189.9 + policyIndex * 47.5;
  const overdueContract = policyIndex === 2 || policyIndex === 5;

  return Array.from({ length: 12 }, (_, index) => {
    const installmentNumber = index + 1;
    const dueInDays = (index - 3) * 30 + 5 + policyIndex * 3;
    const paid = index < 3 || (!overdueContract && index === 3 && policyIndex % 3 === 1);
    const overdue = overdueContract && index === 3;
    const rawStatus = paid ? "paid" : overdue ? "overdue" : index === 3 ? "pending" : "scheduled";
    const dueDate = shiftedDate(overdue ? -(4 + policyIndex) : dueInDays, true);

    return {
      id: id(1300 + policyIndex * 20 + installmentNumber),
      invoiceId: null,
      consultationId,
      paymentMethod: policyIndex % 3 === 1 ? "pix" : "boleto",
      installmentNumber,
      installmentTotal: 12,
      dueDate,
      amount,
      status: paid ? "paid" : overdue ? "overdue" : "pending",
      rawStatus,
      paidAt: paid ? shiftedDate(dueInDays - 2) : null,
      boletoUrl: null,
      barcode:
        !paid && index === 3
          ? `00190.00009 01234.56789 01234.56789 ${policyIndex + 1} 000000${String(Math.round(amount * 100)).padStart(6, "0")}`
          : null,
      receiptUrl: null,
      paymentUrl: null,
      chargeKind: installmentNumber === 1 ? "initial" : "monthly",
      components:
        installmentNumber === 1
          ? { monthlyAmount: amount, initialExtrasAmount: 0 }
          : null,
    };
  });
}

export function getDemoPolicyDetail(policyId: string) {
  const policyIndex = getDemoPolicyIndex(policyId);
  if (policyIndex < 0) return null;

  const policy = getDemoPolicies()[policyIndex];
  const person = people[policyIndex];
  const consultationId = id(policyIndex + 1);
  const [street, number = "100"] = person[4].split(",").map((value) => value.trim());
  const rent = 2200 + policyIndex * 310;
  const condominium = 480 + policyIndex * 35;
  const fees = 120 + policyIndex * 15;
  const monthlyPremium = 189.9 + policyIndex * 47.5;
  const requesterIsAgency = policyIndex % 2 === 0;
  const createdAt = shiftedDate(-(95 + policyIndex * 12));
  const approvedAt = shiftedDate(-(93 + policyIndex * 12));
  const completedAt = shiftedDate(-(90 + policyIndex * 12));
  const signedAt = shiftedDate(-(82 + policyIndex * 12));
  const awaitingSignature = policy.status === "emitida_pendente";

  const apolice = {
    ...policy,
    consulta_id: consultationId,
    created_at: completedAt,
    imobiliaria_profile_id: id(800),
    corretor_profile_id: requesterIsAgency ? id(700 + policyIndex) : id(900 + policyIndex),
    consulta: {
      id: consultationId,
      status: "aprovado",
      resultado: "aprovado",
      created_at: createdAt,
      approved_at: approvedAt,
      dados_complementares_em: completedAt,
      proposta_enviada_em: shiftedDate(-(86 + policyIndex * 12)),
      profile_id_solicitante: requesterIsAgency ? id(800) : id(900 + policyIndex),
      role_solicitante: requesterIsAgency ? "imobiliaria" : "corretor",
      payment_status: "paid",
      payment_type: policyIndex % 2 === 0 ? "imobiliaria" : "inquilino",
      payment_confirmed_at: shiftedDate(-(84 + policyIndex * 12)),
      insurance_payment_method: policyIndex % 3 === 1 ? "pix" : "boleto",
      insurance_payment_method_label: policyIndex % 3 === 1 ? "Pix" : "Boleto bancário",
      contract_period_months: 12,
      documentos: { dados_complementares: {} },
      base_calculo: rent + condominium + fees,
      valor_aluguel: rent,
      valor_condominio: condominium,
      valor_taxas: fees,
      valor_premio_mensal: monthlyPremium,
      valor_anual: policy.valor_premio,
      selected_exit_cost: 180,
      insurance_assistance: "assistencia_residencial_24h",
      insurance_coverages: ["aluguel", "condominio", "iptu", "danos_ao_imovel"],
      plano_id: id(1500 + (policyIndex % 2)),
      terms_accepted_at: completedAt,
      contract_accepted_at: completedAt,
      tenant_name: person[0],
      tenant_document: person[1],
      tenant_email: `${person[0].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, ".")}@email.com`,
      tenant_telefone: `(47) 9999${String(2100 + policyIndex)}`,
      tenant_data_nascimento: `${1988 + policyIndex}-0${(policyIndex % 9) + 1}-15`,
      imovel_subtipo: "Apartamento",
      imovel_cep: `88${300 + policyIndex * 7}-0${10 + policyIndex}`,
      imovel_endereco: street,
      imovel_numero: number,
      imovel_complemento: policyIndex % 2 === 0 ? `Apto ${201 + policyIndex}` : null,
      imovel_bairro: "Centro",
      imovel_cidade: person[2],
      imovel_estado: person[3],
      inquilino: {
        nome: person[0],
        cpf: person[1],
        cnpj: null,
        razao_social: null,
        tipo: "pf",
        data_nascimento: `${1988 + policyIndex}-0${(policyIndex % 9) + 1}-15`,
        estado_civil: policyIndex % 2 === 0 ? "casado" : "solteiro",
        profissao: ["Arquiteta", "Engenheiro", "Administradora", "Analista", "Designer", "Empresário"][policyIndex],
        renda: 7800 + policyIndex * 950,
        rg: `${4 + policyIndex}.${String(321456 + policyIndex * 137)}-${policyIndex}`,
        score: 742 - policyIndex * 18,
        profile: {
          nome: person[0],
          email: `${person[0].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, ".")}@email.com`,
          telefone: `(47) 9999${String(2100 + policyIndex)}`,
        },
      },
      imovel: {
        endereco: person[4],
        logradouro: street,
        numero: number,
        complemento: policyIndex % 2 === 0 ? `Apto ${201 + policyIndex}` : null,
        bairro: "Centro",
        cidade: person[2],
        estado: person[3],
        cep: `88${300 + policyIndex * 7}-0${10 + policyIndex}`,
        tipo: "Apartamento",
        valor_aluguel: rent,
        valor_condominio: condominium,
        valor_taxas: fees,
        valor_iptu: 145 + policyIndex * 12,
        valor_fundo_reserva: 65 + policyIndex * 8,
        valor_taxa_lixo: 24.9,
      },
      plano: {
        nome: policyIndex % 2 === 0 ? "Plano Essencial" : "Plano Completo",
        taxa_premio: 8.5 + policyIndex * 0.2,
        cobertura_multiplicador: policyIndex % 2 === 0 ? 12 : 18,
        custo_saida: 180,
      },
      solicitante: {
        id: requesterIsAgency ? id(800) : id(900 + policyIndex),
        nome: requesterIsAgency ? "Vértice Imobiliária" : "João Corretor",
        email: requesterIsAgency ? "contato@verticeimobiliaria.com.br" : "joao.corretor@email.com",
        telefone: requesterIsAgency ? "(47) 3344-9080" : "(47) 99912-4545",
        role: requesterIsAgency ? "imobiliaria" : "corretor",
      },
    },
    imobiliaria: { nome: "Vértice Imobiliária", email: "contato@verticeimobiliaria.com.br" },
    corretor: { nome: requesterIsAgency ? "Ana Paula Ribeiro" : "João Corretor", email: "corretor@email.com" },
    proprietario: { nome: "Carlos Henrique Souza", email: "carlos.souza@email.com" },
  };

  const invoiceRows = getDemoPolicyInvoices(policyIndex);
  const faturas: ContractBillingRow[] = invoiceRows.map((invoice) => ({
    id: invoice.id,
    invoice_id: null,
    consultation_id: consultationId,
    payment_method: invoice.paymentMethod,
    numero_parcela: invoice.installmentNumber,
    installment_total: invoice.installmentTotal || 12,
    data_vencimento: invoice.dueDate,
    valor: invoice.amount,
    status: invoice.rawStatus,
    data_pagamento: invoice.paidAt,
    boleto_url: null,
    linha_digitavel: invoice.barcode,
    comprovante_url: null,
    source: "invoice",
  }));

  const signedPolicyDocument = {
    id: id(1600 + policyIndex * 10 + 3),
    file_name: `apolice-nox-${policy.numero}.pdf`,
    file_url: null,
    file_type: "application/pdf",
    document_type: "apolice",
    document_subtype: awaitingSignature ? "pendente_assinatura_d4sign" : "contratos-assinados",
    contract_signature_id: id(1700 + policyIndex),
    created_at: awaitingSignature ? completedAt : signedAt,
    updated_at: awaitingSignature ? completedAt : signedAt,
  };

  return {
    apolice,
    documentosContrato: [],
    documentosProposta: [
      {
        id: id(1600 + policyIndex * 10 + 1),
        file_name: `contrato-locacao-${policy.numero}.pdf`,
        file_url: null,
        file_type: "application/pdf",
        document_type: "contrato_locacao",
        document_subtype: "assinado_imobiliaria",
        created_at: completedAt,
        updated_at: signedAt,
      },
      {
        id: id(1600 + policyIndex * 10 + 2),
        file_name: `vistoria-imovel-${policy.numero}.pdf`,
        file_url: null,
        file_type: "application/pdf",
        document_type: "vistoria_imovel",
        document_subtype: "enviado",
        created_at: completedAt,
        updated_at: completedAt,
      },
      signedPolicyDocument,
    ],
    assinatura: {
      id: id(1700 + policyIndex),
      status: awaitingSignature ? "sent" : "signed",
      signature_status: awaitingSignature ? "pending" : "signed",
      sent_at: shiftedDate(-(85 + policyIndex * 12)),
      signed_at: awaitingSignature ? null : signedAt,
    },
    historico: [
      {
        id: id(1800 + policyIndex * 10 + 1),
        tipo_evento: awaitingSignature ? "assinatura_enviada" : "apolice_emitida",
        descricao: awaitingSignature
          ? "Contrato enviado para assinatura das partes"
          : "Apólice emitida e contrato ativado",
        created_at: awaitingSignature ? shiftedDate(-(85 + policyIndex * 12)) : signedAt,
      },
      ...(!awaitingSignature
        ? [{ id: id(1800 + policyIndex * 10 + 2), tipo_evento: "contrato_assinado", descricao: "Contrato assinado por todas as partes", created_at: shiftedDate(-(83 + policyIndex * 12)) }]
        : []),
      { id: id(1800 + policyIndex * 10 + 3), tipo_evento: "pagamento_confirmado", descricao: "Primeiro pagamento confirmado", created_at: shiftedDate(-(84 + policyIndex * 12)) },
      { id: id(1800 + policyIndex * 10 + 4), tipo_evento: "analise_aprovada", descricao: "Análise de crédito aprovada", created_at: approvedAt },
    ],
    faturas,
    invoiceRows,
  };
}

export function getDemoCollectionInvoices() {
  const statuses = ["pending", "paid", "overdue", "pending", "confirmed", "overdue"];
  return people.slice(0, 6).flatMap((person, contractIndex) =>
    [1, 2, 3].map((installment, installmentIndex) => {
      const status =
        installmentIndex === 0
          ? statuses[contractIndex]
          : installmentIndex === 1
            ? "pending"
            : "scheduled";
      return {
        id: id(300 + contractIndex * 10 + installment),
        consulta_id: id(contractIndex + 1),
        status,
        valor: 189.9 + contractIndex * 47.5,
        vencimento: shiftedDate((installmentIndex - 1) * 30 + contractIndex * 2, true),
        numero_parcela: installment,
        installment_total: 12,
        payment_method: contractIndex % 3 === 0 ? "pix" : "boleto",
        payment_responsible: contractIndex % 2 === 0 ? "agency" : "tenant",
        payment_url: null,
        boleto_url: null,
        linha_digitavel: null,
        consolidated_item_id: null,
        recipient_user_id: null,
        confirmed_at: ["paid", "confirmed"].includes(status) ? shiftedDate(-8) : null,
        asaas_payment_id: null,
        consulta: {
          id: id(contractIndex + 1),
          tenant_name: person[0],
          inquilino: { nome: person[0], cpf: person[1], cnpj: null, razao_social: null },
          imovel: { endereco: person[4], cidade: person[2], estado: person[3] },
        },
        asaas_payment: null,
        asaas_subscription: null,
        notifications: [],
        demo_record: true,
      };
    }),
  );
}

export function getDemoBrokers() {
  const brokers = [
    ["Ana Paula Ribeiro", "ana.ribeiro@demo.nox", "47991234001", "12345-F", "broker_full", 8],
    ["Bruno Henrique Lima", "bruno.lima@demo.nox", "47991234002", "18420-F", "split_50", 5],
    ["Carolina Mendes", "carolina.mendes@demo.nox", "47991234003", "22018-F", "agency_full", 11],
    ["Diego Fernandes", "diego.fernandes@demo.nox", "47991234004", "19987-F", "broker_full", 3],
    ["Fernanda Souza", "fernanda.souza@demo.nox", "47991234005", "24110-F", "split_50", 6],
    ["Gustavo Alves", "gustavo.alves@demo.nox", "47991234006", "25142-F", "broker_full", 0],
  ] as const;
  return brokers.map((broker, index) => ({
    membership_id: id(500 + index),
    membership_status: index === brokers.length - 1 ? "pending" : "active",
    corretor_id: id(600 + index),
    id: id(600 + index),
    profile_id: id(700 + index),
    cpf: `0${82 + index}.31${index}.74${index}-0${index}`,
    creci: broker[3],
    imobiliaria_id: id(800),
    vinculado_imobiliaria: index !== brokers.length - 1,
    commission_allocation_mode: broker[4],
    registered_at: shiftedDate(-(180 - index * 19)),
    linked_at: shiftedDate(-(160 - index * 17)),
    contracts_count: broker[5],
    nome: broker[0],
    email: broker[1],
    telefone: broker[2],
    profile_status: "ativo",
    profiles: {
      nome: broker[0],
      email: broker[1],
      telefone: broker[2],
      status: "ativo",
    },
    demo_record: true,
  }));
}

export function getDemoCommissionDashboard() {
  const contracts: CommissionContract[] = commissionTenantNames.map((tenantName, index) => ({
    id: id(101 + index),
    number: demoContractNumber(index),
    status: "ativa",
    start_date: shiftedDate(-(35 + index * 12)),
    end_date: shiftedDate(330 - index * 12),
    premium_cents: Math.round((1260 + index * 285) * 100),
    tenant_name: tenantName,
    financial_status: index === 2 ? "OVERDUE" : index === 4 ? "PAYMENT_PENDING" : "ON_TIME",
    commission_status:
      index < 2 ? "AVAILABLE" : index === 2 ? "PENDING" : index === 3 ? "PAID" : null,
    commission_cents: index < 4 ? 18900 + index * 7250 : null,
  }));
  const commissions: UserCommission[] = contracts.slice(0, 5).map((contract, index) => ({
    id: id(900 + index),
    contract_id: contract.id,
    contract_number: contract.number,
    tenant_name: contract.tenant_name,
    base_amount_cents: contract.premium_cents,
    percentage_applied: index % 2 === 0 ? 100 : 50,
    level_applied: index < 2 ? "Prata" : "Bronze",
    amount_cents: contract.commission_cents || 0,
    status: index < 2 ? "AVAILABLE" : index === 2 ? "PENDING" : index === 3 ? "PAID" : "RESERVED",
    created_at: shiftedDate(-(index * 13 + 4)),
    available_at: index < 2 ? shiftedDate(-(index + 2)) : null,
    withdrawal_id: index === 3 ? id(980) : null,
    withdrawal_status: index === 3 ? "PAID" : null,
    receipt_available: index === 3,
  }));
  const withdrawals: UserWithdrawal[] = [
    {
      id: id(980),
      amount_cents: 33400,
      fee_cents: 0,
      net_amount_cents: 33400,
      status: "PAID",
      bank_name: "Banco demonstrativo",
      holder_name: "Titular da conta demo",
      pix_key_type: "CPF",
      pix_key_masked: "***.482.***-18",
      requested_at: shiftedDate(-46),
      approved_at: shiftedDate(-44),
      paid_at: shiftedDate(-43),
      rejected_at: null,
      rejection_reason: null,
      receipt_available: true,
      contract_count: 2,
    },
  ];
  const summary: UserFinancialSummary = {
    pending_cents: 33400,
    available_cents: 45050,
    reserved_cents: 47900,
    total_accumulated_cents: 159750,
    total_withdrawn_cents: 33400,
    active_contracts:
      getDemoCareerScenario("imobiliaria")?.activeContracts ??
      contracts.filter((contract) => contract.status === "ativa").length,
    active_withdrawal_id: null,
    active_withdrawal_status: null,
    withdrawal_action: "AVAILABLE",
  };
  return {
    summary,
    commissions,
    withdrawals,
    contracts,
    level: (() => {
      const career = getDemoCareerScenario("imobiliaria");
      return career
        ? {
            nivelAtual: career.currentLevel,
            proximoNivel: career.nextLevel,
            contratosAtivos: career.activeContracts,
          }
        : null;
    })(),
  };
}

function demoBillingItem(
  consultationId: string,
  installmentNumber: number,
  status: string,
  amount: number,
  dueInDays: number,
): TenantBillingItem {
  return {
    id: id(1100 + Number(consultationId.slice(-2)) * 10 + installmentNumber),
    invoiceId: null,
    consultationId,
    localPaymentId: null,
    providerPaymentId: null,
    method: installmentNumber % 2 === 0 ? "pix" : "boleto",
    status,
    amount,
    dueDate: shiftedDate(dueInDays, true),
    paidAt: ["paid", "confirmed"].includes(status) ? shiftedDate(dueInDays - 2) : null,
    installmentNumber,
    installmentTotal: 12,
    boletoUrl: null,
    boletoBarcode: null,
    pixCopyPaste: null,
    pixQrCode: null,
    pixExpiresAt: null,
    paymentUrl: null,
    externalReference: `demo:${consultationId}:${installmentNumber}`,
    paymentResponsible: "tenant",
    subscriptionId: null,
    subscriptionLocalId: null,
    subscriptionMode: null,
    subscriptionStatus: null,
    cardRegistrationStatus: null,
    subscriptionCheckoutUrl: null,
    subscriptionInitialPaymentUrl: null,
    subscriptionInitialCheckoutStatus: null,
    subscriptionCheckoutStatus: null,
    subscriptionInitialAmount: 0,
    subscriptionMonthlyAmount: amount,
    subscriptionFireMode: "embutido",
    notificationCount: 0,
  };
}

export function getDemoTenantBilling(): {
  consultations: TenantBillingConsultation[];
  items: TenantBillingItem[];
} {
  const consultations: TenantBillingConsultation[] = people.slice(0, 3).map((person, index) => ({
    id: id(1200 + index),
    payment_type: "inquilino",
    insurance_payment_method: index === 1 ? "pix" : "boleto",
    contract_period_months: 12,
    imovel: { endereco: person[4], cidade: person[2], estado: person[3] },
    plano: { nome: index % 2 === 0 ? "Plano Essencial" : "Plano Completo" },
  }));
  const statusRows = [
    ["paid", "pending", "scheduled"],
    ["confirmed", "overdue", "pending"],
    ["paid", "paid", "pending"],
  ];
  return {
    consultations,
    items: consultations.flatMap((consultation, contractIndex) =>
      statusRows[contractIndex].map((status, installmentIndex) =>
        demoBillingItem(
          consultation.id,
          installmentIndex + 1,
          status,
          219.9 + contractIndex * 65,
          (installmentIndex - 1) * 30 + contractIndex * 2,
        ),
      ),
    ),
  };
}
