export interface ConsultaCreditoRow {
  id: string;
  correlation_id: string;
  profile_id_solicitante: string | null;
  created_at: string;
  tipo_pessoa: "PF" | "PJ" | null;
  documento: string | null;
  documento_masked: string | null;
  tipo_imovel: "Residencial" | "Comercial" | null;
  valor_aluguel: number | null;
  valor_condominio: number | null;
  valor_taxas: number | null;
  status: string;
  tenant_name: string | null;
  tenant_document: string | null;
  inquilino: {
    nome: string | null;
    razao_social: string | null;
    cpf: string | null;
    cnpj: string | null;
  } | null;
}

export type ResultadoStatus = "aprovado" | "recusado" | "em_analise" | "erro";

export interface ResultadoParse {
  status: ResultadoStatus;
  mensagem: string;
  /** Identificador técnico da proposta retornado pela Loft, sem CPF/CNPJ. */
  proposalId: string | null;
  /** Nome do cliente lido na página de resultado da CredPago (ex.: "Cliente: FULANO DA SILVA"), se encontrado. */
  clienteNome: string | null;
  /** CPF/CNPJ lido na página de resultado da CredPago (só dígitos), se encontrado. */
  clienteDocumento: string | null;
  rawSummary: Record<string, unknown>;
}
