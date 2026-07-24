import {
  decodeBase64,
  encodeBase64,
} from "https://deno.land/std@0.224.0/encoding/base64.ts";
import {
  strFromU8,
  strToU8,
  unzipSync,
  zipSync,
} from "https://esm.sh/fflate@0.8.2";

const D4SIGN_API_DEFAULT = "https://secure.d4sign.com.br/api/v1";
const SIGNED_CONTRACTS_BUCKET = "contratos-assinados";

const TEMPLATE_BY_PLAN = {
  fit: "nox-fit.docx",
  fit_plus: "nox-fit-plus.docx",
  smart: "nox-smart.docx",
  smart_plus: "nox-smart-plus.docx",
  up: "nox-up.docx",
} as const;

export type TemplateKey = keyof typeof TEMPLATE_BY_PLAN;

type DispatchResult = {
  ok: boolean;
  signatureId?: string;
  documentUuid?: string;
  status?: string;
  error?: string;
};

function env(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`missing_configuration:${name}`);
  return value;
}

export function normalizePlanKey(name: unknown): TemplateKey {
  const normalized = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "");
  const aliases: Record<string, TemplateKey> = {
    fit: "fit",
    noxfit: "fit",
    "fit+": "fit_plus",
    fitplus: "fit_plus",
    "noxfit+": "fit_plus",
    noxfitplus: "fit_plus",
    smart: "smart",
    noxsmart: "smart",
    "smart+": "smart_plus",
    smartplus: "smart_plus",
    "noxsmart+": "smart_plus",
    noxsmartplus: "smart_plus",
    up: "up",
    noxup: "up",
  };
  if (aliases[normalized]) return aliases[normalized];
  throw new Error(`unsupported_plan:${String(name || "unknown")}`);
}

export function normalizePhone(value: unknown) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  const nationalNumber = digits.startsWith("55") ? digits.slice(2) : digits;
  if (![10, 11].includes(nationalNumber.length)) return "";
  return `+55${nationalNumber}`;
}

export function resolveContractTemplate(planName: unknown) {
  const templateKey = normalizePlanKey(planName);
  return { templateKey, fileName: TEMPLATE_BY_PLAN[templateKey] };
}

export function buildD4SignSigner(consulta: any) {
  const email = String(consulta?.tenant_email || "")
    .trim()
    .toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("missing_or_invalid_tenant_email");
  }
  const phone = normalizePhone(
    consulta?.tenant_telefone || consulta?.inquilinos?.telefone,
  );
  if (!phone) throw new Error("missing_or_invalid_tenant_phone");

  return {
    email,
    act: "1",
    foreign: "0",
    certificadoicpbr: "0",
    assinatura_presencial: "0",
    docauth: "0",
    docauthandselfie: "0",
    embed_methodauth: "sms",
    embed_smsnumber: phone,
    skipemail: "0",
    upload_allow: "0",
  } as const;
}

export function buildD4SignSendPayload(
  consulta: any,
  planName: unknown,
  token: string,
) {
  return {
    message: `Olá, ${
      consulta?.tenant_name || consulta?.inquilinos?.nome || "cliente"
    }. Assine seu contrato ${String(planName || "NOX")} da NOX Fiança.`,
    skip_email: "0",
    workflow: "0",
    tokenAPI: token,
  } as const;
}

export function extractD4SignSignerKey(
  response: any,
  signerEmail: string,
) {
  const signers: any[] = [];
  const visited = new Set<unknown>();
  const collect = (value: any, depth: number) => {
    if (
      depth > 6 ||
      !value ||
      typeof value !== "object" ||
      visited.has(value) ||
      signers.length >= 100
    ) {
      return;
    }
    visited.add(value);
    if (value.key_signer || value.keySigner) signers.push(value);
    if (Array.isArray(value)) {
      value.forEach((item) => collect(item, depth + 1));
      return;
    }
    Object.values(value).forEach((item) => collect(item, depth + 1));
  };
  collect(response, 0);
  const normalizedEmail = signerEmail.trim().toLowerCase();
  const signer =
    signers.find((candidate: any) =>
      String(candidate?.email || "").trim().toLowerCase() === normalizedEmail
    ) || (signers.length === 1 ? signers[0] : null);
  return signer?.key_signer || signer?.keySigner || null;
}

function normalizeDocument(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function formatCpfCnpj(value: unknown) {
  const digits = normalizeDocument(value);
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  if (digits.length === 14) {
    return digits.replace(
      /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
      "$1.$2.$3/$4-$5",
    );
  }
  return digits;
}

function formatDate(value: unknown) {
  if (!value) return "";
  const raw = String(value);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime())
    ? raw
    : parsed.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function formatCurrency(value: unknown) {
  const number = Number(value || 0);
  return number.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function replaceParagraphText(paragraphXml: string, nextText: string) {
  let replaced = false;
  return paragraphXml.replace(
    /(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g,
    (_match, open, _current, close) => {
      if (replaced) return `${open}${close}`;
      replaced = true;
      const openWithSpace = open.includes("xml:space=")
        ? open
        : open.replace(/>$/, ' xml:space="preserve">');
      return `${openWithSpace}${escapeXml(nextText)}${close}`;
    },
  );
}

function paragraphText(paragraphXml: string) {
  const chunks: string[] = [];
  paragraphXml.replace(
    /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g,
    (_match, text) => {
      chunks.push(decodeXml(text));
      return _match;
    },
  );
  return chunks.join("").trim();
}

function calculatePackageValue(consulta: any) {
  const imovel = consulta?.imoveis || {};
  return (
    Number(
      imovel.valor_aluguel ?? consulta?.valor_aluguel ?? consulta?.rent_value ??
        0,
    ) +
    Number(imovel.valor_condominio ?? consulta?.valor_condominio ?? 0) +
    Number(imovel.valor_taxas ?? consulta?.valor_taxas ?? 0)
  );
}

function personalizeDocumentXml(
  xml: string,
  consulta: any,
  contractNumber: string,
) {
  const inquilino = consulta?.inquilinos || {};
  const imovel = consulta?.imoveis || {};
  const plan = consulta?.planos || {};
  const planCalculated = consulta?.documentos?.plano_calculado || {};
  const extras = consulta?.documentos?.extras || {};
  const administrador = consulta?.administrador || {};
  const tenantName = consulta?.tenant_name || inquilino.nome || "";
  const tenantDocument = consulta?.tenant_document || inquilino.cpf ||
    inquilino.cnpj || "";
  const tenantPhone = consulta?.tenant_telefone || inquilino.telefone || "";
  const packageValue = calculatePackageValue(consulta);
  const multiplier = Number(
    planCalculated.cobertura_multiplicador ?? plan.cobertura_multiplicador ?? 0,
  );
  const coverageValue = packageValue * multiplier;
  const annualValue = Number(
    consulta?.valor_anual || Number(consulta?.valor_premio_mensal || 0) * 12,
  );
  const activationEnabled = Boolean(
    consulta?.activation_fee_enabled ?? extras?.activation_fee_enabled,
  );
  const activationValue = activationEnabled
    ? Number(
      consulta?.activation_fee_amount ?? extras?.activation_fee_amount ?? 0,
    )
    : 0;
  const paintingEnabled = Boolean(
    consulta?.external_painting_enabled ?? extras?.external_painting_enabled,
  );
  const paintingValue = paintingEnabled
    ? Number(
      consulta?.external_painting_total ?? extras?.external_painting_total ?? 0,
    )
    : 0;
  const observations = [
    paintingEnabled
      ? `Pintura interna contratada: ${formatCurrency(paintingValue)}`
      : null,
    activationEnabled
      ? `Taxa de adesão: ${formatCurrency(activationValue)}`
      : null,
    Array.isArray(consulta?.insurance_coverages) &&
      consulta.insurance_coverages.length
      ? `Coberturas adicionais: ${consulta.insurance_coverages.join(", ")}`
      : null,
    consulta?.insurance_assistance
      ? `Assistência contratada: ${consulta.insurance_assistance}`
      : null,
  ].filter(Boolean);
  const occurrences = new Map<string, number>();

  const count = (key: string) => {
    const next = (occurrences.get(key) || 0) + 1;
    occurrences.set(key, next);
    return next;
  };

  return xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (paragraph) => {
    const current = paragraphText(paragraph);
    if (!current) return paragraph;
    let next: string | null = null;

    if (current === "QUADRO RESUMO – CONTRATO Nº") {
      next = `${current} ${contractNumber}`;
    } else if (current === "NOME COMPLETO:") next = `${current} ${tenantName}`;
    else if (current === "INSCRITO NO CPF:") {
      next = `INSCRITO NO CPF/CNPJ: ${formatCpfCnpj(tenantDocument)}`;
    } else if (current === "DATA NASCIMENTO:") {
      next = `${current} ${
        formatDate(
          consulta?.tenant_data_nascimento || inquilino.data_nascimento,
        )
      }`;
    } else if (current === "TELEFONE:") {
      const occurrence = count("telefone");
      if (occurrence === 1) next = `${current} ${tenantPhone}`;
      else if (occurrence === 2 && administrador.telefone) {
        next = `${current} ${administrador.telefone}`;
      }
    } else if (current === "EMAIL:") {
      const occurrence = count("email");
      if (occurrence === 1) next = `${current} ${consulta?.tenant_email || ""}`;
      else if (occurrence === 2 && administrador.email) {
        next = `${current} ${administrador.email}`;
      }
    } else if (current.startsWith("NOME/RAZÃO SOCIAL:") && administrador.nome) {
      next = `NOME/RAZÃO SOCIAL: ${administrador.nome}`;
    } else if (
      current.startsWith("INSCRITO NO CNPJ/MF OU CPF:") &&
      administrador.documento
    ) {
      next = `INSCRITO NO CNPJ/MF OU CPF: ${
        formatCpfCnpj(administrador.documento)
      }`;
    } else if (
      current.startsWith("COM ENDEREÇO NA:") && administrador.endereco
    ) {
      next = `COM ENDEREÇO NA: ${administrador.endereco}`;
    } else if (current === "TIPO IMÓVEL:") {
      next = `${current} ${
        consulta?.imovel_subtipo || imovel.tipo || consulta?.tipo_imovel || ""
      }`;
    } else if (current.startsWith("ENDEREÇO:")) {
      next = `ENDEREÇO: ${
        consulta?.imovel_endereco || imovel.endereco || ""
      }, ${consulta?.imovel_numero || imovel.numero || "S/N"}`;
    } else if (current === "COMPLEMENTO:") {
      const occurrence = count("complemento");
      if (occurrence === 1 && administrador.complemento) {
        next = `${current} ${administrador.complemento}`;
      } else if (occurrence === 2) {
        next = `${current} ${
          consulta?.imovel_complemento || imovel.complemento || ""
        }`;
      }
    } else if (current.startsWith("BAIRRO:")) {
      const occurrence = count("bairro");
      if (occurrence === 1 && administrador.bairro) {
        next = `BAIRRO: ${administrador.bairro}`;
      } else if (occurrence === 2) {
        next = `BAIRRO: ${consulta?.imovel_bairro || imovel.bairro || ""}`;
      }
    } else if (current.startsWith("CIDADE:")) {
      const occurrence = count("cidade");
      if (occurrence === 1 && administrador.cidade) {
        next = `CIDADE: ${administrador.cidade}`;
      } else if (occurrence === 2) {
        next = `CIDADE: ${consulta?.imovel_cidade || imovel.cidade || ""}`;
      }
    } else if (current.startsWith("UF:")) {
      const occurrence = count("uf");
      if (occurrence === 1 && administrador.estado) {
        next = `UF: ${administrador.estado}`;
      } else if (occurrence === 2) {
        next = `UF: ${consulta?.imovel_estado || imovel.estado || ""}`;
      }
    } else if (current.startsWith("CEP:")) {
      const occurrence = count("cep");
      if (occurrence === 1 && administrador.cep) {
        next = `CEP: ${administrador.cep}`;
      } else if (occurrence === 2) {
        next = `CEP: ${consulta?.imovel_cep || imovel.cep || ""}`;
      }
    } else if (current.startsWith("VALOR TOTAL CONTRATADO – R$")) {
      next = current.replace(/R\$\s*X+/i, formatCurrency(coverageValue));
    } else if (
      current.startsWith("LOCAÇÃO – R$") ||
      current.startsWith("PACOTE LOCATÍCIO – R$")
    ) {
      next = current.replace(/R\$\s*X+/i, formatCurrency(packageValue));
    } else if (current.startsWith("VALOR DA TAXA – R$")) {
      next = current.replace(/R\$\s*X+/i, formatCurrency(annualValue));
    } else if (current.startsWith("TAXA DE ADESÃO (SETUP)")) {
      next = activationEnabled
        ? `TAXA DE ADESÃO (SETUP) – ${formatCurrency(activationValue)}.`
        : "TAXA DE ADESÃO (SETUP) – NÃO CONTRATADA.";
    } else if (current.startsWith("OBSERVAÇÕES –")) {
      next = `OBSERVAÇÕES – ${
        observations.length ? observations.join("; ") : "Sem serviços extras."
      }`;
    } else if (current.startsWith("CONTRATO ATIVADO PELA NOX FIANÇA LTDA EM")) {
      const now = new Date();
      next = `CONTRATO EMITIDO PELA NOX FIANÇA LTDA EM ${
        now.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
      } ÀS ${
        now.toLocaleTimeString("pt-BR", {
          timeZone: "America/Sao_Paulo",
          hour: "2-digit",
          minute: "2-digit",
        })
      } (HORÁRIO DE BRASÍLIA).`;
    }

    return next === null ? paragraph : replaceParagraphText(paragraph, next);
  });
}

export async function buildContractDocx(
  templateKey: TemplateKey,
  consulta: any,
  contractNumber: string,
) {
  const fileName = TEMPLATE_BY_PLAN[templateKey];
  const templateUrl = new URL(
    `./contract-templates/${fileName}`,
    import.meta.url,
  );
  const original = await Deno.readFile(templateUrl);
  const archive = unzipSync(original);
  const documentXml = archive["word/document.xml"];
  if (!documentXml) throw new Error(`invalid_template:${fileName}`);
  archive["word/document.xml"] = strToU8(
    personalizeDocumentXml(strFromU8(documentXml), consulta, contractNumber),
  );
  return { bytes: zipSync(archive, { level: 6 }), fileName };
}

function d4SignUrl(path: string) {
  const base = (Deno.env.get("D4SIGN_API_BASE_URL") || D4SIGN_API_DEFAULT)
    .replace(/\/$/, "");
  const url = new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`);
  url.searchParams.set("tokenAPI", env("D4SIGN_TOKEN_API"));
  url.searchParams.set("cryptKey", env("D4SIGN_CRYPT_KEY"));
  return url;
}

async function d4SignRequest(path: string, init: RequestInit) {
  const response = await fetch(d4SignUrl(path), {
    ...init,
    headers: { Accept: "application/json", ...(init.headers || {}) },
  });
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { message: text.slice(0, 500) };
  }
  if (!response.ok) {
    const message = body?.message || body?.error || `HTTP ${response.status}`;
    throw new Error(
      `d4sign_api_error:${response.status}:${String(message).slice(0, 300)}`,
    );
  }
  return body;
}

function decodeD4SignSignerId(signerKey: string) {
  let decoded = "";
  try {
    decoded = new TextDecoder().decode(decodeBase64(signerKey)).trim();
  } catch {
    throw new Error("invalid_d4sign_signer_key");
  }
  if (!/^\d+$/.test(decoded)) {
    throw new Error("invalid_d4sign_signer_id");
  }
  return decoded;
}

async function getD4SignSignatureLink(
  documentUuid: string,
  signerKey: string,
) {
  const signerId = decodeD4SignSignerId(signerKey);
  const result = await d4SignRequest(
    `/documents/${encodeURIComponent(documentUuid)}/signaturelink/${
      encodeURIComponent(signerId)
    }`,
    { method: "GET" },
  );
  const link = String(result?.link || "").trim();
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    throw new Error("d4sign_signature_link_missing");
  }
  if (
    parsed.protocol !== "https:" ||
    !/(^|\.)d4sign\.com\.br$/i.test(parsed.hostname)
  ) {
    throw new Error("d4sign_signature_link_invalid");
  }
  return parsed.toString();
}

function buildWebhookUrl() {
  const explicit = Deno.env.get("D4SIGN_WEBHOOK_URL")?.trim();
  const base = explicit ||
    `${env("SUPABASE_URL").replace(/\/$/, "")}/functions/v1/d4sign-webhook`;
  const url = new URL(base);
  url.searchParams.set("secret", env("D4SIGN_WEBHOOK_SECRET"));
  return url.toString();
}

function contractNumber(consultationId: string) {
  return `NOX-${new Date().getUTCFullYear()}-${
    consultationId.replace(/-/g, "").slice(0, 10).toUpperCase()
  }`;
}

async function ensureTenantAccount(supabase: any, consulta: any) {
  const email = String(consulta?.tenant_email || "")
    .trim()
    .toLowerCase();
  if (!email) throw new Error("missing_tenant_email");
  let tenantUserId = consulta?.tenant_user_id || null;
  let existingProfile: any = null;

  if (!tenantUserId) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, role, status, email, nome, telefone")
      .ilike("email", email)
      .limit(1);
    existingProfile = profiles?.[0] || null;
    if (existingProfile && existingProfile.role !== "inquilino") {
      throw new Error("tenant_email_already_used_by_other_role");
    }
    tenantUserId = existingProfile?.id || null;

    const tenantPhone = normalizePhone(
      consulta?.tenant_telefone || consulta?.inquilinos?.telefone,
    );
    if (!tenantUserId && tenantPhone) {
      const pageSize = 500;
      for (let from = 0; !tenantUserId; from += pageSize) {
        const { data: phoneProfiles, error: phoneError } = await supabase
          .from("profiles")
          .select("id, role, status, email, nome, telefone")
          .eq("role", "inquilino")
          .or("status.eq.ativo,status.is.null")
          .not("telefone", "is", null)
          .range(from, from + pageSize - 1);
        if (phoneError) break;
        existingProfile = (phoneProfiles || []).find(
          (profile: any) => normalizePhone(profile.telefone) === tenantPhone,
        ) || null;
        tenantUserId = existingProfile?.id || null;
        if ((phoneProfiles || []).length < pageSize) break;
      }
    }
  } else {
    const { data: tenantProfile } = await supabase
      .from("profiles")
      .select("id, role, status, email, nome, telefone")
      .eq("id", tenantUserId)
      .maybeSingle();
    existingProfile = tenantProfile || null;
    if (tenantProfile?.role && tenantProfile.role !== "inquilino") {
      throw new Error("tenant_account_has_other_role");
    }
  }

  if (!tenantUserId) {
    const randomPassword = `Nox!${crypto.randomUUID().replace(/-/g, "")}aA9`;
    const { data: created, error } = await supabase.auth.admin.createUser({
      email,
      password: randomPassword,
      email_confirm: true,
      user_metadata: {
        nome: consulta?.tenant_name || consulta?.inquilinos?.nome ||
          "Inquilino",
        cpf: normalizeDocument(
          consulta?.tenant_document || consulta?.inquilinos?.cpf,
        ),
        telefone: consulta?.tenant_telefone || null,
        role: "inquilino",
        tenant_access_setup_required: true,
      },
    });
    if (error || !created?.user) {
      throw new Error(`tenant_account_error:${error?.message || "unknown"}`);
    }
    tenantUserId = created.user.id;
  }

  await supabase.from("profiles").upsert(
    {
      id: tenantUserId,
      email: existingProfile?.email || email,
      nome: existingProfile?.nome || consulta?.tenant_name ||
        consulta?.inquilinos?.nome || "Inquilino",
      telefone: existingProfile?.telefone || consulta?.tenant_telefone || null,
      role: "inquilino",
      status: "ativo",
    },
    { onConflict: "id" },
  );
  await supabase
    .from("consultas_credito")
    .update({ tenant_user_id: tenantUserId })
    .eq("id", consulta.id);
  await supabase
    .from("faturas_inquilino")
    .update({ tenant_user_id: tenantUserId })
    .eq("consulta_id", consulta.id);
  await supabase
    .from("documentos_proposta")
    .update({ tenant_user_id: tenantUserId })
    .eq("consulta_id", consulta.id);
  if (consulta?.inquilino_id) {
    await supabase
      .from("inquilinos")
      .update({ profile_id: tenantUserId })
      .eq("id", consulta.inquilino_id);
  }
  return tenantUserId as string;
}

function administratorFromAgency(imobiliaria: any) {
  if (!imobiliaria) return null;
  return {
    nome: imobiliaria.razao_social || imobiliaria.nome_fantasia,
    documento: imobiliaria.cnpj,
    endereco: imobiliaria.endereco,
    complemento: imobiliaria.complemento,
    bairro: imobiliaria.bairro,
    cidade: imobiliaria.cidade,
    estado: imobiliaria.estado,
    cep: imobiliaria.cep,
    telefone: imobiliaria.contato_telefone,
    email: imobiliaria.contato_email,
  };
}

async function getConsultation(supabase: any, consultationId: string) {
  const { data, error } = await supabase
    .from("consultas_credito")
    .select("*, inquilinos(*), imoveis(*), planos(*)")
    .eq("id", consultationId)
    .single();
  if (error || !data) {
    throw new Error(
      `consultation_not_found:${error?.message || consultationId}`,
    );
  }

  let administrador: any = null;
  const imobiliariaId = data?.imoveis?.imobiliaria_id || null;
  if (imobiliariaId) {
    const { data: imobiliaria } = await supabase
      .from("imobiliarias")
      .select("*")
      .eq("id", imobiliariaId)
      .maybeSingle();
    administrador = administratorFromAgency(imobiliaria);
  }

  if (!administrador && data?.corretor_id) {
    const { data: corretor } = await supabase
      .from("corretores")
      .select("*, profiles(*)")
      .eq("id", data.corretor_id)
      .maybeSingle();
    if (corretor?.imobiliaria_id) {
      const { data: imobiliaria } = await supabase
        .from("imobiliarias")
        .select("*")
        .eq("id", corretor.imobiliaria_id)
        .maybeSingle();
      administrador = administratorFromAgency(imobiliaria);
    }
    if (!administrador && corretor) {
      const profile = Array.isArray(corretor.profiles)
        ? corretor.profiles[0]
        : corretor.profiles;
      administrador = {
        nome: profile?.nome,
        documento: corretor.cpf || profile?.cpf || profile?.cnpj,
        telefone: profile?.telefone,
        email: profile?.email,
      };
    }
  }

  if (!administrador && data?.profile_id_solicitante) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", data.profile_id_solicitante)
      .maybeSingle();
    if (profile?.role === "imobiliaria") {
      const { data: imobiliaria } = await supabase
        .from("imobiliarias")
        .select("*")
        .ilike("contato_email", profile.email)
        .maybeSingle();
      administrador = administratorFromAgency(imobiliaria);
    }
    administrador ||= profile
      ? {
        nome: profile.nome,
        documento: profile.cpf || profile.cnpj,
        telefone: profile.telefone,
        email: profile.email,
      }
      : null;
  }

  return { ...data, administrador };
}

function isPaidStatus(status: unknown) {
  return ["confirmed", "paid", "received", "aprovado"].includes(
    String(status || "").toLowerCase(),
  );
}

async function createSignatureRow(
  supabase: any,
  consulta: any,
  templateKey: TemplateKey,
  tenantUserId: string,
) {
  const { data: existing } = await supabase
    .from("contract_signatures")
    .select("*")
    .eq("consultation_id", consulta.id)
    .maybeSingle();
  if (existing) return existing;

  const payload = {
    consultation_id: consulta.id,
    tenant_user_id: tenantUserId,
    plan_name: consulta?.planos?.nome ||
      consulta?.documentos?.plano_calculado?.nome || templateKey,
    template_file: TEMPLATE_BY_PLAN[templateKey],
    status: "processing",
    send_attempts: 0,
  };
  const { data, error } = await supabase
    .from("contract_signatures")
    .insert(payload)
    .select("*")
    .single();
  if (!error && data) return data;

  const { data: raced, error: racedError } = await supabase
    .from("contract_signatures")
    .select("*")
    .eq("consultation_id", consulta.id)
    .single();
  if (racedError || !raced) {
    throw new Error(
      `signature_row_error:${error?.message || racedError?.message}`,
    );
  }
  return raced;
}

export async function dispatchD4SignContract(
  supabase: any,
  consultationId: string,
): Promise<DispatchResult> {
  let signature: any = null;
  try {
    const consulta = await getConsultation(supabase, consultationId);
    if (!isPaidStatus(consulta.payment_status)) {
      return {
        ok: false,
        status: "waiting_payment",
        error: "payment_not_confirmed",
      };
    }

    const planName = consulta?.planos?.nome ||
      consulta?.documentos?.plano_calculado?.nome;
    const { templateKey } = resolveContractTemplate(planName);
    const tenantUserId = await ensureTenantAccount(supabase, consulta);
    signature = await createSignatureRow(
      supabase,
      consulta,
      templateKey,
      tenantUserId,
    );

    if (["awaiting_signature", "signed", "active"].includes(signature.status)) {
      if (signature.status === "awaiting_signature") {
        await ensureSignatureInviteWhatsapp(supabase, signature, consulta);
      }
      return {
        ok: true,
        signatureId: signature.id,
        documentUuid: signature.d4sign_document_uuid || undefined,
        status: signature.status,
      };
    }

    await supabase
      .from("contract_signatures")
      .update({
        status: "processing",
        error_code: null,
        error_message: null,
        send_attempts: Number(signature.send_attempts || 0) + 1,
      })
      .eq("id", signature.id);

    const token = env("D4SIGN_TOKEN_API");
    env("D4SIGN_CRYPT_KEY");
    const safeUuid = Deno.env.get("D4SIGN_SAFE_UUID")?.trim() ||
      "9fbb5127-b896-4310-bdca-3933841dfd3a";
    const number = contractNumber(consultationId);
    let documentUuid = signature.d4sign_document_uuid as string | null;

    if (!documentUuid) {
      const built = await buildContractDocx(templateKey, consulta, number);
      const uploaded = await d4SignRequest(
        `/documents/${safeUuid}/uploadbinary`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base64_binary_file: encodeBase64(built.bytes),
            mime_type:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            name: `${number} - ${String(planName || "Contrato NOX")}.docx`,
          }),
        },
      );
      documentUuid = uploaded?.uuid;
      if (!documentUuid) throw new Error("d4sign_upload_missing_uuid");
      await supabase
        .from("contract_signatures")
        .update({ d4sign_document_uuid: documentUuid })
        .eq("id", signature.id);
    }

    await d4SignRequest(`/documents/${documentUuid}/webhooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: buildWebhookUrl() }),
    });

    const signerPayload = buildD4SignSigner(consulta);
    let signerKey = signature.d4sign_signer_key as string | null;
    if (!signerKey) {
      const listed = await d4SignRequest(`/documents/${documentUuid}/list`, {
        method: "GET",
      });
      signerKey = extractD4SignSignerKey(listed, signerPayload.email);
    }
    if (!signerKey) {
      await d4SignRequest(
        `/documents/${documentUuid}/createlist`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signers: [
              signerPayload,
            ],
          }),
        },
      );
      for (let attempt = 0; attempt < 3 && !signerKey; attempt += 1) {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1200));
        }
        try {
          const listed = await d4SignRequest(
            `/documents/${documentUuid}/list`,
            { method: "GET" },
          );
          signerKey = extractD4SignSignerKey(listed, signerPayload.email);
        } catch {
          // A criação do signatário não é repetida: a D4Sign pode efetivar a
          // inclusão antes de devolver um erro transitório e uma nova chamada
          // criaria notificações duplicadas. Apenas a leitura é repetida.
        }
      }
      if (!signerKey) throw new Error("d4sign_signer_missing_key");
      await supabase
        .from("contract_signatures")
        .update({ d4sign_signer_key: signerKey })
        .eq("id", signature.id);
    }

    // sendtosigner dispara notificações externas e não é seguro repetir
    // automaticamente: um timeout depois do envio causaria e-mails duplicados.
    await d4SignRequest(`/documents/${documentUuid}/sendtosigner`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        buildD4SignSendPayload(consulta, planName, token),
      ),
    });

    const now = new Date().toISOString();
    await supabase
      .from("contract_signatures")
      .update({
        d4sign_signer_key: signerKey,
        status: "awaiting_signature",
        sent_at: now,
        error_code: null,
        error_message: null,
      })
      .eq("id", signature.id);
    await supabase
      .from("consultas_credito")
      .update({
        status: "aguardando_ativacao",
        substatus: "aguardando_assinatura_d4sign",
        proposta_enviada_em: now,
        activation_status: "aguardando_assinatura",
      })
      .eq("id", consultationId);
    await supabase.from("proposta_historico").insert({
      consulta_id: consultationId,
      tipo_evento: "contrato_d4sign_enviado",
      descricao:
        `Contrato ${planName} enviado por e-mail e WhatsApp ao inquilino.`,
    });
    await logNotification(
      supabase,
      signature.id,
      "email",
      { sent: true },
      "signature_invite",
    );
    await ensureSignatureInviteWhatsapp(
      supabase,
      {
        ...signature,
        d4sign_document_uuid: documentUuid,
        d4sign_signer_key: signerKey,
        plan_name: planName,
      },
      consulta,
    );

    return {
      ok: true,
      signatureId: signature.id,
      documentUuid,
      status: "awaiting_signature",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (signature?.id) {
      await supabase
        .from("contract_signatures")
        .update({
          status: "error",
          error_code: message.split(":")[0],
          error_message: message.slice(0, 1000),
        })
        .eq("id", signature.id);
    }
    console.error("[d4sign] falha ao enviar contrato", {
      consultationId,
      signatureId: signature?.id || null,
      message,
    });
    return {
      ok: false,
      signatureId: signature?.id,
      status: "error",
      error: message,
    };
  }
}

async function downloadSignedPdf(documentUuid: string) {
  const result = await d4SignRequest(`/documents/${documentUuid}/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "pdf", language: "pt", encoding: false }),
  });
  if (!result?.url) throw new Error("d4sign_download_missing_url");
  const response = await fetch(result.url);
  if (!response.ok) throw new Error(`d4sign_download_error:${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    return { bytes, name: result.name || "contrato-assinado.pdf" };
  }
  const text = new TextDecoder().decode(bytes).trim();
  return {
    bytes: decodeBase64(text),
    name: result.name || "contrato-assinado.pdf",
  };
}

async function createOrGetPolicy(supabase: any, consulta: any) {
  const { data: existing } = await supabase
    .from("apolices")
    .select("*")
    .eq("consulta_id", consulta.id)
    .limit(1);
  if (existing?.[0]) {
    if (existing[0].status !== "ativa") {
      await supabase.from("apolices").update({ status: "ativa" }).eq(
        "id",
        existing[0].id,
      );
    }
    return { ...existing[0], status: "ativa" };
  }

  const starts = new Date();
  const ends = new Date(starts);
  ends.setUTCFullYear(ends.getUTCFullYear() + 1);
  const role = String(consulta.role_solicitante || "").toLowerCase();
  const { data, error } = await supabase
    .from("apolices")
    .insert({
      consulta_id: consulta.id,
      numero: contractNumber(consulta.id),
      status: "ativa",
      valor_premio: Number(
        consulta.valor_anual || Number(consulta.valor_premio_mensal || 0) * 12,
      ),
      vigencia_inicio: starts.toISOString().slice(0, 10),
      vigencia_fim: ends.toISOString().slice(0, 10),
      corretor_profile_id: role === "corretor"
        ? consulta.profile_id_solicitante
        : null,
      imobiliaria_profile_id: role === "imobiliaria"
        ? consulta.profile_id_solicitante
        : null,
      proprietario_profile_id: role === "proprietario"
        ? consulta.profile_id_solicitante
        : null,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`policy_create_error:${error?.message || "unknown"}`);
  }
  return data;
}

async function tenantAccessLink(
  supabase: any,
  email: string,
  tenantUserId: string,
  returnTo = "/inquilino/painel",
) {
  const safeReturnTo = returnTo === "/inquilino/documentos"
    ? returnTo
    : "/inquilino/painel";
  const frontend = (Deno.env.get("FRONTEND_URL") || "https://noxfianca.com")
    .replace(/\/$/, "");
  const fallback = `${frontend}/login?returnTo=${
    encodeURIComponent(safeReturnTo)
  }`;
  const { data: tenantAuth } = await supabase.auth.admin.getUserById(
    tenantUserId,
  );
  const setupRequired =
    tenantAuth?.user?.user_metadata?.tenant_access_setup_required === true;
  if (!setupRequired) {
    return `${frontend}${safeReturnTo}`;
  }
  const accessEmail = String(tenantAuth?.user?.email || email)
    .trim()
    .toLowerCase();
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: accessEmail,
  });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) return fallback;
  const url = new URL(`${frontend}/acesso-inquilino`);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", "magiclink");
  url.searchParams.set("returnTo", safeReturnTo);
  return url.toString();
}

async function notificationWasSent(
  supabase: any,
  signatureId: string,
  channel: string,
  notificationType = "insurance_active",
) {
  const { data } = await supabase
    .from("contract_notification_deliveries")
    .select("id")
    .eq("contract_signature_id", signatureId)
    .eq("channel", channel)
    .eq("notification_type", notificationType)
    .eq("status", "sent")
    .maybeSingle();
  return !!data;
}

async function logNotification(
  supabase: any,
  signatureId: string,
  channel: "email" | "whatsapp" | "push",
  result: {
    sent: boolean;
    reason?: string;
    providerMessageId?: string;
  },
  notificationType = "insurance_active",
) {
  const { data: previous } = await supabase
    .from("contract_notification_deliveries")
    .select("attempts")
    .eq("contract_signature_id", signatureId)
    .eq("channel", channel)
    .eq("notification_type", notificationType)
    .maybeSingle();
  await supabase.from("contract_notification_deliveries").upsert(
    {
      contract_signature_id: signatureId,
      channel,
      notification_type: notificationType,
      status: result.sent
        ? "sent"
        : result.reason === "not_configured"
        ? "not_configured"
        : "failed",
      attempts: Number(previous?.attempts || 0) + 1,
      last_error: result.sent ? null : result.reason || "provider_error",
      sent_at: result.sent ? new Date().toISOString() : null,
    },
    { onConflict: "contract_signature_id,channel,notification_type" },
  );
  if (channel === "whatsapp" && result.sent && result.providerMessageId) {
    await supabase.from("contract_signature_events").upsert(
      {
        contract_signature_id: signatureId,
        event_key: `zapi:${notificationType}:sent:${result.providerMessageId}`,
        event_type: notificationType === "signature_invite"
          ? "zapi_signature_invite_sent"
          : "zapi_message_sent",
        message: notificationType === "signature_invite"
          ? "Convite para assinatura aceito pela Z-API."
          : "Mensagem de ativação aceita pela Z-API.",
        payload: {
          provider_message_id: result.providerMessageId,
          channel: "whatsapp",
          notification_type: notificationType,
        },
      },
      { onConflict: "event_key", ignoreDuplicates: true },
    );
  }
}

async function sendActiveEmail(params: {
  to: string;
  name: string;
  planName: string;
  dashboardUrl: string;
}) {
  const apiKey = Deno.env.get("RESEND_API_KEY")?.trim();
  if (!apiKey) return { sent: false, reason: "not_configured" };
  const from = Deno.env.get("RESEND_FROM_EMAIL") ||
    "NOX FIANÇA <financeiro@noxfianca.com.br>";
  const appDocumentsUrl = buildAppDocumentsBridgeUrl(params.dashboardUrl);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [params.to],
      subject: "Parabéns, seu seguro está ativo — NOX Fiança",
      html: `
        <div style="font-family:Arial,sans-serif;color:#171717;line-height:1.6;max-width:620px;margin:auto">
          <h1 style="font-size:26px">🎉 Parabéns,seu contrato está ativo! 🌙</h1>
          <p>– para visualizar seus documentos acesso o site da <strong>NOX FIANÇA</strong></p>
          <p>– caso nao tenha crie um acesso com suas informações no site da <strong>NOX FIANÇA</strong> para visualizar seus documentos</p>
          <p style="margin:28px 0 12px"><a href="${params.dashboardUrl}" style="display:inline-block;background:#ffd21c;color:#171717;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:10px">Ver Documentos (Site)</a></p>
          <p style="margin:0 0 28px"><a href="${appDocumentsUrl}" style="display:inline-block;background:#171717;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:10px">Ver Documentos (Aplicativo)</a></p>
          <p>Equipe NOX Fiança</p>
        </div>
      `,
    }),
  });
  if (!response.ok) {
    return { sent: false, reason: `provider_${response.status}` };
  }
  return { sent: true };
}

function buildAppDocumentsBridgeUrl(dashboardUrlValue: string) {
  const dashboardUrl = new URL(dashboardUrlValue);
  const appDocumentsUrl = new URL("/abrir-app/documentos", dashboardUrl.origin);
  const tokenHash = dashboardUrl.searchParams.get("token_hash");
  if (tokenHash) {
    appDocumentsUrl.searchParams.set("token_hash", tokenHash);
    appDocumentsUrl.searchParams.set("type", "magiclink");
  }
  appDocumentsUrl.searchParams.set("returnTo", "/inquilino/documentos");
  return appDocumentsUrl.toString();
}

export function buildSignatureInviteZApiPayload(params: {
  to: string;
  name: string;
  planName: string;
  signatureUrl: string;
}) {
  const phone = normalizePhone(params.to);
  if (!phone) throw new Error("invalid_phone");

  let signatureUrl: URL;
  try {
    signatureUrl = new URL(params.signatureUrl);
  } catch {
    throw new Error("invalid_signature_url");
  }
  if (
    signatureUrl.protocol !== "https:" ||
    !/(^|\.)d4sign\.com\.br$/i.test(signatureUrl.hostname)
  ) {
    throw new Error("invalid_signature_destination");
  }

  return {
    phone: phone.replace(/^\+/, ""),
    message:
      `Olá, ${params.name}. Seu contrato ${params.planName} da NOX Fiança está pronto para assinatura.`,
    buttonActions: [
      {
        id: "assinar-contrato-d4sign",
        type: "URL",
        label: "Assinar contrato",
        url: signatureUrl.toString(),
      },
    ],
  } as const;
}

export function buildInsuranceActiveZApiPayload(params: {
  to: string;
  name: string;
  planName: string;
  dashboardUrl: string;
}) {
  const phone = normalizePhone(params.to);
  if (!phone) throw new Error("invalid_phone");

  let dashboardUrl: URL;
  try {
    dashboardUrl = new URL(params.dashboardUrl);
  } catch {
    throw new Error("invalid_dashboard_url");
  }
  if (dashboardUrl.protocol !== "https:") {
    throw new Error("invalid_dashboard_protocol");
  }
  const isFirstAccess =
    dashboardUrl.pathname === "/acesso-inquilino" &&
    !!dashboardUrl.searchParams.get("token_hash") &&
    dashboardUrl.searchParams.get("type") === "magiclink" &&
    dashboardUrl.searchParams.get("returnTo") === "/inquilino/documentos";
  const isExistingAccount =
    dashboardUrl.pathname === "/inquilino/documentos";
  if (!isFirstAccess && !isExistingAccount) {
    throw new Error("invalid_documents_destination");
  }

  return {
    phone: phone.replace(/^\+/, ""),
    message: "🎉 Parabéns,seu contrato está ativo!  🌙\n\n" +
      "- para visualizar seus documentos acesso o site da *NOX FIANÇA*\n\n" +
      "- caso nao tenha crie um acesso com suas informações no site da " +
      "*NOX FIANÇA* para visualizar seus documentos",
    buttonActions: [
      {
        id: "ver-documentos-site",
        type: "URL",
        label: "Ver Documentos (Site)",
        url: dashboardUrl.toString(),
      },
      {
        id: "ver-documentos-aplicativo",
        type: "URL",
        label: "Ver Documentos (Aplicativo)",
        url: buildAppDocumentsBridgeUrl(dashboardUrl.toString()),
      },
    ],
  } as const;
}

async function sendSignatureInviteWhatsapp(params: {
  to: string;
  name: string;
  planName: string;
  signatureUrl: string;
}) {
  const instanceId = Deno.env.get("ZAPI_INSTANCE_ID")?.trim();
  const instanceToken = Deno.env.get("ZAPI_INSTANCE_TOKEN")?.trim();
  const clientToken = Deno.env.get("ZAPI_CLIENT_TOKEN")?.trim();
  if (!instanceId || !instanceToken) {
    return { sent: false, reason: "not_configured" };
  }
  if (
    !/^[a-zA-Z0-9_-]+$/.test(instanceId) ||
    !/^[a-zA-Z0-9_-]+$/.test(instanceToken)
  ) {
    return { sent: false, reason: "invalid_zapi_credentials" };
  }

  let payload;
  try {
    payload = buildSignatureInviteZApiPayload(params);
  } catch (error) {
    return {
      sent: false,
      reason: error instanceof Error ? error.message : "invalid_payload",
    };
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (clientToken) headers["Client-Token"] = clientToken;
  const response = await fetch(
    `https://api.z-api.io/instances/${encodeURIComponent(instanceId)}/token/${
      encodeURIComponent(instanceToken)
    }/send-button-actions`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const errorCode = String(
      body?.error || body?.message || body?.code || "unknown",
    ).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60);
    return {
      sent: false,
      reason: `zapi_${response.status}_${errorCode}`.slice(0, 120),
    };
  }
  const body = await response.json().catch(() => ({}));
  const providerMessageId = body?.messageId || body?.zaapId || body?.id;
  if (!providerMessageId) {
    return { sent: false, reason: "zapi_missing_message_id" };
  }
  return { sent: true, providerMessageId: String(providerMessageId) };
}

async function sendActiveWhatsapp(params: {
  to: string;
  name: string;
  planName: string;
  dashboardUrl: string;
}) {
  const instanceId = Deno.env.get("ZAPI_INSTANCE_ID")?.trim();
  const instanceToken = Deno.env.get("ZAPI_INSTANCE_TOKEN")?.trim();
  const clientToken = Deno.env.get("ZAPI_CLIENT_TOKEN")?.trim();
  if (!instanceId || !instanceToken) {
    return { sent: false, reason: "not_configured" };
  }
  if (
    !/^[a-zA-Z0-9_-]+$/.test(instanceId) ||
    !/^[a-zA-Z0-9_-]+$/.test(instanceToken)
  ) {
    return { sent: false, reason: "invalid_zapi_credentials" };
  }

  let payload;
  try {
    payload = buildInsuranceActiveZApiPayload(params);
  } catch (error) {
    return {
      sent: false,
      reason: error instanceof Error ? error.message : "invalid_payload",
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (clientToken) headers["Client-Token"] = clientToken;

  const response = await fetch(
    `https://api.z-api.io/instances/${encodeURIComponent(instanceId)}/token/${
      encodeURIComponent(instanceToken)
    }/send-button-actions`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const errorCode = String(
      body?.error || body?.message || body?.code || "unknown",
    ).replace(
      /[^a-zA-Z0-9_-]/g,
      "",
    ).slice(0, 60);
    console.error("[d4sign] falha ao enviar WhatsApp pela Z-API", {
      status: response.status,
      errorCode,
    });
    return {
      sent: false,
      reason: `zapi_${response.status}_${errorCode}`.slice(0, 120),
    };
  }
  const body = await response.json().catch(() => ({}));
  const providerMessageId = body?.messageId || body?.zaapId || body?.id;
  if (!providerMessageId) {
    return { sent: false, reason: "zapi_missing_message_id" };
  }
  return { sent: true, providerMessageId: String(providerMessageId) };
}

async function ensureSignatureInviteWhatsapp(
  supabase: any,
  signature: any,
  consulta: any,
) {
  if (
    await notificationWasSent(
      supabase,
      signature.id,
      "whatsapp",
      "signature_invite",
    )
  ) {
    return;
  }
  const phone = consulta.tenant_telefone || consulta?.inquilinos?.telefone ||
    "";
  const name = consulta.tenant_name || consulta?.inquilinos?.nome || "cliente";
  let result: {
    sent: boolean;
    reason?: string;
    providerMessageId?: string;
  };
  try {
    if (!signature.d4sign_document_uuid || !signature.d4sign_signer_key) {
      throw new Error("d4sign_signature_link_not_ready");
    }
    let signatureUrl = "";
    for (let attempt = 0; attempt < 3 && !signatureUrl; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1200));
      }
      try {
        signatureUrl = await getD4SignSignatureLink(
          signature.d4sign_document_uuid,
          signature.d4sign_signer_key,
        );
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
    result = await sendSignatureInviteWhatsapp({
      to: phone,
      name,
      planName: signature.plan_name,
      signatureUrl,
    });
  } catch (error) {
    result = {
      sent: false,
      reason: error instanceof Error ? error.message : "provider_error",
    };
  }
  await logNotification(
    supabase,
    signature.id,
    "whatsapp",
    result,
    "signature_invite",
  );
}

async function notifyInsuranceActive(
  supabase: any,
  signature: any,
  consulta: any,
  tenantUserId: string,
) {
  const email = String(consulta.tenant_email || "")
    .trim()
    .toLowerCase();
  const name = consulta.tenant_name || consulta?.inquilinos?.nome || "cliente";
  let dashboardUrl = `${
    (Deno.env.get("FRONTEND_URL") || "https://noxfianca.com").replace(/\/$/, "")
  }/login`;
  const emailWasSent = await notificationWasSent(
    supabase,
    signature.id,
    "email",
  );
  const whatsappWasSent = await notificationWasSent(
    supabase,
    signature.id,
    "whatsapp",
  );
  const documentsAccessUrl = !emailWasSent || !whatsappWasSent
    ? await tenantAccessLink(
      supabase,
      email,
      tenantUserId,
      "/inquilino/documentos",
    )
    : dashboardUrl;

  if (!emailWasSent) {
    dashboardUrl = documentsAccessUrl;
    const result = await sendActiveEmail({
      to: email,
      name,
      planName: signature.plan_name,
      dashboardUrl: documentsAccessUrl,
    }).catch((error) => ({
      sent: false,
      reason: error instanceof Error ? error.message : "provider_error",
    }));
    await logNotification(supabase, signature.id, "email", result);
  }
  if (!whatsappWasSent) {
    dashboardUrl = documentsAccessUrl;
    const result = await sendActiveWhatsapp({
      to: consulta.tenant_telefone || "",
      name,
      planName: signature.plan_name,
      dashboardUrl: documentsAccessUrl,
    }).catch((error) => ({
      sent: false,
      reason: error instanceof Error ? error.message : "provider_error",
    }));
    await logNotification(supabase, signature.id, "whatsapp", result);
  }

  if (!(await notificationWasSent(supabase, signature.id, "push"))) {
    await supabase.from("notificacoes").insert({
      user_id: tenantUserId,
      titulo: "Parabéns, seu seguro está ativo!",
      mensagem:
        `O contrato ${signature.plan_name} foi assinado. Seus documentos já estão disponíveis.`,
      tipo: "seguro_ativo",
      cor_destaque: "emerald",
      icone: "shield-check",
      link: "/inquilino/documentos",
    });
    await logNotification(supabase, signature.id, "push", { sent: true });
  }

  return dashboardUrl;
}

export async function finalizeD4SignContract(supabase: any, signature: any) {
  if (signature.status === "active") {
    const consulta = await getConsultation(supabase, signature.consultation_id);
    const tenantUserId = signature.tenant_user_id ||
      (await ensureTenantAccount(supabase, consulta));
    const dashboardUrl = await notifyInsuranceActive(
      supabase,
      signature,
      consulta,
      tenantUserId,
    );
    return {
      ok: true,
      alreadyActive: true,
      policyId: signature.policy_id,
      dashboardUrl,
    };
  }
  if (!signature.d4sign_document_uuid) {
    throw new Error("missing_d4sign_document_uuid");
  }

  const consulta = await getConsultation(supabase, signature.consultation_id);
  const tenantUserId = signature.tenant_user_id ||
    (await ensureTenantAccount(supabase, consulta));
  const downloaded = await downloadSignedPdf(signature.d4sign_document_uuid);
  const path =
    `${tenantUserId}/${consulta.id}/${signature.d4sign_document_uuid}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from(SIGNED_CONTRACTS_BUCKET)
    .upload(path, downloaded.bytes, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (uploadError) {
    throw new Error(`signed_contract_upload_error:${uploadError.message}`);
  }

  const policy = await createOrGetPolicy(supabase, consulta);
  const documentPayload = {
    consulta_id: consulta.id,
    apolice_id: policy.id,
    tenant_user_id: tenantUserId,
    contract_signature_id: signature.id,
    file_name: downloaded.name ||
      `Contrato ${signature.plan_name} assinado.pdf`,
    file_url: path,
    file_type: "application/pdf",
    document_type: "contrato",
    document_subtype: SIGNED_CONTRACTS_BUCKET,
  };
  const { data: existingDoc } = await supabase
    .from("documentos_proposta")
    .select("id")
    .eq("contract_signature_id", signature.id)
    .maybeSingle();
  if (existingDoc?.id) {
    await supabase.from("documentos_proposta").update(documentPayload).eq(
      "id",
      existingDoc.id,
    );
  } else {
    const { error } = await supabase.from("documentos_proposta").insert(
      documentPayload,
    );
    if (error) throw new Error(`signed_contract_record_error:${error.message}`);
  }

  const now = new Date().toISOString();
  await supabase
    .from("faturas_inquilino")
    .update({ apolice_id: policy.id, tenant_user_id: tenantUserId })
    .eq("consulta_id", consulta.id);
  await supabase
    .from("consultas_credito")
    .update({
      status: "ativado",
      substatus: "contrato_ativo",
      activation_status: "concluido",
      activation_completed_at: now,
      contract_accepted: true,
      contract_accepted_at: now,
    })
    .eq("id", consulta.id);
  await supabase
    .from("contract_signatures")
    .update({
      policy_id: policy.id,
      tenant_user_id: tenantUserId,
      status: "active",
      signed_at: signature.signed_at || now,
      activated_at: now,
      error_code: null,
      error_message: null,
    })
    .eq("id", signature.id);
  await supabase.from("proposta_historico").insert({
    consulta_id: consulta.id,
    tipo_evento: "contrato_d4sign_assinado",
    descricao:
      `Contrato ${signature.plan_name} assinado na D4Sign e seguro ativado.`,
  });

  const dashboardUrl = await notifyInsuranceActive(
    supabase,
    signature,
    consulta,
    tenantUserId,
  );

  return { ok: true, policyId: policy.id, dashboardUrl };
}

export async function hashWebhookPayload(payload: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
