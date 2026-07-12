import { asaasFetch, normalizeDocumento, normalizePhone, sanitizeAsaasResponse } from "./asaas.ts";

export async function ensureAsaasCustomer(supabase: any, consulta: any) {
  const inquilino = consulta?.inquilinos || {};
  const imovel = consulta?.imoveis || {};
  const existing = consulta?.asaas_customer_id || inquilino?.asaas_customer_id;
  if (existing) return existing;

  const cpfCnpj = normalizeDocumento(consulta?.tenant_document || inquilino.cpf || inquilino.cnpj);
  const name = consulta?.tenant_name || inquilino.nome || inquilino.razao_social;
  const email = consulta?.tenant_email || "";
  const phone = normalizePhone(consulta?.tenant_telefone || inquilino.telefone);

  if (!name || !cpfCnpj || !email || !phone) {
    throw new Error("Complete nome, e-mail, telefone e CPF/CNPJ antes de pagar.");
  }

  const found = await asaasFetch(`/customers?cpfCnpj=${encodeURIComponent(cpfCnpj)}`);
  const customer = Array.isArray(found?.data) && found.data.length ? found.data[0] : null;
  const customerId =
    customer?.id || (await createCustomer({ consulta, imovel, name, email, phone, cpfCnpj })).id;

  await Promise.all([
    supabase
      .from("consultas_credito")
      .update({ asaas_customer_id: customerId })
      .eq("id", consulta.id),
    consulta?.inquilino_id
      ? supabase
          .from("inquilinos")
          .update({ asaas_customer_id: customerId })
          .eq("id", consulta.inquilino_id)
      : Promise.resolve({ error: null }),
  ]);

  return customerId;
}

async function createCustomer(input: {
  consulta: any;
  imovel: any;
  name: string;
  email: string;
  phone: string;
  cpfCnpj: string;
}) {
  const payload: Record<string, unknown> = {
    name: input.name,
    cpfCnpj: input.cpfCnpj,
    email: input.email,
    mobilePhone: input.phone,
    phone: input.phone,
  };

  const address = input.consulta?.imovel_endereco || input.imovel?.endereco;
  const number = input.consulta?.imovel_numero || input.imovel?.numero;
  const complement = input.consulta?.imovel_complemento || input.imovel?.complemento;
  const province = input.consulta?.imovel_bairro || input.imovel?.bairro;
  const postalCode = input.consulta?.imovel_cep || input.imovel?.cep;

  if (address) payload.address = address;
  if (number) payload.addressNumber = String(number);
  if (complement) payload.complement = complement;
  if (province) payload.province = province;
  if (postalCode) payload.postalCode = String(postalCode).replace(/\D/g, "");

  const raw = await asaasFetch("/customers", { method: "POST", body: JSON.stringify(payload) });
  return sanitizeAsaasResponse(raw) as any;
}
