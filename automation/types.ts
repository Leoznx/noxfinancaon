export interface ConsultaCreditoRow {
  id: string;
  tipo_pessoa: "PF" | "PJ" | null;
  documento: string | null;
  documento_masked: string | null;
  tipo_imovel: "Residencial" | "Comercial" | null;
  cep: string | null;
  valor_aluguel: number | null;
  valor_condominio: number | null;
  valor_taxas: number | null;
  status: string;
}

export type ResultadoStatus = "aprovado" | "recusado" | "em_analise" | "erro";

export interface ResultadoParse {
  status: ResultadoStatus;
  mensagem: string;
  /** Nome do cliente lido na página de resultado da CredPago (ex.: "Cliente: FULANO DA SILVA"), se encontrado. */
  clienteNome: string | null;
  /** CPF/CNPJ lido na página de resultado da CredPago (só dígitos), se encontrado. */
  clienteDocumento: string | null;
  rawSummary: Record<string, unknown>;
}
