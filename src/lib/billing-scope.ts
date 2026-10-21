import { supabase } from "@/integrations/supabase/client";
import { loadSessionResource } from "@/lib/session-resource-cache";
import { loadAgencyScope } from "@/lib/agency-scope";

export type BillingScopeUser = { id: string; email: string; role: string };
export type BillingScope = { userId: string; consultationIds: string[]; policyIds: string[] };

/** Resolve apenas IDs autorizados. A RLS continua aplicada em todas as leituras. */
export function loadBillingScope(user: BillingScopeUser, force = false) {
  return loadSessionResource(
    `dashboard-route:${user.id}:billing-scope:${user.role}`,
    async (): Promise<BillingScope | null> => {
      if (!["corretor", "imobiliaria", "proprietario", "inquilino"].includes(user.role))
        return null;
      const profileIds = [user.id];
      if (user.role === "imobiliaria") {
        const agency = await loadAgencyScope(user);
        profileIds.splice(0, profileIds.length, ...agency.profileIds);
      }
      const consultationIds = new Set<string>();
      const policyIds: string[] = [];
      const pageSize = 500;
      // Inclui apólices vinculadas ao proprietário e vínculos legados que não
      // dependem da autoria da consulta. Não depende do limite visual de listas.
      await Promise.all([
        (async () => {
          for (let offset = 0; ; offset += pageSize) {
            const result = await supabase
              .from("consultas_credito")
              .select("id")
              .or(
                `profile_id_solicitante.in.(${[...new Set(profileIds)].join(",")}),tenant_user_id.eq.${user.id},billing_responsible_user_id.eq.${user.id},tenant_email.eq.${JSON.stringify(user.email)}`,
              )
              .order("id")
              .range(offset, offset + pageSize - 1);
            if (result.error) throw result.error;
            for (const row of result.data ?? []) consultationIds.add(row.id);
            if ((result.data?.length ?? 0) < pageSize) break;
          }
        })(),
        (async () => {
          for (let offset = 0; ; offset += pageSize) {
            const result = await supabase
              .from("apolices")
              .select("id, consulta_id")
              .order("id")
              .range(offset, offset + pageSize - 1);
            if (result.error) throw result.error;
            for (const row of result.data ?? []) {
              policyIds.push(row.id);
              if (row.consulta_id) consultationIds.add(row.consulta_id);
            }
            if ((result.data?.length ?? 0) < pageSize) break;
          }
        })(),
      ]);
      return { userId: user.id, consultationIds: [...consultationIds], policyIds };
    },
    { force, maxAgeMs: 60_000 },
  );
}

/** Filtro de execução, nunca de autorização: preserva destinatários diretos. */
type BillingTable = "faturas_inquilino" | "asaas_payments" | "asaas_subscriptions";

export function billingScopeFilters(scope: BillingScope, table: BillingTable) {
  const filters: string[] = [];
  const count = Math.max(
    scope.consultationIds.length,
    table === "faturas_inquilino" ? scope.policyIds.length : 0,
    1,
  );
  for (let offset = 0; offset < count; offset += 100) {
    const clauses = [`recipient_user_id.eq.${scope.userId}`];
    clauses.push(`tenant_user_id.eq.${scope.userId}`);
    if (table === "asaas_payments") clauses.push(`user_id.eq.${scope.userId}`);
    const consultationIds = scope.consultationIds.slice(offset, offset + 100);
    const policyIds = scope.policyIds.slice(offset, offset + 100);
    if (consultationIds.length) {
      clauses.push(
        `${table === "faturas_inquilino" ? "consulta_id" : "consultation_id"}.in.(${consultationIds.join(",")})`,
      );
    }
    if (table === "faturas_inquilino" && policyIds.length)
      clauses.push(`apolice_id.in.(${policyIds.join(",")})`);
    filters.push(clauses.join(","));
  }
  return filters;
}

export async function readBillingRows<T = any>(
  scope: BillingScope | null,
  table: BillingTable,
  select: string,
): Promise<T[]> {
  const rows = new Map<string, T>();
  const pageSize = 500;
  for (const filter of scope ? billingScopeFilters(scope, table) : [null]) {
    for (let offset = 0; ; offset += pageSize) {
      let query = (supabase as any)
        .from(table)
        .select(select)
        .order("id")
        .range(offset, offset + pageSize - 1);
      if (filter) query = query.or(filter);
      const { data, error } = await query;
      if (error) throw error;
      for (const row of data ?? []) rows.set(row.id, row);
      if ((data?.length ?? 0) < pageSize) break;
    }
  }
  return [...rows.values()];
}
