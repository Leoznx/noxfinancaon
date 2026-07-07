/**
 * Normaliza CPF/CNPJ removendo qualquer caractere que não seja dígito.
 * Ex: "018.830.200-16" -> "01883020016"
 */
export function normalizeDocumento(doc?: string | null): string {
  if (!doc) return "";
  return String(doc).replace(/\D/g, "");
}

export function formatarEndereco(im: any | null | undefined): string {
  if (!im) return "Endereço não informado";
  const partes = [im.logradouro, im.numero, im.bairro, im.cidade, im.estado]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean);
  if (partes.length === 0) {
    if (im.cep) return `CEP ${im.cep}`;
    return "Endereço não informado";
  }
  return partes.join(", ");
}
