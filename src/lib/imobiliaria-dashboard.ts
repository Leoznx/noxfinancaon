import { supabase } from "@/integrations/supabase/client";
import { CONSULTA_STATUS_PENDENTE } from "@/lib/dashboard-stats";

export type ImobiliariaDashboardMonth = {
  key: string;
  label: string;
  consultas: number;
  contratos: number;
  comissoes: number;
};

export type ImobiliariaDashboardStatus = {
  key: "aprovadas" | "analise" | "pendentes";
  label: string;
  value: number;
  color: string;
};

export type ImobiliariaDashboardActivity = {
  id: string;
  type: "contrato" | "aprovacao" | "consulta";
  title: string;
  detail: string;
  createdAt: string;
};

export type ImobiliariaDashboardDocument = {
  id: string;
  type: string;
  tenant: string;
  status: "aguardando" | "pendente" | "aprovado";
};

export type ImobiliariaDashboardInvoice = {
  id: string;
  number: string;
  dueDate: string;
  value: number;
  daysUntilDue: number;
};

export type ImobiliariaDashboardNotification = {
  id: string;
  value: number;
  createdAt: string;
};

export type ImobiliariaDashboardData = {
  agencyName: string;
  stats: {
    consultasPendentes: number;
    apolicesAtivas: number;
    inquilinosGestao: number;
    comissoesAcumuladas: number;
  };
  trends: {
    consultas: number;
    apolices: number;
    inquilinos: number;
    comissoes: number;
  };
  months: ImobiliariaDashboardMonth[];
  policyStatus: ImobiliariaDashboardStatus[];
  activities: ImobiliariaDashboardActivity[];
  documents: ImobiliariaDashboardDocument[];
  invoices: ImobiliariaDashboardInvoice[];
  notifications: ImobiliariaDashboardNotification[];
};

const APPROVED_WORKFLOW = new Set([
  "aprovado",
  "approved",
  "aprovada",
  "ativa",
  "active",
  "pendente_documentacao",
  "dados_complementares",
  "finalizada",
  "aguardando_ativacao",
  "ativado",
]);
const ANALYSIS_WORKFLOW = new Set(["processando", "em_analise", "analysis", "risk_analysis"]);
const REJECTED_WORKFLOW = new Set([
  "reprovado",
  "reprovada",
  "recusado",
  "recusada",
  "rejected",
  "denied",
]);
const PAID_INVOICE_STATUS = new Set([
  "paid",
  "confirmed",
  "received",
  "pago",
  "cancelled",
  "canceled",
]);

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function consultationWorkflow(
  consultation: { id?: string; status?: unknown; resultado?: unknown },
  policyConsultationIds: Set<string>,
) {
  if (consultation.id && policyConsultationIds.has(consultation.id)) return "approved" as const;

  const values = [normalize(consultation.resultado), normalize(consultation.status)].filter(Boolean);
  if (values.some((value) => APPROVED_WORKFLOW.has(value))) return "approved" as const;
  if (values.some((value) => REJECTED_WORKFLOW.has(value))) return "rejected" as const;
  if (values.some((value) => ANALYSIS_WORKFLOW.has(value))) return "analysis" as const;
  return "pending" as const;
}

function relation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function tenantName(consulta: any) {
  const tenant = relation<any>(consulta?.inquilino);
  return consulta?.tenant_name || tenant?.razao_social || tenant?.nome || "Inquilino não informado";
}

function propertyLabel(consulta: any) {
  if (consulta?.property_address) return consulta.property_address;
  const property = relation<any>(consulta?.imovel);
  return [property?.logradouro || property?.endereco, property?.numero, property?.cidade]
    .filter(Boolean)
    .join(", ") || "Imóvel não informado";
}

function monthKey(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function trend(current: number, previous: number) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function monthRange(count = 12) {
  const formatter = new Intl.DateTimeFormat("pt-BR", { month: "short" });
  const current = new Date();
  current.setDate(1);
  current.setHours(0, 0, 0, 0);

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(current.getFullYear(), current.getMonth() - (count - 1 - index), 1);
    return {
      key: monthKey(date),
      label: formatter.format(date).replace(".", "").replace(/^./, (letter) => letter.toUpperCase()),
      date,
    };
  });
}

async function resolveAgency(profileId: string, email: string) {
  const { data: agency, error: agencyError } = await supabase
    .from("imobiliarias")
    .select("id, razao_social, nome_fantasia")
    .ilike("contato_email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (agencyError) throw agencyError;

  const profileIds = [profileId];
  if (agency?.id) {
    const { data: brokers, error: brokersError } = await supabase
      .from("corretores")
      .select("profile_id")
      .eq("imobiliaria_id", agency.id);
    if (brokersError) throw brokersError;
    for (const broker of brokers ?? []) {
      if (broker.profile_id && !profileIds.includes(broker.profile_id)) profileIds.push(broker.profile_id);
    }
  }

  return {
    profileIds,
    agencyName: agency?.nome_fantasia || agency?.razao_social || "Sua imobiliária",
  };
}

export async function fetchImobiliariaDashboard(
  profileId: string,
  email: string,
): Promise<ImobiliariaDashboardData> {
  const { profileIds, agencyName } = await resolveAgency(profileId, email);
  const monthsBase = monthRange(12);

  const [consultationsResult, commissionsResult] = await Promise.all([
    supabase
      .from("consultas_credito")
      .select(`
        id, status, resultado, created_at, updated_at, approved_at,
        inquilino_id, tenant_name, property_address, profile_id_solicitante,
        inquilino:inquilinos(nome, razao_social),
        imovel:imoveis(endereco, logradouro, numero, cidade)
      `)
      .in("profile_id_solicitante", profileIds)
      .order("created_at", { ascending: false }),
    supabase
      .from("comissoes")
      .select("id, valor, status, created_at, contrato_id")
      .in("beneficiario_id", profileIds)
      .order("created_at", { ascending: false }),
  ]);
  if (consultationsResult.error) throw consultationsResult.error;
  if (commissionsResult.error) throw commissionsResult.error;

  const consultations = (consultationsResult.data ?? []) as any[];
  const commissions = (commissionsResult.data ?? []) as any[];
  const consultationIds = consultations.map((row) => row.id);

  const policiesResult = consultationIds.length
    ? await supabase
        .from("apolices")
        .select("id, numero, status, created_at, consulta_id")
        .in("consulta_id", consultationIds)
        .order("created_at", { ascending: false })
    : { data: [], error: null };
  if (policiesResult.error) throw policiesResult.error;
  const policies = (policiesResult.data ?? []) as any[];
  const policyIds = policies.map((row) => row.id);
  const policyConsultationIds = new Set<string>(
    policies.map((row) => row.consulta_id).filter((id): id is string => Boolean(id)),
  );

  const [documentsResult, invoicesResult] = await Promise.all([
    policyIds.length
      ? supabase
          .from("documentos_contrato")
          .select("id, apolice_id, tipo, status, created_at")
          .in("apolice_id", policyIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    consultationIds.length
      ? supabase
          .from("faturas_inquilino")
          .select("id, consulta_id, numero_parcela, valor, vencimento, status")
          .in("consulta_id", consultationIds)
          .order("vencimento", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (documentsResult.error) throw documentsResult.error;
  if (invoicesResult.error) throw invoicesResult.error;

  const consultationById = new Map(consultations.map((row) => [row.id, row]));
  const policyById = new Map(policies.map((row) => [row.id, row]));
  const commissionByPolicy = new Map<string, number>();
  for (const commission of commissions) {
    commissionByPolicy.set(
      commission.contrato_id,
      (commissionByPolicy.get(commission.contrato_id) ?? 0) + Number(commission.valor || 0),
    );
  }

  const activePolicies = policies.filter((policy) => ["ativa", "active"].includes(normalize(policy.status)));
  const activeTenantIds = new Set(
    activePolicies
      .map((policy) => consultationById.get(policy.consulta_id)?.inquilino_id)
      .filter(Boolean),
  );
  const consultationsPending = consultations.filter((row) =>
    CONSULTA_STATUS_PENDENTE.includes(normalize(row.status)),
  );

  const months: ImobiliariaDashboardMonth[] = monthsBase.map((month) => ({
    key: month.key,
    label: month.label,
    consultas: consultations.filter((row) => monthKey(row.created_at) === month.key).length,
    contratos: policies.filter((row) => monthKey(row.created_at) === month.key).length,
    comissoes: commissions
      .filter((row) => row.created_at && monthKey(row.created_at) === month.key)
      .reduce((sum, row) => sum + Number(row.valor || 0), 0),
  }));

  const currentMonth = months.at(-1)!;
  const previousMonth = months.at(-2)!;
  const currentPolicies = policies.filter((row) => monthKey(row.created_at) === currentMonth.key);
  const previousPolicies = policies.filter((row) => monthKey(row.created_at) === previousMonth.key);
  const currentTenants = new Set(
    currentPolicies.map((row) => consultationById.get(row.consulta_id)?.inquilino_id).filter(Boolean),
  ).size;
  const previousTenants = new Set(
    previousPolicies.map((row) => consultationById.get(row.consulta_id)?.inquilino_id).filter(Boolean),
  ).size;

  const workflowTotals = consultations.reduce(
    (totals, consultation) => {
      const workflow = consultationWorkflow(consultation, policyConsultationIds);
      if (workflow !== "rejected") totals[workflow] += 1;
      return totals;
    },
    { approved: 0, analysis: 0, pending: 0 },
  );
  const policyStatus: ImobiliariaDashboardStatus[] = [
    { key: "aprovadas", label: "Aprovadas", value: workflowTotals.approved, color: "#FFC400" },
    { key: "analise", label: "Em análise", value: workflowTotals.analysis, color: "#171717" },
    { key: "pendentes", label: "Pendentes", value: workflowTotals.pending, color: "#E5E5E5" },
  ];

  const policyActivities: ImobiliariaDashboardActivity[] = policies.slice(0, 5).map((policy) => ({
    id: `policy-${policy.id}`,
    type: "contrato",
    title: `Contrato fechado #${policy.numero || policy.id.slice(0, 8).toUpperCase()}`,
    detail: commissionByPolicy.has(policy.id)
      ? `Comissão gerada: ${formatCurrency(commissionByPolicy.get(policy.id)!)}`
      : `Inquilino: ${tenantName(consultationById.get(policy.consulta_id))}`,
    createdAt: policy.created_at,
  }));
  const approvedActivities: ImobiliariaDashboardActivity[] = consultations
    .filter((row) => consultationWorkflow(row, policyConsultationIds) === "approved")
    .slice(0, 5)
    .map((row) => ({
      id: `approval-${row.id}`,
      type: "aprovacao",
      title: `Consulta aprovada #${row.id.slice(0, 8).toUpperCase()}`,
      detail: `Inquilino: ${tenantName(row)}`,
      createdAt: row.approved_at || row.updated_at,
    }));
  const consultationActivities: ImobiliariaDashboardActivity[] = consultations.slice(0, 5).map((row) => ({
    id: `consultation-${row.id}`,
    type: "consulta",
    title: `Nova consulta criada #${row.id.slice(0, 8).toUpperCase()}`,
    detail: `Imóvel: ${propertyLabel(row)}`,
    createdAt: row.created_at,
  }));

  const documents: ImobiliariaDashboardDocument[] = ((documentsResult.data ?? []) as any[])
    .filter((row) => !["aprovado", "approved", "concluido", "validado"].includes(normalize(row.status)))
    .slice(0, 4)
    .map((row) => {
      const policy = policyById.get(row.apolice_id);
      const consultation = consultationById.get(policy?.consulta_id);
      const status = normalize(row.status);
      return {
        id: row.id,
        type: formatDocumentType(row.tipo),
        tenant: tenantName(consultation),
        status: status.includes("aguard") ? "aguardando" : "pendente",
      };
    });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const invoices: ImobiliariaDashboardInvoice[] = ((invoicesResult.data ?? []) as any[])
    .filter((row) => !PAID_INVOICE_STATUS.has(normalize(row.status)) && new Date(`${row.vencimento}T12:00:00`) >= today)
    .slice(0, 8)
    .map((row) => {
      const due = new Date(`${row.vencimento}T12:00:00`);
      return {
        id: row.id,
        number: `FT-${String(row.numero_parcela).padStart(2, "0")}${row.id.slice(0, 4).toUpperCase()}`,
        dueDate: row.vencimento,
        value: Number(row.valor || 0),
        daysUntilDue: Math.max(0, Math.ceil((due.getTime() - today.getTime()) / 86_400_000)),
      };
    });

  const activities = [...policyActivities, ...approvedActivities, ...consultationActivities]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 3);

  return {
    agencyName,
    stats: {
      consultasPendentes: consultationsPending.length,
      apolicesAtivas: activePolicies.length,
      inquilinosGestao: activeTenantIds.size,
      comissoesAcumuladas: commissions.reduce((sum, row) => sum + Number(row.valor || 0), 0),
    },
    trends: {
      consultas: trend(currentMonth.consultas, previousMonth.consultas),
      apolices: trend(currentMonth.contratos, previousMonth.contratos),
      inquilinos: trend(currentTenants, previousTenants),
      comissoes: trend(currentMonth.comissoes, previousMonth.comissoes),
    },
    months,
    policyStatus,
    activities,
    documents,
    invoices,
    notifications: commissions
      .filter((row) => row.created_at)
      .slice(0, 4)
      .map((row) => ({ id: row.id, value: Number(row.valor || 0), createdAt: row.created_at })),
  };
}

export function formatCurrency(value: number) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDocumentType(value: string) {
  const labels: Record<string, string> = {
    contrato_locacao: "Contrato de locação",
    comprovante_renda: "Comprovante de renda",
    rg_cpf: "RG e CPF",
    declaracao_ir: "Declaração de IR",
  };
  const normalized = normalize(value).replace(/\s+/g, "_");
  if (labels[normalized]) return labels[normalized];
  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Documento";
}
