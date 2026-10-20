import assert from "node:assert/strict";
import test from "node:test";

import {
  clearSessionResources,
  invalidateSessionResource,
  loadSessionResource,
  peekSessionResource,
} from "../src/lib/session-resource-cache";

test.beforeEach(() => clearSessionResources());

test("deduplica carregamentos simultâneos e reutiliza o valor fresco", async () => {
  let calls = 0;
  const loader = async () => {
    calls += 1;
    return ["dados"];
  };

  const [first, second] = await Promise.all([
    loadSessionResource("consultas:user-1", loader),
    loadSessionResource("consultas:user-1", loader),
  ]);
  const third = await loadSessionResource("consultas:user-1", loader);

  assert.deepEqual(first, ["dados"]);
  assert.equal(second, first);
  assert.equal(third, first);
  assert.equal(calls, 1);
});

test("mantém o último valor disponível enquanto uma atualização falha", async () => {
  await loadSessionResource("apolices:user-1", async () => ["anterior"]);

  await assert.rejects(
    loadSessionResource("apolices:user-1", async () => Promise.reject(new Error("offline")), {
      force: true,
    }),
  );

  assert.deepEqual(peekSessionResource("apolices:user-1"), ["anterior"]);
});

test("invalida todos os recursos de um prefixo", async () => {
  await loadSessionResource("dashboard:user-1:consultas", async () => 1);
  await loadSessionResource("dashboard:user-1:apolices", async () => 2);
  await loadSessionResource("dashboard:user-2:consultas", async () => 3);

  invalidateSessionResource("dashboard:user-1:");

  assert.equal(peekSessionResource("dashboard:user-1:consultas"), undefined);
  assert.equal(peekSessionResource("dashboard:user-1:apolices"), undefined);
  assert.equal(peekSessionResource("dashboard:user-2:consultas"), 3);
});

test("resposta antiga não repõe dados após logout ou invalidação", async () => {
  let resolve!: (value: string[]) => void;
  const pending = loadSessionResource(
    "conta-antiga",
    () =>
      new Promise<string[]>((done) => {
        resolve = done;
      }),
  );
  await Promise.resolve();
  clearSessionResources();
  resolve(["dados privados"]);
  await pending;
  assert.equal(peekSessionResource("conta-antiga"), undefined);
});
