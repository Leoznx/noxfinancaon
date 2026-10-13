import type { Page, Request, Response } from "playwright";
import type { ResultadoStatus } from "./types";
import { extractLoftProposalId } from "./loftCancellation";

const SIMULATION_API_PATH = /\/api\/internal-rental-guarantee\/simulation\/?$/i;
const MAX_VISITED_OBJECTS = 100;

export interface ObservedCreditSimulationResult {
  status: Exclude<ResultadoStatus, "erro">;
  proposalId: string | null;
  /** Nome ou razão social exibido na proposta, quando o portal o disponibiliza. */
  clienteNome?: string | null;
}

export interface CreditSimulationApiObserver {
  read: () => ObservedCreditSimulationResult | null;
  hasStarted: () => boolean;
  dispose: () => void;
}

function normalizeProviderStatus(value: unknown): Exclude<ResultadoStatus, "erro"> | null {
  const status = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();

  if (["APROVADA", "APROVADO", "APPROVED"].includes(status)) return "aprovado";
  if (["REPROVADA", "REPROVADO", "REJECTED"].includes(status)) return "recusado";
  if (["DERIVADA", "DERIVADO", "DERIVED", "PENDING", "EM_ANALISE"].includes(status)) {
    return "em_analise";
  }
  return null;
}

function findResultPayload(value: unknown): Record<string, unknown> | null {
  const queue: unknown[] = [value];
  const visited = new Set<object>();

  while (queue.length > 0 && visited.size < MAX_VISITED_OBJECTS) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;
    if (visited.has(current)) continue;
    visited.add(current);

    const record = current as Record<string, unknown>;
    if (
      normalizeProviderStatus(
        record.fiancaRiskAnalysisStatus ??
          record.riskAnalysisStatus ??
          record.analysisStatus ??
          record.status,
      )
    ) {
      return record;
    }

    for (const child of Object.values(record)) {
      if (child && typeof child === "object") queue.push(child);
    }
  }
  return null;
}

export function parseCreditSimulationResponsePayload(
  value: unknown,
): ObservedCreditSimulationResult | null {
  const payload = findResultPayload(value);
  if (!payload) return null;

  const status = normalizeProviderStatus(
    payload.fiancaRiskAnalysisStatus ??
      payload.riskAnalysisStatus ??
      payload.analysisStatus ??
      payload.status,
  );
  if (!status) return null;

  const explicitProposalIds = [
    payload.proposalId,
    payload.proposal_id,
    payload.idProposta,
    payload.id_proposta,
  ];
  // `id` é genérico demais para ser promovido junto de um simples `status`.
  // No BFF atual ele só é o ID da proposta quando o MESMO objeto traz o campo
  // específico `fiancaRiskAnalysisStatus` que identifica o contrato da Loft.
  if (normalizeProviderStatus(payload.fiancaRiskAnalysisStatus)) {
    explicitProposalIds.push(payload.id);
  }

  const proposalId = explicitProposalIds.map(extractLoftProposalId).find(Boolean);

  return { status, proposalId: proposalId ?? null };
}

function isSimulationRequest(request: Request): boolean {
  try {
    const url = new URL(request.url());
    return SIMULATION_API_PATH.test(url.pathname) && request.method().toUpperCase() === "POST";
  } catch {
    return false;
  }
}

function isSimulationResponse(response: Response): boolean {
  return isSimulationRequest(response.request());
}

/**
 * Observa somente a resposta da API que a própria tela usa para simular crédito.
 * O corpo completo nunca é persistido: guardamos apenas o estado explícito e um
 * eventual número técnico de proposta, evitando depender exclusivamente do texto
 * ou do layout que o portal renderiza.
 */
export function observeCreditSimulationApi(page: Page): CreditSimulationApiObserver {
  let latest: ObservedCreditSimulationResult | null = null;
  const observedRequests = new Set<Request>();

  const onRequest = (request: Request) => {
    if (isSimulationRequest(request)) observedRequests.add(request);
  };

  const onResponse = (response: Response) => {
    // Uma resposta tardia de uma tentativa anterior não pode entregar seu ID
    // ao job criado por um clique posterior. Só aceitamos respostas cujo objeto
    // Request foi visto por esta instância do observer.
    if (
      !isSimulationResponse(response) ||
      !observedRequests.has(response.request()) ||
      !response.ok()
    ) {
      return;
    }
    void response
      .json()
      .then((payload) => {
        latest = parseCreditSimulationResponsePayload(payload) ?? latest;
      })
      .catch(() => {});
  };

  page.on("request", onRequest);
  page.on("response", onResponse);
  return {
    read: () => latest,
    hasStarted: () => observedRequests.size > 0,
    dispose: () => {
      page.off("request", onRequest);
      page.off("response", onResponse);
    },
  };
}
