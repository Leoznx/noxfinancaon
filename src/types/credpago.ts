import { z } from "zod";

/**
 * Tipos e validação para a integração de Consulta de Crédito com a CredPago.
 *
 * Decisão de arquitetura: o NoxFianca NÃO chama a API interna da CredPago
 * automaticamente. Os endpoints descobertos (POST /imobiliaria/api/solicitacao/simulacao,
 * POST /imobiliaria/api/pessoa) não são uma API pública de parceiros — usá-los de forma
 * automatizada (login headless + sessão persistente) violaria os Termos de Uso da CredPago.
 *
 * Fluxo atual: "manual assistido". O corretor roda a simulação no próprio portal da
 * CredPago (com o login legítimo da imobiliária) e cola o retorno aqui. Estes tipos
 * descrevem o formato de resposta observado, usado para validar e normalizar o que for
 * colado. Quando a imobiliária obtiver acesso oficial de parceiro (API key/OAuth), troque
 * o provider em supabase/functions/simulate-credpago/provider.ts — nada aqui muda.
 *
 * Mantenha esta cópia em sincronia com supabase/functions/simulate-credpago/types.ts
 * (a Edge Function roda em Deno e mantém seu próprio arquivo autocontido).
 */

export type CredPagoAnaliseStatus = "Aprovada" | "Recusada" | "Em análise" | "Pendente";

export interface CredPagoProdutoLiberado {
  nome: string; // ex: "Fit", "Fit+", "Smart", "Smart Plus", "Up"
  taxa?: number | string | null;
  valor_garantia?: number | string | null;
  valor_mensal?: number | string | null;
  descricao?: string | null;
}

export interface CredPagoPendencia {
  tipo?: string | null;
  descricao: string;
  documento_necessario?: string | null;
}

export interface CredPagoInquilinoPrincipal {
  nome?: string | null;
  cpf?: string | null;
  cnpj?: string | null;
  score?: number | null;
}

export interface CredPagoAnalise {
  status: CredPagoAnaliseStatus | string;
  motivo?: string | null;
  data_analise?: string | null;
}

/** Formato bruto observado na resposta de POST /imobiliaria/api/solicitacao/simulacao */
export interface CredPagoSimulacaoResponseRaw {
  status?: string;
  analise: CredPagoAnalise;
  produtos_liberados?: CredPagoProdutoLiberado[];
  pendencias?: CredPagoPendencia[];
  inquilino_principal?: CredPagoInquilinoPrincipal | null;
  protocolo?: string | null;
  [key: string]: unknown;
}

export const credPagoProdutoLiberadoSchema = z
  .object({
    nome: z.string().min(1, "Produto sem nome"),
    taxa: z.union([z.number(), z.string()]).nullable().optional(),
    valor_garantia: z.union([z.number(), z.string()]).nullable().optional(),
    valor_mensal: z.union([z.number(), z.string()]).nullable().optional(),
    descricao: z.string().nullable().optional(),
  })
  .passthrough();

export const credPagoPendenciaSchema = z
  .object({
    tipo: z.string().nullable().optional(),
    descricao: z.string().min(1),
    documento_necessario: z.string().nullable().optional(),
  })
  .passthrough();

export const credPagoSimulacaoResponseSchema = z
  .object({
    status: z.string().optional(),
    analise: z
      .object({
        status: z.string(),
        motivo: z.string().nullable().optional(),
        data_analise: z.string().nullable().optional(),
      })
      .passthrough(),
    produtos_liberados: z.array(credPagoProdutoLiberadoSchema).optional(),
    pendencias: z.array(credPagoPendenciaSchema).optional(),
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

export type ResultadoSimulacaoStatus = "aprovado" | "recusado" | "em_analise" | "pendente";

export type OrigemRegistroSimulacao = "manual_assistido" | "mock" | "api_oficial";

export interface ProdutoLiberadoNormalizado {
  nome: string;
  taxa: number | null;
  valorGarantia: number | null;
  valorMensal: number | null;
  descricao: string | null;
}

export interface ResultadoSimulacaoCredito {
  status: ResultadoSimulacaoStatus;
  statusOriginal: string;
  protocolo: string | null;
  produtosLiberados: ProdutoLiberadoNormalizado[];
  pendencias: string[];
  inquilinoPrincipal: CredPagoInquilinoPrincipal | null;
  origem: OrigemRegistroSimulacao;
  registradoEm: string;
  respostaBruta?: CredPagoSimulacaoResponseRaw | null;
}

/** Payload enviado pelo frontend para a Edge Function `simulate-credpago` */
export interface SimulacaoCredPagoInput {
  tenantType: "PF" | "PJ";
  tenantDocument: string;
  tenantName: string;
  dataNascimento?: string | null;
  email?: string | null;
  telefone?: string | null;
  endereco: {
    cep: string;
    logradouro?: string | null;
    numero?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    cidade: string;
    estado: string;
  };
  imovel: {
    tipo: "Residencial" | "Comercial";
    valorAluguel: number;
    valorCondominio: number;
    valorTaxas: number;
  };
}

export type SimulateCredPagoAction = "iniciar" | "registrar-resultado" | "mock";

export interface SimulateCredPagoRequest {
  action: SimulateCredPagoAction;
  consultaId: string;
  input?: SimulacaoCredPagoInput;
  respostaColada?: CredPagoSimulacaoResponseRaw | null;
}

export interface SimulateCredPagoResponse {
  ok: boolean;
  modo: "manual_assistido" | "mock";
  portalUrl?: string;
  instrucoes?: string;
  resultado?: ResultadoSimulacaoCredito;
  error?: string;
}
