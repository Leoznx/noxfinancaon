import { supabase } from "@/integrations/supabase/client";
import { loadSessionResource, peekSessionResource } from "@/lib/session-resource-cache";
import {
  normalizeCanonicalTenantInvoices,
  normalizeLegacyTenantInvoices,
  pickNextOpenInvoice,
  pickRecurringInvoiceValue,
} from "@/lib/tenant-invoice-display";
import { readBillingRows } from "@/lib/billing-scope";

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
    const parts = address
      .split(",")
      .map((part: string) => part.trim())
      .filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 2] || parts[parts.length - 1];
  }
  return "Cidade não informada";
}

export function peekTenantInvoiceSummaries(userId: string) {
  return peekSessionResource<TenantInvoiceSummary[]>(keyFor(userId));
}

async function fetchTenantInvoiceSummaries(): Promise<TenantInvoiceSummary[]> {
  const { data, error } = await supabase
    .from("apolices")
    .select(
      `
          id, numero, status,
          consulta:consultas_credito(
            inquilino:inquilinos(nome, cpf, cnpj, razao_social),
            imovel:imoveis(endereco, logradouro, numero, bairro, cidade, estado)
          ),
          mensalidades(id, numero_parcela, valor, data_vencimento, data_pagamento, status)
        `,
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw error;

  const canonicalByPolicy = new Map<string, any[]>();
  const invoiceRows = await readBillingRows<any>(
    null,
    "faturas_inquilino",
    "id, apolice_id, numero_parcela, installment_total, vencimento, valor, status, pago_em, confirmed_at, charge_kind, components",
  );
  for (const invoice of invoiceRows) {
    if (!invoice.apolice_id) continue;
    const rows = canonicalByPolicy.get(invoice.apolice_id) ?? [];
    rows.push(invoice);
    canonicalByPolicy.set(invoice.apolice_id, rows);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rows = (data ?? []).map((policy: any): TenantInvoiceSummary => {
    const canonicalRows = canonicalByPolicy.get(policy.id) ?? [];
    const installments = canonicalRows.length
      ? normalizeCanonicalTenantInvoices(canonicalRows, today)
      : normalizeLegacyTenantInvoices(policy.mensalidades ?? [], today);
    const nextOpen = pickNextOpenInvoice(installments);
    const hasOverdue = installments.some((item) => item.status === "overdue");
    const tenant = policy.consulta?.inquilino;
    return {
      apolice_id: policy.id,
      numero: policy.numero,
      inquilino_nome: tenant?.nome || tenant?.razao_social || "Inquilino não informado",
      inquilino_doc: tenant?.cpf || tenant?.cnpj || "",
      cidade: cityOf(policy.consulta?.imovel),
      valor_parcela: pickRecurringInvoiceValue(installments),
      proximo_venc: nextOpen?.dueDate || null,
      status: hasOverdue ? "vencido" : nextOpen ? "a_vencer" : "em_dia",
    };
  });
  return rows;
}

export function loadTenantInvoiceSummaries(userId: string, force = false) {
  return loadSessionResource(keyFor(userId), fetchTenantInvoiceSummaries, {
    force,
    maxAgeMs: 60_000,
  });
}
