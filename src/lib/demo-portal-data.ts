import type {
  CommissionContract,
  UserCommission,
  UserFinancialSummary,
  UserWithdrawal,
} from "@/lib/withdrawals";
import type { TenantBillingConsultation, TenantBillingItem } from "@/lib/tenant-billing";
import type { TenantInvoiceSummary } from "@/lib/tenant-invoice-summary";

export const DEMO_RECORD_PREFIX = "d3000000-0000-4000-8000-";

const id = (value: number) => `${DEMO_RECORD_PREFIX}${String(value).padStart(12, "0")}`;

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
    numero: `NOX-DEMO-${String(index + 1).padStart(4, "0")}`,
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
    numero: `NOX-DEMO-${String(index + 1).padStart(4, "0")}`,
    inquilino_nome: person[0],
    inquilino_doc: person[1],
    cidade: `${person[2]}, ${person[3]}`,
    valor_parcela: 189.9 + index * 47.5,
    proximo_venc: shiftedDate(index === 2 || index === 5 ? -(4 + index) : 5 + index * 3, true),
    status: statuses[index],
  }));
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
  const contracts: CommissionContract[] = getDemoPolicies().map((policy, index) => ({
    id: policy.id,
    number: policy.numero,
    status: policy.status === "ativa" ? "ativa" : "pendente",
    start_date: policy.vigencia_inicio,
    end_date: policy.vigencia_fim,
    premium_cents: Math.round(policy.valor_premio * 100),
    tenant_name: policy.consulta.inquilino.nome,
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
    active_contracts: contracts.filter((contract) => contract.status === "ativa").length,
    active_withdrawal_id: null,
    active_withdrawal_status: null,
    withdrawal_action: "UNAVAILABLE",
  };
  return { summary, commissions, withdrawals, contracts, level: null };
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


