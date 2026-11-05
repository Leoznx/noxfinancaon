import assert from "node:assert/strict";
import test from "node:test";

import {
  canReplacePolicyDocumentOnce,
  policyDocumentLabel,
  policyDocumentReplacementButtonLabel,
  policyDocumentStatus,
} from "../src/lib/policy-document-presentation";

test("apresenta a via NOX como Apólice - NOX e assinada", () => {
  const document = {
    file_url: "user/consulta/apolice.pdf",
    contract_signature_id: "signature-1",
    document_subtype: "assinado_manual",
    replacement_count: 1,
  };

  assert.equal(policyDocumentLabel(document), "Apólice - NOX");
  assert.equal(policyDocumentStatus(document), "assinado");
  assert.equal(canReplacePolicyDocumentOnce(document), false);
});

test("usa estados específicos para contrato, vistoria e documentos enviados", () => {
  assert.equal(
    policyDocumentStatus({ file_url: "contrato.pdf", document_type: "contrato_locacao" }),
    "disponivel",
  );
  assert.equal(
    policyDocumentStatus({ file_url: "vistoria.pdf", document_type: "vistoria_imovel" }),
    "disponivel",
  );
  assert.equal(
    policyDocumentStatus({ file_url: "rg.jpg", document_type: "documento_foto" }),
    "enviado",
  );
  assert.equal(
    policyDocumentStatus({ file_url: "residencia.pdf", document_type: "comprovante_residencia" }),
    "enviado",
  );
  assert.equal(policyDocumentStatus({ file_url: "legado.pdf", tipo: "contrato" }), "disponivel");
});

test("libera exatamente uma substituição para cada documento elegível", () => {
  const document = {
    file_url: "vistoria.pdf",
    document_type: "vistoria_imovel",
    replacement_count: 0,
  };
  assert.equal(canReplacePolicyDocumentOnce(document), true);
  assert.equal(policyDocumentReplacementButtonLabel(document), "Substituir arquivo");
  assert.equal(
    canReplacePolicyDocumentOnce({ ...document, replacement_count: 1 }),
    false,
  );
});

test("apólice pendente aceita somente a via assinada antes da conclusão", () => {
  const document = {
    file_url: "apolice-pendente.pdf",
    contract_signature_id: "signature-1",
    document_subtype: "pendente_assinatura_d4sign",
    replacement_count: 0,
  };
  assert.equal(policyDocumentStatus(document), "aguardando_assinatura");
  assert.equal(canReplacePolicyDocumentOnce(document), true);
  assert.equal(policyDocumentReplacementButtonLabel(document), "Anexar Apólice assinada");
  assert.equal(canReplacePolicyDocumentOnce(document, true), false);
});
