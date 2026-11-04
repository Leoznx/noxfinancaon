import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = readFileSync(new URL("../src/lib/demo-commissions.ts", import.meta.url), "utf8");
const module = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  { module, exports: module.exports },
);
const api = module.exports;
test("15 unique visibly synthetic contracts and consistent balance", () => {
  assert.equal(api.demoCommissionContracts.length, 15);
  assert.equal(new Set(api.demoCommissionContracts.map((item) => item.number)).size, 15);
  assert.ok(api.demoCommissionContracts.every((item) => /^DEMO-2026-\d{6}$/.test(item.number)));
  assert.equal(api.demoCommissionTotal, 150000);
  assert.deepEqual([...api.demoCommissionRoles], ["corretor", "imobiliaria", "proprietario"]);
});
test("withdrawal requires exactly the three predefined synthetic values", () => {
  assert.throws(
    () => api.confirmDemoWithdrawal(api.startDemoWithdrawal(), api.emptyDemoWithdrawalSelection()),
    /fictícios/,
  );
  for (const key of ["pix", "holder", "bank"])
    assert.throws(
      () =>
        api.confirmDemoWithdrawal(api.startDemoWithdrawal(), {
          ...api.demoWithdrawalFields,
          [key]: "unexpected-personal-input",
        }),
      /fictícios/,
    );
  assert.match(api.demoWithdrawalFields.pix, /@example\.invalid$/);
});
test("local completion is idempotent and restart discards it", () => {
  const start = api.startDemoWithdrawal();
  const end = api.confirmDemoWithdrawal(start, api.demoWithdrawalFields);
  assert.equal(end.availableCents, 0);
  assert.equal(end.withdrawnCents, 150000);
  assert.equal(start.availableCents, 150000);
  assert.equal(api.confirmDemoWithdrawal(end, api.demoWithdrawalFields), end);
  assert.equal(api.startDemoWithdrawal().completed, false);
  assert.equal("pix" in end, false);
  assert.equal("holder" in end, false);
  assert.equal("bank" in end, false);
});
test("domain has no integration, storage or user-data adapter", () =>
  assert.doesNotMatch(source, /\b(import|fetch|supabase|localStorage|AsyncStorage|sendBeacon)\b/));
