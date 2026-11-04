import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import vm from "node:vm";
import ts from "typescript";
function harness() {
  const modules = new Map();
  const calls = [];
  let release;
  let pending = false;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const supabase = {
    from(table) {
      calls.push(table);
      const query = new Proxy(
        {},
        {
          get(_target, property) {
            if (property === "then")
              return async (resolve) => {
                if (pending) await gate;
                resolve({ data: table === "profiles" ? {} : [], error: null });
              };
            return () => query;
          },
        },
      );
      return query;
    },
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const require = (specifier) => {
      if (specifier === "@/integrations/supabase/client") return { supabase };
      if (specifier === "@/lib/tenant-billing") return { mergeTenantBillingItems: () => [] };
      return load(
        (specifier.startsWith("@/")
          ? resolve("src", specifier.slice(2))
          : resolve(dirname(file), specifier)) + ".ts",
      );
    };
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(
      code,
      { module, exports: module.exports, require, Date, Map, Promise, console },
      { filename: file },
    );
    return module.exports;
  }
  return {
    api: load(resolve("src/lib/tenant-dashboard.ts")),
    cache: load(resolve("src/lib/session-resource-cache.ts")),
    calls,
    hold() {
      pending = true;
    },
    release,
  };
}
for (const role of ["proprietario", "corretor", "imobiliaria", "inquilino"])
  test(`${role}: cached real dashboard cannot bypass demo denial`, async () => {
    const { api, calls } = harness();
    const real = await api.loadTenantDashboard("same-id", "real@example.invalid");
    assert.equal(api.peekTenantDashboard("same-id", "real@example.invalid"), real);
    const count = calls.length;
    assert.throws(() => api.loadTenantDashboard("same-id", `${role}@nox.com`), /bloqueada/);
    assert.throws(() => api.peekTenantDashboard("same-id", `${role}@nox.com`), /bloqueada/);
    assert.equal(calls.length, count);
    assert.equal(await api.loadTenantDashboard("same-id", "real@example.invalid"), real);
  });
test("identity changes cannot reuse another email, user id or legacy demo cache", async () => {
  const { api, cache } = harness();
  await cache.loadSessionResource("dashboard:inquilino:same-id", async () => ({
    tenantName: "legacy-demo-fixture",
  }));
  const first = await api.loadTenantDashboard("same-id", "first@example.invalid");
  assert.equal(first.tenantName, "first@example.invalid");
  assert.equal(api.peekTenantDashboard("same-id", "second@example.invalid"), undefined);
  assert.equal(api.peekTenantDashboard("other-id", "first@example.invalid"), undefined);
  const second = await api.loadTenantDashboard("same-id", "second@example.invalid");
  assert.equal(second.tenantName, "second@example.invalid");
  assert.notEqual(first, second);
  assert.equal(api.peekTenantDashboard("same-id", "first@example.invalid"), first);
  assert.throws(() => api.peekTenantDashboard("same-id"), /Identidade/);
  assert.throws(() => api.loadTenantDashboard("same-id"), /Identidade/);
});
test("in-flight real request cannot be reused by demo; cleared request cannot repopulate cache", async () => {
  const { api, cache, hold, release } = harness();
  hold();
  const pending = api.loadTenantDashboard("same-id", "real@example.invalid");
  assert.throws(() => api.loadTenantDashboard("same-id", "inquilino@nox.com"), /bloqueada/);
  cache.clearSessionResources();
  release();
  await pending;
  assert.equal(api.peekTenantDashboard("same-id", "real@example.invalid"), undefined);
});
