import assert from "node:assert/strict";
import test from "node:test";
import {
  createWarmupQueue,
  resetNavigationWarmup,
  warmNavigationRoutes,
} from "../src/lib/navigation-warmup.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("navegações repetidas não repetem consultas e respeitam a concorrência", async () => {
  const queue = createWarmupQueue(1);
  const calls: string[] = [];
  let release!: () => void;
  const first = queue.enqueue("dashboard", async () => {
    calls.push("dashboard");
    await new Promise<void>((done) => {
      release = done;
    });
  });
  const second = queue.enqueue("faturas", async () => {
    calls.push("faturas");
  });
  await tick();
  assert.deepEqual(calls, ["dashboard"]);
  assert.equal(
    queue.enqueue("faturas", async () => {
      throw new Error("duplicada");
    }),
    second,
  );
  release();
  await Promise.all([first, second]);
  await queue.enqueue("faturas", async () => {
    throw new Error("não deve repetir ao remontar");
  });
  assert.deepEqual(calls, ["dashboard", "faturas"]);
});

test("a próxima aba escolhida passa à frente das buscas de fundo", async () => {
  const queue = createWarmupQueue(1);
  const calls: string[] = [];
  let release!: () => void;
  const first = queue.enqueue(
    "dashboard",
    () =>
      new Promise<void>((done) => {
        release = done;
      }),
  );
  const policies = queue.enqueue("contratos", async () => {
    calls.push("contratos");
  });
  const invoices = queue.enqueue("faturas", async () => {
    calls.push("faturas");
  });
  await tick();
  void queue.enqueue("faturas", async () => {}, true);
  release();
  await Promise.all([first, policies, invoices]);
  assert.deepEqual(calls, ["faturas", "contratos"]);
});

test("sair da conta cancela tarefas pendentes sem reviver a fila antiga", async () => {
  const queue = createWarmupQueue(1);
  let release!: () => void;
  const calls: string[] = [];
  const old = queue.enqueue(
    "antiga",
    () =>
      new Promise<void>((done) => {
        release = done;
      }),
  );
  const pending = queue.enqueue("pendente", async () => {
    calls.push("antiga");
  });
  await tick();
  queue.reset();
  await queue.enqueue("nova", async () => {
    calls.push("nova");
  });
  release();
  await Promise.all([old, pending]);
  assert.deepEqual(calls, ["nova"]);
});

test("dados começam antes do download das rotas terminar e não reiniciam na navegação", async () => {
  resetNavigationWarmup();
  const dataCalls: string[] = [];
  const releaseCode: Array<() => void> = [];
  const options = {
    scope: "conta:corretor",
    hrefs: ["/faturas-inquilinos", "/dashboard"],
    currentHref: "/dashboard/",
    preloadCode: () =>
      new Promise<void>((done) => {
        releaseCode.push(done);
      }),
    loadData: async (href: string) => {
      dataCalls.push(href);
    },
  };
  warmNavigationRoutes(options);
  await tick();
  assert.deepEqual(dataCalls, ["/dashboard", "/faturas-inquilinos"]);
  warmNavigationRoutes({ ...options, currentHref: "/faturas-inquilinos" });
  await tick();
  assert.equal(dataCalls.length, 2);
  releaseCode.forEach((release) => release());
  resetNavigationWarmup();
});

test("permite aquecer o código de todas as rotas sem buscar dados de abas ocultas", async () => {
  resetNavigationWarmup();
  const codeCalls: string[] = [];
  const dataCalls: string[] = [];
  warmNavigationRoutes({
    scope: "conta:imobiliaria",
    hrefs: ["/dashboard", "/consultas", "/carteira-cobrancas"],
    dataHrefs: ["/dashboard"],
    currentHref: "/dashboard",
    preloadCode: async (href) => void codeCalls.push(href),
    loadData: async (href) => void dataCalls.push(href),
  });
  await tick();
  assert.deepEqual(dataCalls, ["/dashboard"]);
  assert.deepEqual(codeCalls.sort(), ["/carteira-cobrancas", "/consultas", "/dashboard"]);
  resetNavigationWarmup();
});
