/**
 * Regras compartilhadas para impedir que CPF/CNPJ ou rótulos do portal sejam
 * persistidos como se fossem o nome do cliente.
 */
export function nomeClienteValido(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let normalized = value.replace(/\s+/g, " ").trim();
  const legalWrapper = normalized.match(
    /^(?:(?:o(?:\s*\(\s*a\s*\))?|a)\s*,\s*)?(.+?)\s*,\s*portador(?:a)?\s+d[oa]\b.*$/iu,
  );
  if (legalWrapper) normalized = legalWrapper[1].replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "").trim();
  if (normalized.length < 2 || normalized.length > 120 || /\d/.test(normalized)) return null;
  if (
    /\b(cpf|cnpj|cliente|inquilino|locat[aá]rio|nome|resultado|an[aá]lise|cr[eé]dito|aprovad[oa]|recusad[oa]|valor|aluguel|simula[cç][aã]o|pendente|portador(?:a)?)\b/i.test(
      normalized,
    )
  ) {
    return null;
  }
  if (!/[A-Za-zÀ-ÿ]/.test(normalized)) return null;
  return normalized;
}

export function primeiroNomeCliente(...values: unknown[]): string | null {
  for (const value of values) {
    const nome = nomeClienteValido(value);
    if (nome) return nome;
  }
  return null;
}

export function somenteDigitos(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 11 ? digits : null;
}
