import { supabase } from "@/integrations/supabase/client";

export type OwnerPropertyDraft = {
  cep: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  rentCents: number;
  hasCondominium: boolean;
  condominiumCents: number;
  reserveFundCents: number;
  garbageFeeCents: number;
  hasIptu: boolean;
  iptuCents: number;
};

export const EMPTY_OWNER_PROPERTY: OwnerPropertyDraft = {
  cep: "",
  street: "",
  number: "",
  complement: "",
  neighborhood: "",
  city: "",
  state: "",
  rentCents: 0,
  hasCondominium: false,
  condominiumCents: 0,
  reserveFundCents: 0,
  garbageFeeCents: 0,
  hasIptu: false,
  iptuCents: 0,
};

export function normalizeCep(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

export function validateOwnerProperty(draft: OwnerPropertyDraft): string | null {
  if (draft.cep.replace(/\D/g, "").length !== 8) return "Informe um CEP válido.";
  if (!draft.street.trim()) return "Informe o logradouro do imóvel.";
  if (!draft.number.trim()) return "Informe o número do imóvel.";
  if (!draft.neighborhood.trim()) return "Informe o bairro do imóvel.";
  if (!draft.city.trim()) return "Informe a cidade do imóvel.";
  if (draft.state.trim().length !== 2) return "Informe a UF com 2 letras.";
  if (!Number.isInteger(draft.rentCents) || draft.rentCents <= 0)
    return "Informe um valor de aluguel maior que zero.";
  if (draft.hasCondominium && draft.condominiumCents <= 0) return "Informe o valor do condomínio.";
  if (draft.hasIptu && draft.iptuCents <= 0) return "Informe o valor do IPTU.";
  const fees = [
    draft.condominiumCents,
    draft.reserveFundCents,
    draft.garbageFeeCents,
    draft.iptuCents,
  ];
  if (fees.some((value) => !Number.isInteger(value) || value < 0))
    return "Os encargos não podem ter valores negativos.";
  return null;
}

export function ownerPropertyTotalCents(draft: OwnerPropertyDraft) {
  return (
    draft.rentCents +
    (draft.hasCondominium
      ? draft.condominiumCents + draft.reserveFundCents + draft.garbageFeeCents
      : 0) +
    (draft.hasIptu ? draft.iptuCents : 0)
  );
}

export async function createOwnerProperty(draft: OwnerPropertyDraft): Promise<string> {
  const validationError = validateOwnerProperty(draft);
  if (validationError) throw new Error(validationError);

  const { data, error } = await (supabase as any).rpc("create_my_property", {
    p_cep: draft.cep.replace(/\D/g, ""),
    p_logradouro: draft.street.trim(),
    p_numero: draft.number.trim(),
    p_complemento: draft.complement.trim() || null,
    p_bairro: draft.neighborhood.trim(),
    p_cidade: draft.city.trim(),
    p_estado: draft.state.trim().toUpperCase(),
    p_valor_aluguel: draft.rentCents / 100,
    p_tem_condominio: draft.hasCondominium,
    p_valor_condominio: draft.hasCondominium ? draft.condominiumCents / 100 : 0,
    p_valor_fundo_reserva: draft.hasCondominium ? draft.reserveFundCents / 100 : 0,
    p_valor_taxa_lixo: draft.hasCondominium ? draft.garbageFeeCents / 100 : 0,
    p_tem_iptu: draft.hasIptu,
    p_valor_iptu: draft.hasIptu ? draft.iptuCents / 100 : 0,
  });
  if (error) {
    const message = String(error.message || "");
    if (message.includes("OWNER_PROPERTY_OWNER_NOT_FOUND")) {
      throw new Error(
        "Seu cadastro de proprietário ainda não está completo. Atualize seu perfil e tente novamente.",
      );
    }
    if (message.includes("OWNER_PROPERTY_FORBIDDEN")) {
      throw new Error("Este cadastro está disponível apenas para proprietários.");
    }
    throw new Error("Não foi possível cadastrar o imóvel agora. Tente novamente.");
  }
  return String(data);
}
