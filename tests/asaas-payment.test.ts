import assert from "node:assert/strict";
import test from "node:test";

import { getEdgeFunctionErrorMessage } from "../src/lib/asaas-payment";

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

test("usa uma mensagem segura para erros desconhecidos", async () => {
  assert.equal(
    await getEdgeFunctionErrorMessage(null, "Falha no pagamento."),
    "Falha no pagamento.",
  );
});
