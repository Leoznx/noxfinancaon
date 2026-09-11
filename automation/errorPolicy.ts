import { formatErrorDetail } from "./logger";
import type { ConsultaCreditoRow } from "./types";

/** Falhas de infraestrutura do portal que podem ser tentadas novamente sem intervenção. */
export function isTransientPortalError(error: unknown): boolean {
  const detail = formatErrorDetail(error);
  return /(?:timeout|timed out|page\.goto|net::|econnreset|econnrefused|enotfound|socket hang up|network|navigation|target (?:page|context|browser).*closed|browser.*closed|context.*closed|page crashed|connection closed|protocol error|portal.*n[aã]o informou o estado da autentica[cç][aã]o)/i.test(
    detail,
  );
}

/**
 * Proteção de última linha para registros antigos/importados que contornaram as
 * validações do site e do aplicativo. Nunca envia dados incompletos ao parceiro.
 */
export function validateConsultaForAutomation(consulta: ConsultaCreditoRow): string | null {
  const tipoPessoa = consulta.tipo_pessoa || "PF";
  const documento = String(consulta.documento || "").replace(/\D/g, "");
  const cep = String(consulta.cep || "").replace(/\D/g, "");
  const expectedDocumentLength = tipoPessoa === "PJ" ? 14 : 11;
  const valorTotal =
    (Number(consulta.valor_aluguel) || 0) +
    (Number(consulta.valor_condominio) || 0) +
    (Number(consulta.valor_taxas) || 0);

  if (tipoPessoa !== "PF" && tipoPessoa !== "PJ") return "tipo de pessoa inválido";
  if (documento.length !== expectedDocumentLength) {
    return tipoPessoa === "PJ" ? "CNPJ incompleto ou inválido" : "CPF incompleto ou inválido";
  }
  if (cep.length !== 8) return "CEP incompleto ou inválido";
  if (
    consulta.tipo_imovel &&
    consulta.tipo_imovel !== "Residencial" &&
    consulta.tipo_imovel !== "Comercial"
  ) {
    return "tipo de imóvel inválido";
  }
  if (!Number.isFinite(valorTotal) || valorTotal <= 0) return "valor mensal precisa ser positivo";
  return null;
}
