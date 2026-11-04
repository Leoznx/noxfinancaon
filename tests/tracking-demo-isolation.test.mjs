import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import vm from "node:vm";
import ts from "typescript";
function harness({ consent = false, path = "/carteira-cobrancas" } = {}) {
  const modules = new Map(),
    scripts = [],
    google = [],
    meta = [];
  let reloads = 0;
  const consentCommand = [
    "consent",
    "default",
    { ad_storage: "denied", analytics_storage: "denied" },
  ];
  const window = {
    location: {
      pathname: path,
      href: "https://local.invalid" + path,
      reload() {
        reloads++;
      },
    },
    dataLayer: consent ? [consentCommand] : [],
    gtag: (...args) => google.push(args),
    fbq: (...args) => meta.push(args),
  };
  const document = {
    title: "Fixture",
    head: {
      appendChild(script) {
        scripts.push(script.src);
      },
    },
    createElement() {
      return {};
    },
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const require = (name) => load(resolve(dirname(file), name) + ".ts");
    vm.runInNewContext(
      ts.transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      { module, exports: module.exports, require, window, document, Date },
      { filename: file },
    );
    return module.exports;
  }
  return {
    api: load(resolve("src/lib/tracking.ts")),
    window,
    scripts,
    google,
    meta,
    consentCommand,
    reloads: () => reloads,
  };
}
for (const role of ["proprietario", "corretor", "imobiliaria", "inquilino"])
  test(`${role}: unresolved/demo identity emits no script or event`, () => {
    const h = harness();
    assert.equal(h.api.initializeTracking(), false);
    h.api.trackCadastroConcluido();
    assert.equal(h.google.length, 0);
    h.api.syncTrackingSession(`${role}@nox.com`);
    assert.equal(h.api.initializeTracking(), false);
    h.api.trackPageView();
    h.api.trackCadastroConcluido();
    assert.equal(h.scripts.length, 0);
    assert.equal(h.google.length, 0);
    assert.equal(h.meta.length, 0);
    assert.equal(h.reloads(), 0);
  });
test("real identity retains initialization, conversion and pre-existing consent queue", () => {
  const h = harness({ consent: true });
  const google = h.window.gtag,
    meta = h.window.fbq;
  h.api.syncTrackingSession("real@example.invalid");
  assert.equal(h.api.initializeTracking(), true);
  assert.equal(h.api.initializeTracking(), false);
  assert.equal(h.scripts.length, 2);
  assert.equal(h.window.gtag, google);
  assert.equal(h.window.fbq, meta);
  assert.equal(h.window.dataLayer[0], h.consentCommand);
  h.api.trackCadastroConcluido();
  assert.ok(h.google.some((args) => args[0] === "event" && args[1] === "conversion"));
  assert.ok(h.meta.some((args) => args[1] === "CompleteRegistration"));
  assert.ok(!h.google.some((args) => args[0] === "consent"));
});
test("real-to-demo discards loaded SDK document once and stops event forwarding", () => {
  const h = harness();
  h.api.syncTrackingSession("real@example.invalid");
  h.api.initializeTracking();
  const before = [h.google.length, h.meta.length, h.scripts.length];
  h.api.syncTrackingSession("inquilino@nox.com");
  h.api.trackPageView();
  h.api.trackCadastroConcluido();
  h.api.syncTrackingSession("inquilino@nox.com");
  assert.deepEqual([h.google.length, h.meta.length, h.scripts.length], before);
  assert.equal(h.reloads(), 1);
});
test("demo entry route never loads tracking even when restoring a real session", () => {
  const h = harness({ path: "/demo/corretor" });
  h.api.syncTrackingSession("real@example.invalid");
  assert.equal(h.api.initializeTracking(), false);
  h.api.trackPageView();
  assert.equal(h.scripts.length, 0);
  assert.equal(h.google.length, 0);
});
