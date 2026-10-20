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

const keyFor = (userId: string) => `dashboard-route:${userId}:faturas-inquilinos`;

function cityOf(property: any): string {
  if (!property) return "Cidade não informada";
  if (property.cidade) return property.cidade;
  const address = property.endereco || property.logradouro;
  if (typeof address === "string" && address.includes(",")) {
    const parts = address.split(",").map((part: string) => part.trim()).filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 2] || parts[parts.length - 1];
  }
  return "Cidade não informada";
}

export function peekTenantInvoiceSummaries(userId: string) {
  return peekSessionResource<TenantInvoiceSummary[]>(keyFor(userId));
}

export function loadTenantInvoiceSummaries(userId: string, force = false) {
  return loadSessionResource(
    keyFor(userId),
    async (): Promise<TenantInvoiceSummary[]> => {
      const { data, error } = await supabase
        .from("apolices")
        .select(`
          id, numero, status,
          consulta:consultas_credito(
            inquilino:inquilinos(nome, cpf, cnpj, razao_social),
            imovel:imoveis(endereco, logradouro, numero, bairro, cidade, estado)
          ),
          mensalidades(valor, data_vencimento, status)
        `)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return (data ?? []).map((policy: any) => {
        const installments = policy.mensalidades ?? [];
        const pending = installments
          .filter((item: any) => item.status !== "pago" && item.status !== "cancelado")
          .sort((a: any, b: any) => new Date(a.data_vencimento).getTime() - new Date(b.data_vencimento).getTime());
        const overdue = pending.find((item: any) => new Date(item.data_vencimento) < today);
        const upcoming = pending.find((item: any) => new Date(item.data_vencimento) >= today);
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
    },
    { force, maxAgeMs: 60_000 },
  );
}
