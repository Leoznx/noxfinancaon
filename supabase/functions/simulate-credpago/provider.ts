import { z } from "https://esm.sh/zod@3.24.2";
import type {
  CredPagoSimulacaoResponseRaw,
  OrigemRegistroSimulacao,
  ResultadoSimulacaoCredito,
  SimulacaoCredPagoInput,
} from "./types.ts";

// Validação do que o corretor colar do portal da CredPago. Nunca confiar no shape
// vindo do frontend sem checar aqui — é a última barreira antes de persistir no banco.
const respostaCredPagoSchema = z
  .object({
    status: z.string().optional(),
    analise: z
      .object({
        status: z.string(),
        motivo: z.string().nullable().optional(),
        data_analise: z.string().nullable().optional(),
      })
      .passthrough(),
    produtos_liberados: z
      .array(
        z
          .object({
            nome: z.string().min(1),
            taxa: z.union([z.number(), z.string()]).nullable().optional(),
            valor_garantia: z.union([z.number(), z.string()]).nullable().optional(),
            valor_mensal: z.union([z.number(), z.string()]).nullable().optional(),
            descricao: z.string().nullable().optional(),
          })
          .passthrough(),
      )
      .optional(),
    pendencias: z
      .array(
        z
          .object({
            tipo: z.string().nullable().optional(),
            descricao: z.string().min(1),
            documento_necessario: z.string().nullable().optional(),
          })
          .passthrough(),
      )
      .optional(),
    inquilino_principal: z
      .object({
        nome: z.string().nullable().optional(),
        cpf: z.string().nullable().optional(),
        cnpj: z.string().nullable().optional(),
        score: z.number().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    protocolo: z.string().nullable().optional(),
  })
  .passthrough();

export interface IniciarSimulacaoResult {
  portalUrl: string;
  instrucoes: string;
}

/**
 * Contrato único para qualquer forma de obter um resultado de simulação de crédito.
 * Troque a implementação retornada por `resolveProvider()` quando a imobiliária tiver
 * acesso oficial de parceiro à API da CredPago — o resto da Edge Function (persistência
 * em consultas_credito, log de auditoria, resposta ao frontend) não precisa mudar.
 */
export interface ICreditoProvider {
  readonly nome: OrigemRegistroSimulacao;
  iniciar(input: SimulacaoCredPagoInput): Promise<IniciarSimulacaoResult>;
  registrarResultado(respostaColada: unknown): Promise<ResultadoSimulacaoCredito>;
}

const PORTAL_URL = Deno.env.get("CREDPAGO_PORTAL_URL") ?? "https://credpago.com/imobiliaria";

function normalizarStatus(statusCredPago: string | undefined): ResultadoSimulacaoCredito["status"] {
  const s = (statusCredPago || "").trim().toLowerCase();
  if (s.startsWith("aprov")) return "aprovado";
  if (s.startsWith("recus") || s.startsWith("reprov")) return "recusado";
  if (s.includes("analise") || s.includes("análise")) return "em_analise";
  return "pendente";
}

function normalizarNumero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizarResposta(
  raw: CredPagoSimulacaoResponseRaw,
  origem: OrigemRegistroSimulacao,
): ResultadoSimulacaoCredito {
  const statusOriginal = raw.analise?.status || raw.status || "Pendente";
  return {
    status: normalizarStatus(statusOriginal),
    statusOriginal,
    protocolo: raw.protocolo ?? null,
    produtosLiberados: (raw.produtos_liberados ?? []).map((p) => ({
      nome: p.nome,
      taxa: normalizarNumero(p.taxa),
      valorGarantia: normalizarNumero(p.valor_garantia),
      valorMensal: normalizarNumero(p.valor_mensal),
      descricao: p.descricao ?? null,
    })),
    pendencias: (raw.pendencias ?? []).map((p) => p.descricao).filter(Boolean),
    inquilinoPrincipal: raw.inquilino_principal ?? null,
    origem,
    registradoEm: new Date().toISOString(),
    respostaBruta: raw,
  };
}

/**
 * Implementação ativa: fluxo manual assistido.
 *
 * NÃO faz nenhuma chamada de rede para a CredPago. `iniciar()` só devolve o link do
 * portal para o corretor abrir e simular manualmente, com o login legítimo da
 * imobiliária. `registrarResultado()` valida e normaliza o que o corretor colar de volta
 * (o JSON de resposta que ele já vê, autenticado, no Network tab do próprio navegador).
 */
export class ManualAssistedProvider implements ICreditoProvider {
  readonly nome: OrigemRegistroSimulacao = "manual_assistido";

  async iniciar(input: SimulacaoCredPagoInput): Promise<IniciarSimulacaoResult> {
    return {
      portalUrl: PORTAL_URL,
      instrucoes:
        `Abra o portal da CredPago, rode a simulação para o documento ${input.tenantDocument} ` +
        `e cole aqui o retorno para registrar o resultado.`,
    };
  }

  async registrarResultado(respostaColada: unknown): Promise<ResultadoSimulacaoCredito> {
    const parsed = respostaCredPagoSchema.safeParse(respostaColada);
    if (!parsed.success) {
      throw new Error(
        "Resposta colada não tem o formato esperado da CredPago: " +
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }
    return normalizarResposta(parsed.data as CredPagoSimulacaoResponseRaw, this.nome);
  }
}

/** Provider de desenvolvimento/teste — nunca deve ser usado para registrar dados de cliente real. */
export class MockCredPagoProvider implements ICreditoProvider {
  readonly nome: OrigemRegistroSimulacao = "mock";

  async iniciar(): Promise<IniciarSimulacaoResult> {
    return { portalUrl: PORTAL_URL, instrucoes: "Modo mock — nenhuma ação manual necessária." };
  }

  async registrarResultado(): Promise<ResultadoSimulacaoCredito> {
    const fake: CredPagoSimulacaoResponseRaw = {
      status: "concluido",
      analise: { status: "Aprovada", motivo: "Simulação mock para testes" },
      produtos_liberados: [
        { nome: "Fit", taxa: 6.9, valor_garantia: 3, valor_mensal: 89.9 },
        { nome: "Smart", taxa: 8.5, valor_garantia: 6, valor_mensal: 129.9 },
      ],
      pendencias: [],
      protocolo: `MOCK-${Date.now()}`,
    };
    return normalizarResposta(fake, this.nome);
  }
}

/**
 * PRONTO PARA O FUTURO — ative quando a imobiliária tiver acesso oficial de parceiro à
 * API da CredPago (API key/OAuth fornecida pelo time comercial deles, não os endpoints
 * internos descobertos via inspeção de tráfego). Até lá, lança erro de propósito: nunca
 * deve rodar sem credenciais oficiais configuradas via `supabase secrets set`.
 */
export class OfficialApiCredPagoProvider implements ICreditoProvider {
  readonly nome: OrigemRegistroSimulacao = "api_oficial";

  async iniciar(_input: SimulacaoCredPagoInput): Promise<IniciarSimulacaoResult> {
    throw new Error(
      "Integração oficial com a API da CredPago ainda não configurada. Defina o segredo " +
        "CREDPAGO_API_KEY e implemente a chamada HTTP real aqui antes de ativar este provider.",
    );
  }

  async registrarResultado(_resposta: unknown): Promise<ResultadoSimulacaoCredito> {
    throw new Error("Integração oficial com a API da CredPago ainda não configurada.");
  }
}

export function resolveProvider(): ICreditoProvider {
  // Troque para `new OfficialApiCredPagoProvider()` quando houver acesso oficial de parceiro.
  return new ManualAssistedProvider();
}
