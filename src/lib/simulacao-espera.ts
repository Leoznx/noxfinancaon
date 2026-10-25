import {
  resolveCreditStatusPresentation,
  type CreditStatusPresentationRow,
} from "./credit-status-presentation";

/**
 * Regras da espera do "Simular crédito". O corretor permanece no modal
 * "Consultando crédito" até existir um resultado real; abrir a tela de status
 * logo após enfileirar mostrava o pedido como se já estivesse em análise.
 */

// Maior que o timeout máximo do worker (7 min). Ao atingir o limite, a consulta
// continua salva e abrimos seu acompanhamento; nunca a reenfileiramos às cegas.
export const TEMPO_LIMITE_ACOMPANHAMENTO_MS = 540_000;

// Depois deste tempo sem decisão o modal oferece seguir em segundo plano, para
// que uma automação indisponível não prenda o corretor diante de um spinner.
export const TEMPO_PARA_SEGUNDO_PLANO_MS = 45_000;

// Estados em que a automação ainda trabalha (ou espera o serviço externo) e
// nenhuma decisão do provedor existe para ser mostrada.
const ESTADOS_EM_ANDAMENTO = new Set([
  "pendente",
  "processando",
  "aguardando_autenticacao",
  "aguardando_servico_externo",
  "aguardando_resultado",
  "requer_verificacao",
]);

// Etapas gravadas pelo worker quando a fila está parada à espera do serviço
// externo (sessão, login ou conta). Não terminam em segundos.
const ETAPAS_DE_ESPERA_LONGA = new Set([
  "aguardando_autenticacao",
  "aguardando_liberacao_parceiro",
]);

export type ProximoPassoSimulacao =
  | { tipo: "aguardar" }
  | { tipo: "erro"; mensagem: string }
  | { tipo: "abrir_status" };

export type ConsultaEmEspera = CreditStatusPresentationRow & {
  error_message?: string | null;
  mensagem?: string | null;
};

export const MENSAGEM_ERRO_PADRAO = "Não foi possível concluir a consulta no momento.";

/**
 * Decide o que a tela de nova consulta faz com a última leitura da fila:
 * - aguardar: segue no modal (Realtime/polling continuam ativos);
 * - erro: mostra a falha definitiva no modal, com "Tentar novamente";
 * - abrir_status: há decisão real (aprovado, recusado, em análise) ou uma
 *   solicitação cancelada sem envio. Quarentenas técnicas continuam aguardando.
 */
export function proximoPassoSimulacao(consulta: ConsultaEmEspera): ProximoPassoSimulacao {
  if (
    consulta.technical_status?.toLowerCase() === "requires_verification" ||
    consulta.status?.toLowerCase() === "requer_verificacao"
  ) {
    return { tipo: "aguardar" };
  }
  const estado = resolveCreditStatusPresentation(consulta);
  if (ESTADOS_EM_ANDAMENTO.has(estado)) return { tipo: "aguardar" };
  if (estado === "erro") {
    return {
      tipo: "erro",
      // `error_message` é o código técnico usado por suporte e auditoria. O
      // modal deve priorizar a explicação segura gravada em `mensagem`.
      mensagem: consulta.mensagem || consulta.error_message || MENSAGEM_ERRO_PADRAO,
    };
  }
  return { tipo: "abrir_status" };
}

export function etapaDeEsperaLonga(etapa?: string | null): boolean {
  return !!etapa && ETAPAS_DE_ESPERA_LONGA.has(etapa);
}
