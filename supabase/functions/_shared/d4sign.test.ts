import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { strFromU8, unzipSync } from "https://esm.sh/fflate@0.8.2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1?target=deno";
import {
  buildContractDocx,
  buildContractPdf,
  buildD4SignSendPayload,
  buildD4SignSigner,
  buildInsuranceActiveZApiPayload,
  buildSignatureInviteZApiPayload,
  extractD4SignSignerKey,
  resolveContractPropertyOwnerData,
  resolveContractTemplate,
  type TemplateKey,
} from "./d4sign.ts";
import {
  CONTRACT_PDF_INCLUDES_ACCOUNT_SECTION,
  CONTRACT_PDF_INCLUDES_ADMINISTRATOR_SECTION,
  CONTRACT_PDF_INCLUDES_PROPERTY_OWNER_SECTION,
  CONTRACT_PDF_INCLUDES_STATUS_SECTION,
  CONTRACT_PDF_LAYOUT_VERSION,
  CONTRACT_PDF_SIGNATURE_ROLES,
} from "./contract-pdf.ts";

const consulta = {
  id: "11111111-2222-3333-4444-555555555555",
  tenant_name: "Maria da Silva",
  tenant_document: "12345678901",
  tenant_email: "maria@example.com",
  tenant_telefone: "11999998888",
  tenant_data_nascimento: "1990-05-17",
  valor_premio_mensal: 480,
  valor_anual: 5760,
  imovel_subtipo: "Apartamento",
  imovel_endereco: "Rua das Flores",
  imovel_numero: "123",
  imovel_complemento: "Apto 45",
  imovel_bairro: "Centro",
  imovel_cidade: "São Paulo",
  imovel_estado: "SP",
  imovel_cep: "01001000",
  imoveis: {
    valor_aluguel: 1500,
    valor_condominio: 300,
    valor_taxas: 100,
  },
  planos: {
    nome: "NOX Smart",
    cobertura_multiplicador: 30,
  },
  documentos: {
    extras: {
      external_painting_enabled: true,
      external_painting_total: 72,
      activation_fee_enabled: true,
      activation_fee_amount: 200,
    },
  },
  insurance_coverages: ["incendio"],
  insurance_assistance: "assistencia_basica",
  administrador: {
    nome: "Imobiliária Central Ltda.",
    documento: "12345678000199",
    endereco: "Avenida Brasil, 500",
    cidade: "São Paulo",
    estado: "SP",
    cep: "01310100",
    telefone: "1133334444",
    email: "contato@imobiliariacentral.com.br",
  },
  proprietario_locacao: {
    nome: "João da Silva",
    documento: "98765432100",
    endereco: "Rua do Proprietário",
    numero: "310",
    complemento: "Casa 2",
    bairro: "Novo Campinho",
    cidade: "São Paulo",
    estado: "SP",
    cep: "01001000",
  },
};

for (
  const template of [
    "fit",
    "fit_plus",
    "smart",
    "smart_plus",
    "up",
  ] as TemplateKey[]
) {
  Deno.test(`personaliza o contrato ${template}`, async () => {
    const built = await buildContractDocx(template, consulta, "NOX-TESTE-001");
    const archive = unzipSync(built.bytes);
    const documentXml = strFromU8(archive["word/document.xml"]);

    assert(documentXml.includes("NOX-TESTE-001"));
    assert(documentXml.includes("Maria da Silva"));
    assert(documentXml.includes("123.456.789-01"));
    assert(documentXml.includes("maria@example.com"));
    assert(documentXml.includes("Rua das Flores, 123"));
    assert(documentXml.includes("Imobiliária Central Ltda."));
    assert(documentXml.includes("12.345.678/0001-99"));
    assert(documentXml.includes("TAXA DE ADESÃO (SETUP) – R$ 200,00"));
    assert(documentXml.includes("Pintura externa contratada: R$ 72,00"));
    assert(
      documentXml.includes("R$ 57.000,00") ||
        documentXml.includes("R$ 57.000,00"),
    );
    assertEquals(built.fileName.endsWith(".docx"), true);
  });
}

Deno.test("novo layout PDF usa locatário, proprietário e imóvel", () => {
  assertEquals(CONTRACT_PDF_LAYOUT_VERSION, "nox-contract-2026-v4");
  assertEquals(CONTRACT_PDF_INCLUDES_ADMINISTRATOR_SECTION, false);
  assertEquals(CONTRACT_PDF_INCLUDES_ACCOUNT_SECTION, false);
  assertEquals(CONTRACT_PDF_INCLUDES_PROPERTY_OWNER_SECTION, true);
  assertEquals(CONTRACT_PDF_INCLUDES_STATUS_SECTION, false);
  assertEquals(CONTRACT_PDF_SIGNATURE_ROLES, ["tenant"]);
});

Deno.test("monta os dados do proprietário vinculado ao imóvel", () => {
  assertEquals(
    resolveContractPropertyOwnerData({
      proprietario: {
        id: "proprietario-1",
        profile_id: "perfil-1",
        nome: "Gisely Duarte Vidal",
        cpf_cnpj: "07073655623",
        email: "gisely@example.com",
        telefone: "11911112222",
        banco_dados: {
          endereco: {
            logradouro: "Rua Dona Flora Gomes",
            numero: "310",
            complemento: "Casa 02",
            bairro: "Novo Campinho",
            cidade: "Pedro Leopoldo",
            uf: "MG",
            cep: "33254094",
          },
        },
      },
      profile: {
        id: "perfil-1",
        nome: "Gisely Duarte Vidal",
      },
    }),
    {
      id: "proprietario-1",
      profile_id: "perfil-1",
      nome: "Gisely Duarte Vidal",
      documento: "07073655623",
      email: "gisely@example.com",
      telefone: "11911112222",
      endereco: "Rua Dona Flora Gomes",
      numero: "310",
      complemento: "Casa 02",
      bairro: "Novo Campinho",
      cidade: "Pedro Leopoldo",
      estado: "MG",
      cep: "33254094",
    },
  );
});

for (
  const template of [
    "fit",
    "fit_plus",
    "smart",
    "smart_plus",
    "up",
  ] as TemplateKey[]
) {
  Deno.test(`gera contrato PDF estático e preenchido para ${template}`, async () => {
    const planNameByTemplate: Record<TemplateKey, string> = {
      fit: "NOX Fit",
      fit_plus: "NOX Fit+",
      smart: "NOX Smart",
      smart_plus: "NOX Smart+",
      up: "NOX Up",
    };
    const built = await buildContractPdf(
      template,
      {
        ...consulta,
        planos: {
          ...consulta.planos,
          nome: planNameByTemplate[template],
        },
      },
      "NOX-TESTE-001",
    );
    const pdf = await PDFDocument.load(built.bytes);
    assert(pdf.getPageCount() >= 10);
    assertEquals(pdf.getForm().getFields().length, 0);
    assertEquals(built.mimeType, "application/pdf");
    assertEquals(built.fileName.endsWith(".pdf"), true);
    assert(pdf.getTitle()?.includes(planNameByTemplate[template]));
  });
}

const planMappings = [
  ["NOX Fit", "fit", "nox-fit.docx"],
  ["NOX Fit+", "fit_plus", "nox-fit-plus.docx"],
  ["NOX Smart", "smart", "nox-smart.docx"],
  ["NOX Smart+", "smart_plus", "nox-smart-plus.docx"],
  ["NOX Up", "up", "nox-up.docx"],
] as const;

for (const [planName, templateKey, fileName] of planMappings) {
  Deno.test(`${planName} seleciona exclusivamente ${fileName}`, () => {
    assertEquals(resolveContractTemplate(planName), { templateKey, fileName });
  });
}

Deno.test("usa exatamente o e-mail e o telefone do inquilino na D4Sign", () => {
  const signer = buildD4SignSigner({
    ...consulta,
    tenant_email: "  Inquilino@Example.com ",
    tenant_telefone: "(11) 99999-8888",
  });
  assertEquals(signer.email, "inquilino@example.com");
  assertEquals(signer.embed_methodauth, "sms");
  assertEquals(signer.embed_smsnumber, "+5511999998888");
  assertEquals("whatsapp_number" in signer, false);
  assertEquals(signer.skipemail, "0");

  const sendPayload = buildD4SignSendPayload(
    consulta,
    "NOX Up",
    "token-de-teste",
  );
  assertEquals(sendPayload.skip_email, "0");
  assert(sendPayload.message.includes("NOX Up"));
});

Deno.test(
  "mantém o e-mail na D4Sign e envia o mesmo contrato pelo WhatsApp",
  () => {
    const payload = buildSignatureInviteZApiPayload({
      to: "(11) 99999-8888",
      name: "Maria da Silva",
      planName: "NOX Up",
      signatureUrl: "https://secure.d4sign.com.br/w/i/documento/assinatura/123",
    });

    assertEquals(payload, {
      phone: "5511999998888",
      message: "Olá, *Maria da Silva*! 👋\n\n" +
        "• Seu contrato *NOX Up*, da *NOX Fiança*, já está pronto para assinatura. 📝\n\n" +
        "• Abra o link abaixo, confira todas as informações e finalize a assinatura. ✅\n" +
        "https://secure.d4sign.com.br/w/i/documento/assinatura/123\n\n" +
        "*NOX Fiança — segurança e praticidade para o seu aluguel.* 🌙",
      buttonActions: [
        {
          id: "assinar-contrato-d4sign",
          type: "URL",
          label: "Assinar contrato",
          url: "https://secure.d4sign.com.br/w/i/documento/assinatura/123",
        },
      ],
    });
    assertThrows(() =>
      buildSignatureInviteZApiPayload({
        to: "(11) 99999-8888",
        name: "Maria",
        planName: "NOX Up",
        signatureUrl: "https://example.com/contrato",
      })
    );
  },
);

Deno.test(
  "extrai a chave do signatário retornada pelo endpoint list da D4Sign",
  () => {
    assertEquals(
      extractD4SignSignerKey(
        {
          uuidDoc: "documento-teste",
          list: {
            key_signer: "NwYj=",
            email: "leoleosilva04@gmail.com",
          },
        },
        "LEOLEOSILVA04@GMAIL.COM",
      ),
      "NwYj=",
    );
    assertEquals(
      extractD4SignSignerKey(
        {
          data: [
            {
              document: {
                list: [
                  { key_signer: "outro", email: "outro@example.com" },
                  { key_signer: "correto", email: "leoleosilva04@gmail.com" },
                ],
              },
            },
          ],
        },
        "leoleosilva04@gmail.com",
      ),
      "correto",
    );
  },
);

Deno.test("bloqueia envio com e-mail ou telefone inválido", () => {
  assertThrows(() =>
    buildD4SignSigner({ ...consulta, tenant_email: "email-invalido" })
  );
  assertThrows(() =>
    buildD4SignSigner({ ...consulta, tenant_telefone: "12345" })
  );
});

Deno.test("não aceita nome de plano desconhecido", () => {
  assertThrows(() => resolveContractTemplate("NOX Super"));
});

Deno.test("monta mensagem da Z-API com botões para site e aplicativo", () => {
  const payload = buildInsuranceActiveZApiPayload({
    to: "(11) 99999-8888",
    name: "Maria da Silva",
    planName: "NOX Up",
    dashboardUrl:
      "https://noxfianca.com/acesso-inquilino?type=magiclink&token_hash=hash-seguro-ativo&returnTo=%2Finquilino%2Fdocumentos",
  });

  assertEquals(payload.phone, "5511999998888");
  assertEquals(
    payload.message,
    "🎉 Parabéns,seu contrato está ativo!  🌙\n\n" +
      "• Para visualizar seus documentos, acesse a *NOX FIANÇA*:\n" +
      "https://noxfianca.com/acesso-inquilino?type=magiclink&token_hash=hash-seguro-ativo&returnTo=%2Finquilino%2Fdocumentos\n\n" +
      "• Pelo aplicativo, use este acesso:\n" +
      "https://noxfianca.com/abrir-app/documentos?token_hash=hash-seguro-ativo&type=magiclink&returnTo=%2Finquilino%2Fdocumentos",
  );
  assertEquals(payload.buttonActions, [
    {
      id: "ver-documentos-site",
      type: "URL",
      label: "Ver Documentos (Site)",
      url:
        "https://noxfianca.com/acesso-inquilino?type=magiclink&token_hash=hash-seguro-ativo&returnTo=%2Finquilino%2Fdocumentos",
    },
    {
      id: "ver-documentos-aplicativo",
      type: "URL",
      label: "Ver Documentos (Aplicativo)",
      url:
        "https://noxfianca.com/abrir-app/documentos?token_hash=hash-seguro-ativo&type=magiclink&returnTo=%2Finquilino%2Fdocumentos",
    },
  ]);
});

Deno.test("conta existente recebe links diretos para documentos", () => {
  const payload = buildInsuranceActiveZApiPayload({
    to: "(11) 99999-8888",
    name: "Maria da Silva",
    planName: "NOX Up",
    dashboardUrl: "https://noxfianca.com/inquilino/documentos",
  });

  assertEquals(payload.buttonActions, [
    {
      id: "ver-documentos-site",
      type: "URL",
      label: "Ver Documentos (Site)",
      url: "https://noxfianca.com/inquilino/documentos",
    },
    {
      id: "ver-documentos-aplicativo",
      type: "URL",
      label: "Ver Documentos (Aplicativo)",
      url:
        "https://noxfianca.com/abrir-app/documentos?returnTo=%2Finquilino%2Fdocumentos",
    },
  ]);
});

Deno.test("bloqueia WhatsApp sem destinatário ou acesso individual", () => {
  assertThrows(() =>
    buildInsuranceActiveZApiPayload({
      to: "12345",
      name: "Maria",
      planName: "NOX Fit",
      dashboardUrl:
        "https://noxfianca.com/acesso-inquilino?type=magiclink&token_hash=abc&returnTo=%2Finquilino%2Fdocumentos",
    })
  );
  assertThrows(() =>
    buildInsuranceActiveZApiPayload({
      to: "(11) 99999-8888",
      name: "Maria",
      planName: "NOX Fit",
      dashboardUrl: "https://noxfianca.com/login",
    })
  );
  assertThrows(() =>
    buildInsuranceActiveZApiPayload({
      to: "(11) 99999-8888",
      name: "Maria",
      planName: "NOX Fit",
      dashboardUrl:
        "http://noxfianca.com/acesso-inquilino?type=magiclink&token_hash=abc&returnTo=%2Finquilino%2Fdocumentos",
    })
  );
  assertThrows(() =>
    buildInsuranceActiveZApiPayload({
      to: "(11) 99999-8888",
      name: "Maria",
      planName: "NOX Fit",
      dashboardUrl:
        "https://noxfianca.com/acesso-inquilino?type=magiclink&token_hash=abc&returnTo=%2Finquilino%2Fpainel",
    })
  );
});
