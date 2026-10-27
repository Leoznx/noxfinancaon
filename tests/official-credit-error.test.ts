import assert from "node:assert/strict";
import test from "node:test";
import { officialCreditErrorMessage } from "../src/lib/official-credit-error.ts";

test("usa a mensagem segura enviada pela Edge Function", async () => {
  const message = await officialCreditErrorMessage({
    message: "Edge Function returned a non-2xx status code",
    context: {
      async json() {
        return { error: "Não foi possível concluir a consulta oficial." };
      },
    },
  });

  assert.equal(message, "Não foi possível concluir a consulta oficial.");
});

test("não expõe mensagens técnicas genéricas do transporte", async () => {
  assert.equal(
    await officialCreditErrorMessage({
      message: "Edge Function returned a non-2xx status code",
    }),
    "Não foi possível concluir a consulta oficial agora. Tente novamente em instantes.",
  );
});

test("preserva erros locais claros", async () => {
  assert.equal(
    await officialCreditErrorMessage({ message: "Sessão expirada. Entre novamente." }),
    "Sessão expirada. Entre novamente.",
  );
});
