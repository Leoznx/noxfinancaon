import { supabase } from "@/integrations/supabase/client";

// Estados de consultas_credito que ainda não chegaram a um resultado final
// (ver CHECK consultas_credito_status_check na migration 20260704190000).
export const CONSULTA_STATUS_PENDENTE = [
  "pendente",
  "processando",
  "em_analise",
  "pendente_documentacao",
  "dados_complementares",
  "aguardando_ativacao",
];

export type DashboardStats = {
  consultasPendentes: number;
  apolicesAtivas: number;
  inquilinosGestao: number;
  comissoesAcumuladas: number;
};

const STATS_VAZIAS: DashboardStats = {
  consultasPendentes: 0,
  apolicesAtivas: 0,
  inquilinosGestao: 0,
  comissoesAcumuladas: 0,
};

/**
 * Números reais do dashboard (nunca mock/fixo). `profileIds` é a lista de
 * profiles cujas consultas contam pro card (o próprio usuário, ou ele +
 * seus corretores no caso de imobiliária) — passe `null` para admin, que vê
 * o total geral sem filtro.
 */
export async function fetchDashboardStats(profileIds: string[] | null): Promise<DashboardStats> {
  try {
    let consultasQuery = supabase.from("consultas_credito").select("id, status, inquilino_id");
    if (profileIds) consultasQuery = consultasQuery.in("profile_id_solicitante", profileIds);

    let saldosQuery = supabase.from("saldos_comissao" as any).select("total_acumulado");
    if (profileIds) saldosQuery = saldosQuery.in("profile_id", profileIds);

    // consultas e saldos não dependem uma da outra — dispara as duas de uma vez
    // em vez de esperar uma pra só depois começar a outra (era uma das 3 idas ao
    // banco em sequência que deixavam o dashboard lento pra carregar os números).
    const [{ data: consultasData, error: consultasErr }, { data: saldosData, error: saldosErr }] = await Promise.all([
      consultasQuery,
      saldosQuery,
    ]);
    if (consultasErr) throw consultasErr;
    if (saldosErr) throw saldosErr;
    const consultas = consultasData ?? [];

    const consultasPendentes = consultas.filter((c: any) => CONSULTA_STATUS_PENDENTE.includes(c.status)).length;

    let apolicesAtivas = 0;
    let inquilinosGestao = 0;
    const consultaIds = consultas.map((c: any) => c.id);
    if (consultaIds.length > 0) {
      const { data: apolicesData, error: apolicesErr } = await supabase
        .from("apolices")
        .select("id, consulta_id")
        .eq("status", "ativa")
        .in("consulta_id", consultaIds);
      if (apolicesErr) throw apolicesErr;

      apolicesAtivas = (apolicesData ?? []).length;

      const consultaPorId = new Map(consultas.map((c: any) => [c.id, c]));
      const inquilinosUnicos = new Set(
        (apolicesData ?? [])
          .map((a: any) => consultaPorId.get(a.consulta_id)?.inquilino_id)
          .filter(Boolean),
      );
      inquilinosGestao = inquilinosUnicos.size;
    }

    const comissoesAcumuladas = (saldosData ?? []).reduce(
      (soma: number, s: any) => soma + (Number(s.total_acumulado) || 0),
      0,
    );

    return { consultasPendentes, apolicesAtivas, inquilinosGestao, comissoesAcumuladas };
  } catch (e) {
    console.error("[fetchDashboardStats] erro ao buscar números reais:", e);
    return STATS_VAZIAS;
  }
}
