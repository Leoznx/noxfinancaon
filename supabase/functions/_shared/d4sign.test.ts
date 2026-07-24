import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { strFromU8, unzipSync } from "https://esm.sh/fflate@0.8.2";
import {
  buildContractDocx,
  buildD4SignSendPayload,
  buildD4SignSigner,
  buildInsuranceActiveZApiPayload,
  resolveContractTemplate,
  type TemplateKey,
} from "./d4sign.ts";

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
    assert(documentXml.includes("Pintura interna contratada: R$ 72,00"));
    assert(
      documentXml.includes("R$ 57.000,00") ||
        documentXml.includes("R$ 57.000,00"),
    );
    assertEquals(built.fileName.endsWith(".docx"), true);
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
  assertEquals(signer.skipemail, "0");

  const sendPayload = buildD4SignSendPayload(
    consulta,
    "NOX Up",
    "token-de-teste",
  );
  assertEquals(sendPayload.skip_email, "0");
  assert(sendPayload.message.includes("NOX Up"));
});

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

Deno.test("monta mensagem da Z-API com botão para ativação do seguro", () => {
  const payload = buildInsuranceActiveZApiPayload({
    to: "(11) 99999-8888",
    name: "Maria da Silva",
    planName: "NOX Up",
    dashboardUrl:
      "https://noxfianca.com/acesso-inquilino?type=magiclink&token_hash=hash-seguro-ativo",
  });

  assertEquals(payload.phone, "5511999998888");
  assertEquals(payload.title, "Seguro ativo");
  assert(payload.message.includes("Maria da Silva"));
  assert(payload.message.includes("NOX Up"));
  assertEquals(payload.footer, "NOX Fiança");
  assertEquals(payload.buttonActions, [
    {
      id: "acessar-painel",
      type: "URL",
      label: "Acessar meu painel",
      url:
        "https://noxfianca.com/acesso-inquilino?type=magiclink&token_hash=hash-seguro-ativo",
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
        "https://noxfianca.com/acesso-inquilino?type=magiclink&token_hash=abc",
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
        "http://noxfianca.com/acesso-inquilino?type=magiclink&token_hash=abc",
    })
  );
});
