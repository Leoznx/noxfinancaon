import { supabase } from "@/integrations/supabase/client";

// Mesmo mapeamento usado em src/routes/configuracoes.lazy.tsx (aba Plano e Nível) —
// qual coluna de apolices identifica o "dono" do contrato pra cada papel.
export const ROLE_PARA_COLUNA_APOLICE: Record<string, string> = {
  corretor: "corretor_profile_id",
  imobiliaria: "imobiliaria_profile_id",
  proprietario: "proprietario_profile_id",
};

export type NivelInfo = {
  nivelAtual: any;
  proximoNivel: any;
  contratosAtivos: number;
};

/** Calcula o nível de parceria real (contratos ativos vinculados) — nada de dado fixo/demo. */
export async function fetchNivelInfo(profileId: string, role: string): Promise<NivelInfo | null> {
  const coluna = ROLE_PARA_COLUNA_APOLICE[role];
  if (!coluna) return null;

  const [niveisRes, apolicesRes] = await Promise.all([
    supabase.from("niveis_perfil" as any).select("*").eq("tipo_perfil", role).eq("ativo", true).order("ordem", { ascending: true }),
    supabase.from("apolices").select("id, status").eq(coluna as any, profileId),
  ]);
  if (niveisRes.error) throw niveisRes.error;
  if (apolicesRes.error) throw apolicesRes.error;

  const contratosAtivos = (apolicesRes.data || []).filter((a: any) => a.status === "ativa").length;
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
