import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
for (const [surface, probe, message] of [
  ["mobile", "rest", "unsupported for mobile"],
  ["mobile", "popup", "unsupported for mobile"],
  ["web", "unknown-control", "Unknown NOX_TEST_TRANSITION_PROBE"],
])
  test(`reject ${surface}/${probe} before Chromium; never pass with no applicable probe`, () => {
    const result = spawnSync(process.execPath, ["scripts/test-demo-boleto-isolation-browser.mjs"], {
      encoding: "utf8",
      timeout: 10000,
      env: {
        ...process.env,
        NOX_DEMO_SURFACE: surface,
        NOX_TEST_TRANSITION_PROBE: probe,
        NOX_TEST_ORIGIN: "http://127.0.0.1:1",
      },
    });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(message), result.stderr);
    assert.doesNotMatch(result.stdout, /PASS/);
    assert.doesNotMatch(result.stderr, /page.goto|browserType.launch/);
  });
