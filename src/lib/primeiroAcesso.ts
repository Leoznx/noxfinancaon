import { supabase } from "@/integrations/supabase/client";

/**
 * Primeiro acesso de uma conta nova.
 *
 * A URL `/cadastro-concluido` existe só para o Pixel da Meta e o Google Ads
 * registrarem a conversão de cadastro. Ela aparece uma única vez, no primeiro
 * login de um usuário novo, e some assim que a marcação é gravada em
 * `profiles.cadastro_concluido_em` — recarregar a página ou navegar depois
 * disso nunca mais leva de volta para lá.
 *
 * A coluna no banco é a fonte de verdade (vale em qualquer navegador ou
 * dispositivo). O `sessionStorage` é só uma trava local para o caso de a
 * gravação falhar: sem ela, um erro de rede faria a tela reaparecer em loop.
 */
export const ROTA_CADASTRO_CONCLUIDO = "/cadastro-concluido";

const CHAVE_TRAVA = "nox_cadastro_concluido";

function travaLocal(userId: string): string {
  return `${CHAVE_TRAVA}:${userId}`;
}

/** true quando esta sessão do navegador já passou (ou tentou passar) pela tela. */
export function jaMarcadoLocalmente(userId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(travaLocal(userId)) === "1";
  } catch {
    return false;
  }
}

function marcarLocalmente(userId: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(travaLocal(userId), "1");
  } catch {
    // Navegador com storage bloqueado: a coluna no banco continua sendo a trava real.
  }
}

/**
 * Diz se o usuário ainda precisa passar pela tela de conversão. Só responde
 * `true` quando a coluna está de fato vazia — em qualquer erro responde `false`
 * para nunca mostrar a tela por engano a quem já é cliente.
 */
export async function precisaMostrarCadastroConcluido(userId: string): Promise<boolean> {
  if (jaMarcadoLocalmente(userId)) return false;

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("cadastro_concluido_em")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return false;

    const precisa = data.cadastro_concluido_em == null;
    if (!precisa) marcarLocalmente(userId);
    return precisa;
  } catch (erro) {
    console.warn("[primeiro-acesso] não foi possível verificar o primeiro acesso", erro);
    return false;
  }
}

/**
 * Grava a marcação para que a tela nunca mais apareça. A trava local é aplicada
 * mesmo se a gravação falhar — o pixel já disparou, e repetir a tela contaria a
 * conversão duas vezes.
 */
export async function marcarCadastroConcluido(userId: string): Promise<void> {
  marcarLocalmente(userId);
  try {
    const { error } = await supabase
      .from("profiles")
      .update({ cadastro_concluido_em: new Date().toISOString() })
      .eq("id", userId)
      .is("cadastro_concluido_em", null);
    if (error) throw error;
  } catch (erro) {
    console.warn("[primeiro-acesso] não foi possível marcar o cadastro concluído", erro);
  }
}
