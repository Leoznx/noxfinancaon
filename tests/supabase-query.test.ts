import assert from "node:assert/strict";
import test from "node:test";
import { executeSupabaseQuery } from "../src/lib/supabase-query.ts";

test("retorna consultas do Supabase que concluem normalmente", async () => {
  const result = await executeSupabaseQuery(
    {
      abortSignal: async () => ({ data: [{ id: "ok" }], error: null }),
    },
    50,
  );
  assert.deepEqual(result.data, [{ id: "ok" }]);
});

test("cancela uma consulta travada em vez de manter a tela carregando", async () => {
  await assert.rejects(
    executeSupabaseQuery(
      {
        abortSignal: (signal) =>
          new Promise((_, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          }),
      },
      10,
    ),
    /demorou mais que o esperado/i,
  );
});
