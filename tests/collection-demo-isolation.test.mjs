import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
const root = fileURLToPath(new URL("../", import.meta.url));
const web = existsSync(resolve(root, "src/lib/carteira-cobrancas-data.ts"));
function harness() {
  const calls = [];
  const cache = new Map();
  const mocks = {
    "@/lib/auth-storage": { isDemoAuthStorageActive: () => true },
    "@/lib/demo-session": { isDemoSession: () => true },
    "@/lib/billing-scope": {
      loadBillingScope: async () => null,
      readBillingRows: async (_scope, table) => {
        calls.push(table);
        return [];
      },
    },
    "@/lib/automated-billing": {
      fetchOwnConsolidatedBatches: async () => {
        calls.push("batches");
        return [{ id: "real-fixture-batch" }];
      },
    },
  };
  const actual = new Set([
    "carteira-cobrancas-data",
    "dashboard-navigation-data",
    "session-resource-cache",
    "faturas-inquilino",
    "demo-request-guard",
    "demo-simulation",
    "demo-career",
    "demo-accounts",
  ]);
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    const req = (specifier) => {
      if (mocks[specifier]) return mocks[specifier];
      const path = specifier.startsWith("@/")
        ? resolve(root, "src", specifier.slice(2))
        : resolve(dirname(file), specifier);
      const stem = path.split("/").pop();
      if (actual.has(stem) && existsSync(path + ".ts")) return load(path + ".ts");
      return {};
    };
    vm.runInNewContext(
      compiled,
      {
        module,
        exports: module.exports,
        require: req,
        console,
        Date,
        Map,
        Set,
        Promise,
        setTimeout,
        clearTimeout,
      },
      { filename: file },
    );
    return module.exports;
  }
  const api = load(
    resolve(
      root,
      web ? "src/lib/carteira-cobrancas-data.ts" : "src/lib/dashboard-navigation-data.ts",
    ),
  );
  return { calls, api };
}
test("residual marker cannot populate collection cache with synthetic invoices/batches", async () => {
  const { api, calls } = harness();
  const user = { id: "real-fixture", email: "real@example.invalid", role: "imobiliaria" };
  if (web) {
    assert.equal(api.peekCarteiraCobrancas(user.id, true), undefined);
    const result = await api.loadCarteiraCobrancas(user);
    assert.equal(result.faturas.length, 0);
    assert.equal(result.batches[0].id, "real-fixture-batch");
    assert.equal(api.peekCarteiraCobrancas(user.id, true).batches[0].id, "real-fixture-batch");
  } else {
    assert.equal(api.peekMobileTenantInvoices(user.id), undefined);
    assert.equal(api.peekMobileBillingBatches(user.id), undefined);
    assert.equal((await api.loadMobileTenantInvoices(user)).length, 0);
    assert.equal((await api.loadMobileBillingBatches(user))[0].id, "real-fixture-batch");
  }
  assert.ok(calls.includes("faturas_inquilino"));
  assert.ok(calls.includes("batches"));
});
for (const role of ["proprietario", "corretor", "imobiliaria", "inquilino"])
  test(`${role}: collection loaders refuse operational reads regardless of marker`, () => {
    const { api, calls } = harness();
    const user = { id: "demo-fixture", email: `${role}@nox.com`, role };
    assert.throws(
      () => (web ? api.loadCarteiraCobrancas(user) : api.loadMobileTenantInvoices(user)),
      /bloqueada/,
    );
    assert.throws(
      () => (web ? api.loadCarteiraInvoiceRows(user) : api.loadMobileBillingBatches(user)),
      /bloqueada/,
    );
    assert.equal(calls.length, 0);
  });
