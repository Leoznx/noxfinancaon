// Cópia autocontida (Deno) dos tipos de src/types/credpago.ts — mantenha as duas em sincronia.
// Ver README.md desta pasta para o motivo do fluxo "manual assistido".

export type CredPagoAnaliseStatus = "Aprovada" | "Recusada" | "Em análise" | "Pendente";

export interface CredPagoProdutoLiberado {
  nome: string;
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

export interface CredPagoSimulacaoResponseRaw {
  status?: string;
  analise: CredPagoAnalise;
  produtos_liberados?: CredPagoProdutoLiberado[];
  pendencias?: CredPagoPendencia[];
  inquilino_principal?: CredPagoInquilinoPrincipal | null;
  protocolo?: string | null;
  [key: string]: unknown;
}

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
