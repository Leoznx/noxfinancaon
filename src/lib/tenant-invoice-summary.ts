import { supabase } from "@/integrations/supabase/client";
import { loadSessionResource, peekSessionResource } from "@/lib/session-resource-cache";

export type TenantInvoiceSummary = {
  apolice_id: string;
  numero: string;
  inquilino_nome: string;
  inquilino_doc: string;
  cidade: string;
  valor_parcela: number;
  proximo_venc: string | null;
  status: "em_dia" | "a_vencer" | "vencido";
};

export type TenantInvoiceSummaryPage = {
  rows: TenantInvoiceSummary[];
  hasMore: boolean;
};

export const TENANT_INVOICE_PAGE_SIZE = 50;

const keyFor = (userId: string) => `dashboard-route:${userId}:faturas-inquilinos`;

function cityOf(property: any): string {
  if (!property) return "Cidade não informada";
  if (property.cidade) return property.cidade;
  const address = property.endereco || property.logradouro;
  if (typeof address === "string" && address.includes(",")) {
    const parts = address
      .split(",")
      .map((part: string) => part.trim())
      .filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 2] || parts[parts.length - 1];
  }
  return "Cidade não informada";
}

export function peekTenantInvoiceSummaries(userId: string) {
  return peekSessionResource<TenantInvoiceSummaryPage>(keyFor(userId));
}

export async function fetchTenantInvoiceSummariesPage(
  offset = 0,
): Promise<TenantInvoiceSummaryPage> {
  const { data, error } = await supabase
    .from("apolices")
    .select(
      `
          id, numero, status,
          consulta:consultas_credito(
            inquilino:inquilinos(nome, cpf, cnpj, razao_social),
            imovel:imoveis(endereco, logradouro, numero, bairro, cidade, estado)
          ),
          mensalidades(valor, data_vencimento, status)
        `,
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + TENANT_INVOICE_PAGE_SIZE);
  if (error) throw error;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rows = (data ?? [])
    .slice(0, TENANT_INVOICE_PAGE_SIZE)
    .map((policy: any): TenantInvoiceSummary => {
      const installments = policy.mensalidades ?? [];
      let overdue: any = null;
      let upcoming: any = null;
      for (const item of installments) {
        if (item.status === "pago" || item.status === "cancelado") continue;
        const due = new Date(item.data_vencimento);
        if (due < today && (!overdue || due < new Date(overdue.data_vencimento))) overdue = item;
        if (due >= today && (!upcoming || due < new Date(upcoming.data_vencimento)))
          upcoming = item;
      }
      const reference = overdue || upcoming || installments[0];
      const tenant = policy.consulta?.inquilino;
      return {
        apolice_id: policy.id,
        numero: policy.numero,
        inquilino_nome: tenant?.nome || tenant?.razao_social || "Inquilino não informado",
        inquilino_doc: tenant?.cpf || tenant?.cnpj || "",
        cidade: cityOf(policy.consulta?.imovel),
        valor_parcela: Number(reference?.valor || 0),
        proximo_venc: (upcoming || overdue)?.data_vencimento || null,
        status: overdue ? "vencido" : upcoming ? "a_vencer" : "em_dia",
      };
    });
  return { rows, hasMore: (data ?? []).length > TENANT_INVOICE_PAGE_SIZE };
}

export function loadTenantInvoiceSummaries(userId: string, force = false) {
  return loadSessionResource(keyFor(userId), () => fetchTenantInvoiceSummariesPage(), {
    force,
    maxAgeMs: 60_000,
  });
}
