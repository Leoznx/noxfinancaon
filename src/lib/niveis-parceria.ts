import { supabase } from "@/integrations/supabase/client";

export type NivelInfo = {
  nivelAtual: any;
  proximoNivel: any;
  contratosAtivos: number;
};

/**
 * Calcula o nível de parceria real (contratos ativos vinculados) — nada de
 * dado fixo/demo. Conta apólices ativas via consultas_credito.profile_id_solicitante,
 * não pelas colunas apolices.corretor_profile_id/imobiliaria_profile_id/
 * proprietario_profile_id — confirmado direto no banco que essas colunas não
 * são preenchidas pelo fluxo atual de criação de apólice, então contar por
 * elas sempre dava 0 mesmo com contratos reais vinculados ao profile.
 */
export async function fetchNivelInfo(profileId: string, role: string): Promise<NivelInfo | null> {
  const [niveisRes, consultasRes] = await Promise.all([
    supabase.from("niveis_perfil" as any).select("*").eq("tipo_perfil", role).eq("ativo", true).order("ordem", { ascending: true }),
    supabase.from("consultas_credito").select("id").eq("profile_id_solicitante", profileId),
  ]);
  if (niveisRes.error) throw niveisRes.error;
  if (consultasRes.error) throw consultasRes.error;

  const consultaIds = (consultasRes.data ?? []).map((c: any) => c.id);
  let contratosAtivos = 0;
  if (consultaIds.length > 0) {
    const { count, error: apolicesErr } = await supabase
      .from("apolices")
      .select("id", { count: "exact", head: true })
      .eq("status", "ativa")
      .in("consulta_id", consultaIds);
    if (apolicesErr) throw apolicesErr;
    contratosAtivos = count ?? 0;
  }

  const niveis = (niveisRes.data || []) as any[];

  let nivelAtual: any = null;
  let proximoNivel: any = null;
  if (niveis.length > 0) {
    const decrescente = [...niveis].reverse();
    nivelAtual = decrescente.find((n: any) => contratosAtivos >= n.min_contratos) || niveis[0];
    const idxAtual = niveis.findIndex((n: any) => n.id === nivelAtual.id);
    proximoNivel = niveis[idxAtual + 1] || null;
  }

  return { nivelAtual, proximoNivel, contratosAtivos };
}
