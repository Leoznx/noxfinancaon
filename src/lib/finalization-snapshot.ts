import { supabase } from "@/integrations/supabase/client";

export type FinalizationDocument = {
  id: string;
  file_name: string;
  file_url: string | null;
  file_type: string | null;
  document_type: string;
  document_subtype: string | null;
};

export type FinalizationHistory = {
  id: string;
  tipo_evento: string;
  descricao: string;
  created_at: string;
};

export type FinalizationSnapshot = {
  consulta: Record<string, any>;
  documentos: FinalizationDocument[];
  historico: FinalizationHistory[];
};

const inFlight = new Map<string, Promise<FinalizationSnapshot>>();

function normalizeSnapshot(value: unknown): FinalizationSnapshot {
  const source = value && typeof value === "object" ? (value as Record<string, any>) : null;
  if (!source?.consulta || typeof source.consulta !== "object") {
    throw new Error("A proposta não foi encontrada ou você não possui acesso a ela.");
  }
  return {
    consulta: source.consulta,
    documentos: Array.isArray(source.documentos) ? source.documentos : [],
    historico: Array.isArray(source.historico) ? source.historico : [],
  };
}

function isTransient(error: any) {
  const code = String(error?.code ?? "").toUpperCase();
  const message = String(error?.message ?? "").toLowerCase();
  return (
    code === "57014" ||
    code === "PGRST003" ||
    message.includes("statement timeout") ||
    message.includes("canceling statement") ||
    message.includes("fetch failed")
  );
}

async function requestSnapshot(consultaId: string) {
  let lastError: any = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await (supabase as any).rpc(
      "get_consultation_finalization_snapshot",
      { p_consultation_id: consultaId },
    );
    if (!error) return normalizeSnapshot(data);
    lastError = error;
    if (!isTransient(error) || attempt === 1) break;
  }
  console.error("Falha ao carregar snapshot da finalização:", lastError);
  throw new Error("Não foi possível carregar a proposta agora. Tente novamente em instantes.");
}

/**
 * Uma única chamada substitui consulta + relacionamentos + documentos + histórico.
 * O mapa só compartilha requisições simultâneas (incluindo StrictMode), sem manter
 * cache após a resposta; assim qualquer troca de período ou dados aparece já na
 * próxima abertura da finalização.
 */
export function loadFinalizationSnapshot(consultaId: string) {
  const current = inFlight.get(consultaId);
  if (current) return current;

  const request = requestSnapshot(consultaId).finally(() => {
    if (inFlight.get(consultaId) === request) inFlight.delete(consultaId);
  });
  inFlight.set(consultaId, request);
  return request;
}
