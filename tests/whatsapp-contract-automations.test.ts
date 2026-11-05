import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildAdminCreditReviewContent,
  buildRequesterDecisionMessage,
  parseAdminCreditReviewAction,
  safePdfFileName,
} from "../supabase/functions/_shared/whatsapp-contract-automations";

const consultationId = "4d59ac2f-b3dc-4f87-9d89-bc1e6e404d31";

test("monta avaliação administrativa com nome, aluguel e dois botões de resposta", () => {
  const content = buildAdminCreditReviewContent({
    consultationId,
    tenantName: "Ana Beatriz de Souza",
    rentValue: 2450.5,
  });
  assert.match(content.message, /Ana Beatriz de Souza/);
  assert.match(content.message, /R\$\s*2\.450,50/);
  assert.deepEqual(
    content.buttonActions.map((button) => [button.type, button.label, button.id]),
    [
      ["REPLY", "Reprovar", `nox-review:recusado:${consultationId}`],
      ["REPLY", "Aprovar", `nox-review:aprovado:${consultationId}`],
    ],
  );
});

test("interpreta somente clique individual recebido no botão administrativo", () => {
  assert.deepEqual(
    parseAdminCreditReviewAction({
      type: "ReceivedCallback",
      fromMe: false,
      isGroup: false,
      phone: "5547999614166",
      messageId: "incoming-1",
      referenceMessageId: "outgoing-1",
      buttonsResponseMessage: {
        buttonId: `nox-review:aprovado:${consultationId}`,
        message: "Aprovar",
      },
    }),
    {
      consultationId,
      decision: "aprovado",
      providerMessageId: "incoming-1",
      referenceMessageId: "outgoing-1",
    },
  );
  assert.equal(
    parseAdminCreditReviewAction({
      type: "ReceivedCallback",
      fromMe: false,
      isGroup: true,
      buttonsResponseMessage: { buttonId: `nox-review:recusado:${consultationId}` },
    }),
    null,
  );
});

test("mensagem ao solicitante contém somente dados do contrato e status, sem botão", () => {
  const message = buildRequesterDecisionMessage({
    tenantName: "João da Silva",
    rentValue: 1800,
    decision: "recusado",
  });
  assert.equal(
    message,
    "Inquilino: João da Silva\nValor do aluguel: R$ 1.800,00\nStatus: RECUSADO",
  );
  assert.doesNotMatch(message, /https?:|botão|motivo/i);
});

test("normaliza nomes seguros dos PDFs", () => {
  assert.equal(safePdfFileName("Score - José / teste", "score"), "Score-Jose-teste.pdf");
});

test("migração limita o follow-up a três dias sem uso e protege a decisão via WhatsApp", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20261105213000_whatsapp_contract_automations.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /record_platform_activity/);
  assert.match(migration, /last_activity_at <= p_now - interval '3 days'/);
  assert.match(migration, /user_active_again/);
  assert.match(migration, /documentacao_complementar_enviada/);
  assert.match(migration, /resolve_admin_credit_review_via_whatsapp/);
  assert.match(migration, /v_sender_phone IS DISTINCT FROM v_expected_phone/);
  assert.match(migration, /5547999614166/);
});

test("ativação envia mensagem de pagamento e assinatura e anexa a apólice em PDF", () => {
  const d4sign = readFileSync(
    new URL("../supabase/functions/_shared/d4sign.ts", import.meta.url),
    "utf8",
  );
  assert.match(d4sign, /Pagamento e assinatura confirmados!/);
  assert.match(d4sign, /insurance_active_pdf/);
  assert.match(d4sign, /sendSignedPolicyPdfWhatsapp/);
  assert.match(d4sign, /Apolice-NOX-assinada-/);
});
