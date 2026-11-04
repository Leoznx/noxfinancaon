// Every probe must be rejected by the browser harness after the SDK switches to demo.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
const output = mkdtempSync(resolve(tmpdir(), "nox-transition-controls-"));
for (const [probe, evidence] of [
  ["local-mutation", "unexpected local mutation POST /must-not-run"],
  ["local-websocket", "unexpected local websocket"],
  ["rest", "GET /rest/v1/faturas_inquilino"],
  ["rpc", "POST /rest/v1/rpc/get_my_owner_dashboard"],
  ["realtime", "unexpected websocket wss://nox-demo-test.supabase.co/realtime/v1/websocket"],
  ["tracking", "external GET https://connect.facebook.net/en_US/fbevents.js"],
  ["popup", "https://unexpected.invalid/popup"],
  ["csp", "https://unexpected.invalid/csp-script"],
  ["before-reload-popup", "https://unexpected.invalid/before-reload"],
]) {
  const result = spawnSync(process.execPath, ["scripts/test-demo-boleto-isolation-browser.mjs"], {
    encoding: "utf8",
    timeout: 90000,
    env: {
      ...process.env,
      NOX_DEMO_SURFACE: "web",
      NOX_TEST_EXTERNAL_PROBE: "",
      NOX_TEST_TRANSITION_PROBE: probe,
    },
  });
  const log = (result.stdout || "") + (result.stderr || "");
  writeFileSync(resolve(output, probe + ".log"), log);
  assert.equal(result.status, 1, `${probe}: expected assertion failure, see ${output}`);
  assert.ok(
    log.includes("AssertionError") && log.includes(evidence),
    `${probe}: missing rejection evidence, see ${output}`,
  );
  console.log(`PASS negative control ${probe}: rejected after transition`);
}
console.log("Evidence:", output);
