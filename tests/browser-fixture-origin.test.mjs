import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { validateFixtureOrigin } from "../scripts/demo-browser-fixture-origin.mjs";
test("accepts only explicit HTTP loopback fixture origins and removes localhost DNS resolution", () => {
  assert.equal(validateFixtureOrigin("http://127.0.0.1:4173"), "http://127.0.0.1:4173");
  assert.equal(validateFixtureOrigin("http://localhost:4173/"), "http://127.0.0.1:4173");
  assert.equal(validateFixtureOrigin("http://[::1]:4173"), "http://[::1]:4173");
});
for (const origin of [
  "https://example.com:443",
  "http://example.com:4173",
  "http://127.0.0.1.example.com:4173",
  "http://192.168.1.1:4173",
  "http://0.0.0.0:4173",
  "https://127.0.0.1:4173",
  "http://127.0.0.1",
  "http://user:pass@127.0.0.1:4173",
  "http://127.0.0.1:4173/path",
  "http://127.0.0.1:4173?target=remote",
  "http://127.0.0.1:4173#fragment",
])
  test(`rejects ${origin}`, () =>
    assert.throws(() => validateFixtureOrigin(origin), /loopback fixture origin/));
test("browser command rejects a remote origin before starting Chromium", () => {
  const result = spawnSync(process.execPath, ["scripts/test-demo-boleto-isolation-browser.mjs"], {
    encoding: "utf8",
    timeout: 10000,
    env: { ...process.env, NOX_TEST_ORIGIN: "https://example.invalid:4173" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /loopback fixture origin/);
  assert.doesNotMatch(result.stderr, /page.goto|browserType.launch/);
});
