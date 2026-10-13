import {
  PaymentRecipient,
  asaasFetch,
  normalizeDocumento,
  normalizePhone,
  sanitizeAsaasResponse,
} from "./asaas.ts";
import { recoverStoredAsaasCustomer } from "./asaas-customer-recovery.ts";

export async function ensureAsaasCustomer(
  supabase: any,
  consulta: any,
  recipient?: PaymentRecipient,
) {
  const inquilino = consulta?.inquilinos || {};
  const imovel = consulta?.imoveis || {};
  const isAgency = recipient?.paymentResponsible === "agency";
  let payerProfile: any = null;
  if (isAgency && recipient?.recipientUserId) {
    const result = await supabase
      .from("profiles")
      .select("id, asaas_customer_id, nome, email, telefone, cnpj")
      .eq("id", recipient.recipientUserId)
      .maybeSingle();
    payerProfile = result.data;
  }
  const existing = isAgency
    ? payerProfile?.asaas_customer_id
    : consulta?.asaas_customer_id || inquilino?.asaas_customer_id;
  if (existing) {
    const recovered = await recoverStoredAsaasCustomer(String(existing), asaasFetch);
    if (recovered) return recovered;
    console.warn("[asaas-customer] vinculo antigo indisponivel; buscando cadastro pelo documento", {
      consultationId: consulta?.id || null,
    });
  }

  const cpfCnpj = normalizeDocumento(
    recipient?.recipientDocument || consulta?.tenant_document || inquilino.cpf || inquilino.cnpj,
  );
  const name = recipient?.recipientName || consulta?.tenant_name || inquilino.nome ||
    inquilino.razao_social;
  const email = recipient?.recipientEmail || consulta?.tenant_email || "";
  const phone = normalizePhone(
    recipient?.recipientPhone || consulta?.tenant_telefone || inquilino.telefone,
  );

  if (!name || !cpfCnpj || !email || !phone) {
    throw new Error("Complete nome, e-mail, telefone e CPF/CNPJ antes de pagar.");
  }

  const found = await asaasFetch(`/customers?cpfCnpj=${encodeURIComponent(cpfCnpj)}`);
  const customers = Array.isArray(found?.data) ? found.data : [];
  const activeCustomer = customers.find((item: any) => item?.id && item.deleted !== true);
  const removedCustomer = customers.find((item: any) => item?.id && item.deleted === true);
  const recoveredListedCustomer = removedCustomer?.id
    ? await recoverStoredAsaasCustomer(String(removedCustomer.id), asaasFetch)
    : null;
  const customerId =
    activeCustomer?.id ||
    recoveredListedCustomer ||
    (await createCustomer({ consulta, imovel, recipient, name, email, phone, cpfCnpj })).id;

  if (isAgency && recipient?.recipientUserId) {
    await supabase
      .from("profiles")
      .update({ asaas_customer_id: customerId })
      .eq("id", recipient.recipientUserId);
  } else {
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
  }

  return customerId;
}

async function createCustomer(input: {
  consulta: any;
  imovel: any;
  recipient?: PaymentRecipient;
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

  const address = input.recipient?.recipientAddress?.address ||
    input.consulta?.imovel_endereco || input.imovel?.endereco;
  const number = input.recipient?.recipientAddress?.addressNumber ||
    input.consulta?.imovel_numero || input.imovel?.numero;
  const complement = input.recipient?.recipientAddress?.complement ||
    input.consulta?.imovel_complemento || input.imovel?.complemento;
  const province = input.recipient?.recipientAddress?.province ||
    input.consulta?.imovel_bairro || input.imovel?.bairro;
  const postalCode = input.recipient?.recipientAddress?.postalCode ||
    input.consulta?.imovel_cep || input.imovel?.cep;

  if (address) payload.address = address;
  if (number) payload.addressNumber = String(number);
  if (complement) payload.complement = complement;
  if (province) payload.province = province;
  if (postalCode) payload.postalCode = String(postalCode).replace(/\D/g, "");

  const raw = await asaasFetch("/customers", { method: "POST", body: JSON.stringify(payload) });
  return sanitizeAsaasResponse(raw) as any;
}
