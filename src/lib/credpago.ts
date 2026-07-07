import { supabase } from "@/integrations/supabase/client";
import { credPagoSimulacaoResponseSchema } from "@/types/credpago";
import type {
  CredPagoSimulacaoResponseRaw,
  SimulacaoCredPagoInput,
  SimulateCredPagoAction,
  SimulateCredPagoResponse,
} from "@/types/credpago";

const DEFAULT_PORTAL_URL = "https://credpago.com/imobiliaria";

/** URL do portal de imobiliárias da CredPago, para abrir em nova aba no fluxo manual assistido. */
export function getCredPagoPortalUrl(): string {
  return (import.meta.env.VITE_CREDPAGO_PORTAL_URL as string | undefined) || DEFAULT_PORTAL_URL;
}

async function invoke(body: {
  action: SimulateCredPagoAction;
  consultaId: string;
  input?: SimulacaoCredPagoInput;
  respostaColada?: CredPagoSimulacaoResponseRaw | null;
}): Promise<SimulateCredPagoResponse> {
  const { data, error } = await supabase.functions.invoke("simulate-credpago", { body });
  if (error) {
    throw new Error(error.message || "Falha ao comunicar com o serviço de simulação de crédito.");
  }
  if (!data?.ok) {
    throw new Error(data?.error || "Não foi possível processar a simulação de crédito.");
  }
  return data as SimulateCredPagoResponse;
}

export function iniciarSimulacaoCredPago(consultaId: string, input: SimulacaoCredPagoInput) {
  return invoke({ action: "iniciar", consultaId, input });
}

export function registrarResultadoCredPago(consultaId: string, respostaColada: CredPagoSimulacaoResponseRaw) {
  return invoke({ action: "registrar-resultado", consultaId, respostaColada });
}

/** Só deve aparecer em ambiente de desenvolvimento — nunca para dados de cliente real. */
export function simularCredPagoMock(consultaId: string, input: SimulacaoCredPagoInput) {
  return invoke({ action: "mock", consultaId, input });
}

/**
 * Faz parse do JSON que o corretor colou (copiado da aba Network do próprio navegador,
 * já autenticado no portal da CredPago) e valida contra o formato esperado.
 * Retorna null se não for um JSON válido — o chamador deve então oferecer o formulário manual.
 */
export function parseRespostaCredPago(texto: string): CredPagoSimulacaoResponseRaw | null {
  if (!texto?.trim()) return null;
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(texto);
  } catch {
    return null;
  }
  const result = credPagoSimulacaoResponseSchema.safeParse(parsedJson);
  if (!result.success) return null;
  return result.data as CredPagoSimulacaoResponseRaw;
}
