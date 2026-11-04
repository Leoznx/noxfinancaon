import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
const root = fileURLToPath(new URL("../", import.meta.url));
const mobile = existsSync(resolve(root, "src/lib/commissions.ts"));
function harness() {
  const calls = [],
    modules = new Map();
  const financial = { available_cents: 76543 };
  const query = (name, value) => async () => {
    calls.push(name);
    return mobile ? { data: value, error: null } : value;
  };
  const billing = {
    getFinancialSummary: query("summary", financial),
    getUserFinancialSummary: query("summary", financial),
    getMyCommissions: query("commissions", [{ id: "real-fixture" }]),
    getMyWithdrawals: query("withdrawals", []),
    getMyCommissionContracts: query("contracts", []),
  };
  const mocks = {
    "@/lib/demo-session": { isDemoSession: () => true },
    "@/lib/auth-storage": { isDemoAuthStorageActive: () => true },
    "@/lib/commissions": billing,
    "@/lib/withdrawals": billing,
    "@/lib/niveis-parceria": { fetchNivelInfo: async () => null },
  };
  const actual = new Set([
    "dashboard-navigation-data",
    "session-resource-cache",
    "demo-request-guard",
    "demo-simulation",
    "demo-accounts",
    "demo-career",
  ]);
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const require = (name) => {
      if (mocks[name]) return mocks[name];
      const path = name.startsWith("@/")
        ? resolve(root, "src", name.slice(2))
        : resolve(dirname(file), name);
      return actual.has(path.split("/").pop()) && existsSync(path + ".ts")
        ? load(path + ".ts")
        : {};
    };
    vm.runInNewContext(
      ts.transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      { module, exports: module.exports, require, Date, Map, Set, Promise },
      { filename: file },
    );
    return module.exports;
  }
  const api = load(resolve(root, "src/lib/dashboard-navigation-data.ts"));
  return {
    calls,
    peek: mobile ? api.peekMobileCommissions : api.peekCommissionDashboard,
    load: mobile ? api.loadMobileCommissions : api.loadCommissionDashboard,
  };
}
test("real residual marker keeps operational data and identity-partitioned cache", async () => {
  const api = harness();
  const real = { id: "shared-id", email: "real@example.invalid", role: "proprietario" };
  assert.equal(api.peek(real), undefined);
  const first = await api.load(real);
  assert.equal(first.summary.available_cents, 76543);
  assert.equal(first.commissions[0].id, "real-fixture");
  assert.ok(api.calls.length >= 3);
  assert.equal(api.peek({ ...real, email: "another@example.invalid" }), undefined);
  assert.equal(api.peek({ ...real, id: "different-id" }), undefined);
  const calls = api.calls.length;
  assert.equal(await api.load(real), first);
  assert.equal(api.calls.length, calls);
});
for (const role of ["corretor", "imobiliaria", "proprietario", "inquilino"])
  test(`${role}: operational commission loader and cache are denied even with real data cached`, async () => {
    const api = harness();
    const real = { id: "shared-id", email: "real@example.invalid", role };
    await api.load(real);
    const calls = api.calls.length;
    const demo = { ...real, email: `${role}@nox.com` };
    assert.throws(() => api.peek(demo), /bloqueada/);
    await assert.rejects(
      Promise.resolve().then(() => api.load(demo)),
      /bloqueada/,
    );
    assert.equal(api.calls.length, calls);
    assert.equal(api.peek(real).summary.available_cents, 76543);
  });
