import assert from "node:assert/strict";
import test from "node:test";

import {
  getEdgeFunctionErrorDetails,
  getEdgeFunctionErrorMessage,
  isEdgeFunctionNetworkError,
} from "../src/lib/asaas-payment";

test("exibe o erro util devolvido pela Edge Function", async () => {
  const error = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    context: new Response(JSON.stringify({ error: "O valor do pagamento mudou." }), {
      headers: { "content-type": "application/json" },
      status: 409,
    }),
  });

  assert.equal(
    await getEdgeFunctionErrorMessage(error, "Falha no pagamento."),
    "O valor do pagamento mudou.",
  );
});

test("preserva a mensagem de rede quando nao ha resposta JSON", async () => {
  const error = new Error("Falha de conexao com o gateway.");

  assert.equal(
    await getEdgeFunctionErrorMessage(error, "Falha no pagamento."),
    "Falha de conexao com o gateway.",
  );
});

test("identifica desconexao da Edge Function e oculta a mensagem tecnica", async () => {
  const error = new Error("Failed to send a request to the Edge Function");

  assert.equal(isEdgeFunctionNetworkError(error), true);
  assert.equal(
    await getEdgeFunctionErrorMessage(error, "Nao foi possivel gerar o pagamento agora."),
    "Nao foi possivel gerar o pagamento agora.",
  );
});

test("diferencia erro HTTP devolvido pela Edge Function", () => {
  const error = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    context: new Response(JSON.stringify({ error: "Acesso nao autorizado." }), { status: 403 }),
  });

  assert.equal(isEdgeFunctionNetworkError(error), false);
});

test("usa uma mensagem segura para erros desconhecidos", async () => {
  assert.equal(
    await getEdgeFunctionErrorMessage(null, "Falha no pagamento."),
    "Falha no pagamento.",
  );
});

test("expoe o valor esperado quando o backend recusa por divergencia de valor", async () => {
  const error = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    context: new Response(
      JSON.stringify({ error: "O valor do pagamento mudou.", expectedAmount: 412.35 }),
      { headers: { "content-type": "application/json" }, status: 409 },
    ),
  });

  const detalhes = await getEdgeFunctionErrorDetails(error, "Falha no pagamento.");
  assert.equal(detalhes.status, 409);
  assert.equal(detalhes.message, "O valor do pagamento mudou.");
  assert.equal(detalhes.payload?.expectedAmount, 412.35);
});

test("cai no fallback quando a resposta nao traz payload utilizavel", async () => {
  const detalhes = await getEdgeFunctionErrorDetails({}, "Falha no pagamento.");
  assert.equal(detalhes.message, "Falha no pagamento.");
  assert.equal(detalhes.payload, null);
  assert.equal(detalhes.status, null);
});
