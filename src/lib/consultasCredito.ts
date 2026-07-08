import { supabase } from "@/lib/supabase";
import { normalizeDocumento } from "@/utils/documento";
import { upsertConsultaCredito } from "@/lib/consultas";
import type { DadosSimulacao } from "@/components/simulacao/FormularioSimulacao";
import type { RealtimeChannel } from "@supabase/supabase-js";

/** Status do fluxo de automação local CredPago. */
export type StatusConsulta =
  | "pendente"
  | "processando"
  | "aprovado"
  | "recusado"
  | "em_analise"
  | "erro";

export const STATUS_FINAIS: StatusConsulta[] = ["aprovado", "recusado", "em_analise", "erro"];

export interface ConsultaCredito {
  id: string;
  created_at: string;
  updated_at: string;
  tipo_pessoa: "PF" | "PJ" | null;
  documento: string | null;
  documento_masked: string | null;
  tenant_name: string | null;
  tipo_imovel: string | null;
  cep: string | null;
  valor_aluguel: number | null;
  valor_condominio: number | null;
  valor_taxas: number | null;
  status: string;
  resultado: string | null;
  mensagem: string | null;
  origem: string | null;
  automation_started_at: string | null;
  automation_finished_at: string | null;
  automation_step: string | null;
  error_message: string | null;
  raw_response: unknown;
  substatus: string | null;
}

/** Etapas que o worker local grava em `automation_step` enquanto processa a consulta. */
export type AutomationStep = "abrindo" | "preenchendo" | "enviando" | "aguardando_resultado";

const PROGRESSO_POR_ETAPA: Record<AutomationStep, number> = {
  abrindo: 15,
  preenchendo: 40,
  enviando: 65,
  aguardando_resultado: 85,
};

/**
 * Percentual de progresso (0-100) para a barrinha do modal "Consultando crédito",
 * a partir do status/etapa gravados pelo worker. Nunca inventa progresso: sem etapa
 * conhecida, mostra só o mínimo (consulta enfileirada) até a próxima atualização real.
 */
export function progressoConsulta(status?: string | null, step?: string | null): number {
  if (status && STATUS_FINAIS.includes(status as StatusConsulta)) return 100;
  if (step && step in PROGRESSO_POR_ETAPA) return PROGRESSO_POR_ETAPA[step as AutomationStep];
  if (status === "processando") return PROGRESSO_POR_ETAPA.abrindo;
  return 5;
}

/**
 * Mascara CPF/CNPJ para exibição e logs. Nunca exibir o documento completo
 * fora do fluxo de preenchimento.
 * CPF  01883020016    -> 018.xxx.xxx-16
 * CNPJ 12345678000190 -> 12.xxx.xxx-xxxx-90
 */
export function maskDocumento(doc?: string | null): string {
  const d = normalizeDocumento(doc);
  if (d.length === 11) return `${d.slice(0, 3)}.***.***-${d.slice(-2)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.***.***/****-${d.slice(-2)}`;
  if (d.length > 4) return `${d.slice(0, 2)}${"*".repeat(d.length - 4)}${d.slice(-2)}`;
  return d ? "***" : "";
}

/**
 * Formata CPF/CNPJ com pontuação, sem mascarar nenhum dígito — para as telas internas
 * do corretor (Minhas Consultas, Detalhes), onde ele precisa ver o documento completo
 * pra não perder a rastreabilidade de qual cliente foi consultado (igual a CredPago
 * exibe). `maskDocumento` continua sendo usado nos logs do worker.
 * CPF  01883020016    -> 018.830.200-16
 * CNPJ 12345678000190 -> 12.345.678/0001-90
 */
export function formatDocumento(doc?: string | null): string {
  const d = normalizeDocumento(doc);
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return d;
}

/**
 * Confirma que uma string parece um nome de pessoa de verdade — não o CPF/CNPJ
 * "vazado" para o campo de nome. Isso pode acontecer quando a página de
 * resultado da automação não tem um nome antes do "CPF:" (ex.: telas de
 * recusado), e o texto capturado acaba virando algo como "CPF: 098.664.609-16".
 * Nomes reais não têm dígitos nem a palavra CPF/CNPJ.
 */
export function isNomeValido(nome?: string | null): boolean {
  const trimmed = (nome ?? "").trim();
  if (!trimmed) return false;
  if (/\d/.test(trimmed)) return false;
  if (/\b(cpf|cnpj)\b/i.test(trimmed)) return false;
  return true;
}

interface CriarConsultaParams {
  dados: DadosSimulacao;
  userEmail: string;
  userRole?: string | null;
}

/**
 * Cria (ou reaproveita) a consulta via fluxo existente e grava os campos que o
 * worker local de automação CredPago precisa. Deixa a consulta na fila com
 * status "pendente" e origem "nox_financa".
 */
export async function criarConsultaParaAutomacao({
  dados,
  userEmail,
  userRole,
}: CriarConsultaParams): Promise<string> {
  // Reusa o upsert existente: mantém vínculo com inquilinos/imóveis e deduplicação.
  const consultaId = await upsertConsultaCredito({ dados, userEmail, userRole });

  const rawDoc = dados.tipoInquilino === "PF" ? dados.inquilinos[0]?.cpf || "" : dados.cnpj || "";
  const documento = normalizeDocumento(rawDoc);

  const payload: Record<string, unknown> = {
    tipo_pessoa: dados.tipoInquilino,
    documento,
    documento_masked: maskDocumento(documento),
    tipo_imovel: dados.tipoImovel,
    cep: dados.cep,
    valor_aluguel: dados.valores.aluguel,
    valor_condominio: dados.valores.condominio,
    valor_taxas: dados.valores.taxas,
    status: "pendente",
    origem: "nox_financa",
    resultado: null,
    mensagem: null,
    error_message: null,
    automation_started_at: null,
    automation_finished_at: null,
    automation_step: null,
    raw_response: null,
  };

  const { error } = await supabase
    .from("consultas_credito")
    .update(payload as any)
    .eq("id", consultaId);
  if (error) throw error;

  return consultaId;
}

export async function getConsultaCredito(id: string): Promise<ConsultaCredito | null> {
  const { data, error } = await supabase
    .from("consultas_credito")
    .select(
      "id, created_at, updated_at, tipo_pessoa, documento, documento_masked, tenant_name, tipo_imovel, cep, valor_aluguel, valor_condominio, valor_taxas, status, resultado, mensagem, origem, automation_started_at, automation_finished_at, automation_step, error_message, raw_response, substatus",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as ConsultaCredito) ?? null;
}

/** Recoloca uma consulta com erro de volta na fila do worker. */
export async function reenviarConsulta(id: string): Promise<void> {
  const { error } = await supabase
    .from("consultas_credito")
    .update({
      status: "pendente",
      resultado: null,
      mensagem: null,
      error_message: null,
      automation_started_at: null,
      automation_finished_at: null,
      automation_step: null,
    } as any)
    .eq("id", id);
  if (error) throw error;
}

/**
 * Escuta mudanças de uma consulta via Supabase Realtime, com polling de
 * fallback (caso Realtime não esteja habilitado no projeto).
 * Retorna função de cleanup — sempre chamar ao desmontar o componente.
 */
export function watchConsultaCredito(
  id: string,
  onChange: (consulta: ConsultaCredito) => void,
  pollIntervalMs = 4000,
): () => void {
  let stopped = false;
  let channel: RealtimeChannel | null = null;

  const emit = (c: ConsultaCredito | null) => {
    if (!stopped && c) onChange(c);
  };

  channel = supabase
    .channel(`consulta-credito-${id}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "consultas_credito", filter: `id=eq.${id}` },
      (payload) => emit(payload.new as unknown as ConsultaCredito),
    )
    .subscribe();

  const timer = setInterval(async () => {
    try {
      emit(await getConsultaCredito(id));
    } catch {
      // polling silencioso — próximo tick tenta de novo
    }
  }, pollIntervalMs);

  // Estado inicial imediato (evita esperar o primeiro tick).
  getConsultaCredito(id).then(emit).catch(() => {});

  return () => {
    stopped = true;
    clearInterval(timer);
    if (channel) supabase.removeChannel(channel);
  };
}
