// Instrument only a disposable copy. No test bridge is added to the app sources.
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
const source = resolve(process.env.NOX_MOBILE_CHECKOUT || "../noxfinancaonmobile");
const root = mkdtempSync(resolve(tmpdir(), "nox-demo-instrumented-"));
const output = resolve(process.env.NOX_MOBILE_TEST_EXPORT || "/tmp/nox-demo-instrumented-export");
const files = execFileSync("git", ["ls-files", "-z"], { cwd: source, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
for (const file of files) {
  const target = resolve(root, file);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(resolve(source, file), target);
}
symlinkSync(resolve(source, "node_modules"), resolve(root, "node_modules"), "dir");
const storage = resolve(root, "src/lib/auth-storage.ts");
writeFileSync(
  storage,
  readFileSync(storage, "utf8") +
    `
// TEST ONLY: this copy is discarded after local verification.
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  const fixture = (globalThis as any).__NOX_DEMO_TEST_BOOTSTRAP__;
  if (fixture?.marker) {
    beginDemoAuthStorage();
    void dynamicAuthStorage.setItem('sb-nox-demo-test-auth-token', fixture.session);
  }
  (globalThis as any).__NOX_DEMO_TEST_STORAGE__ = {
    isActive: isDemoAuthStorageActive,
    readSession: () => dynamicAuthStorage.getItem('sb-nox-demo-test-auth-token'),
  };
}
`,
);
console.log("Disposable instrumented checkout:", root);
execFileSync(
  process.execPath,
  [
    resolve(root, "node_modules/expo/bin/cli"),
    "export",
    "--platform",
    "web",
    "--output-dir",
    output,
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      EXPO_NO_TELEMETRY: "1",
      EXPO_OFFLINE: "1",
      EXPO_PUBLIC_SUPABASE_URL: "https://nox-demo-test.supabase.co",
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-public-key",
    },
  },
);
console.log("Test-only export:", output);
