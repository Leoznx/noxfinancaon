import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import {
  createDemoRequestGuard,
  demoEmailFromBearer,
  assertNonDemoOperation,
} from "../src/lib/demo-request-guard.ts";

const url = "https://demo-backend.invalid";
const jwt = (email) =>
  [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(
      JSON.stringify({
        sub: "11111111-1111-4111-8111-111111111111",
        email,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url"),
    Buffer.from("test-only-signature").toString("base64url"),
  ].join(".");
function setup(initialEmail) {
  let email = initialEmail;
  const calls = [];
  const guard = createDemoRequestGuard(async (input, init) => {
    const path = new URL(typeof input === "object" && "url" in input ? input.url : String(input))
      .pathname;
    calls.push({ path, method: init?.method || "GET" });
    const data =
      path === "/auth/v1/user"
        ? {
            id: "11111111-1111-4111-8111-111111111111",
            email,
            role: "authenticated",
            app_metadata: {},
            user_metadata: {},
          }
        : [];
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  const client = createClient(url, "test-public-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: guard.fetch },
  });
  client.auth.onAuthStateChange((_event, session) => guard.setSessionEmail(session?.user.email));
  return {
    guard,
    client,
    calls,
    setEmail(value) {
      email = value;
    },
    async signIn(value = email) {
      email = value;
      const result = await client.auth.setSession({
        access_token: jwt(email),
        refresh_token: "test-only-refresh",
      });
      assert.equal(result.error, null);
      calls.length = 0;
    },
  };
}
for (const role of ["proprietario", "corretor", "imobiliaria", "inquilino"]) {
  test(`${role}: real SDK blocks all mutation/integration families before fetch`, async () => {
    const { client, calls, signIn } = setup(`${role}@nox.com`);
    await signIn();
    const operations = [
      () => client.from("consultas_credito").insert({ id: "synthetic" }),
      () => client.from("consultas_credito").update({ status: "aprovado" }).eq("id", "synthetic"),
      () => client.from("consultas_credito").delete().eq("id", "synthetic"),
      () => client.from("notificacoes").update({ lida: true }).eq("id", "synthetic"),
      () => client.from("notification_preferences").upsert({ canal_app: true }),
      () => client.auth.updateUser({ password: "never-change-password" }),
      () => client.rpc("enqueue_official_credit_simulation", {}),
      () => client.rpc("side_effect_even_with_get", {}, { get: true }),
      () => client.functions.invoke("contract-document", { body: { policyId: "synthetic" } }),
      () =>
        client.functions.invoke("d4sign-create-contract", {
          body: { consultationId: "synthetic" },
        }),
      () =>
        client.functions.invoke("asaas-create-payment", { body: { consultationId: "synthetic" } }),
      () => client.functions.invoke("account-access", { body: { action: "signup" } }),
      () => client.storage.from("documents").upload("synthetic.txt", new Blob(["synthetic"])),
      () => client.storage.from("documents").createSignedUrl("synthetic.txt", 60),
      () => client.auth.updateUser({ email: "never-send@example.invalid" }),
      () =>
        client.auth.signUp({
          email: "never-create@example.invalid",
          password: "test-only-password",
        }),
      () => client.auth.resetPasswordForEmail("never-send@example.invalid"),
      () => client.auth.resend({ type: "signup", email: "never-send@example.invalid" }),
    ];
    for (const operation of operations) {
      const response = await operation();
      assert.ok(response.error, "operation must fail closed");
      assert.equal(calls.length, 0, "no upstream call is permitted");
    }
    assert.equal((await client.from("profiles").select("role").eq("id", "synthetic")).error, null);
    assert.equal(calls.length, 1, "identity read remains usable");
  });
}
test("real account and residual marker preserve the real SDK request; switching identities clears demo guard", async () => {
  const context = setup("corretor@nox.com");
  await context.signIn();
  await context.signIn("real@example.invalid");
  // The guard deliberately has no storage API or marker input.
  globalThis.sessionStorage = { getItem: () => "corretor" };
  try {
    assert.equal(
      (await context.client.from("consultas_credito").update({ status: "test" }).eq("id", "test"))
        .error,
      null,
    );
    assert.equal(context.calls.length, 1);
    assert.equal(context.calls[0].method, "PATCH");
  } finally {
    delete globalThis.sessionStorage;
  }
});
test("bearer fallback protects queued/initial requests before session observer, independent of active identity", async () => {
  const { guard, calls } = setup("real@example.invalid");
  for (const role of ["proprietario", "corretor", "imobiliaria", "inquilino"]) {
    const input = new Request(url + "/functions/v1/contract-document", {
      method: "POST",
      headers: { Authorization: "Bearer " + jwt(`${role}@nox.com`) },
    });
    assert.equal((await guard.fetch(input)).status, 403);
  }
  assert.equal(calls.length, 0);
});
test("auth lifecycle allowlist, Request override and malformed bearer behavior", async () => {
  const { guard, calls } = setup("corretor@nox.com");
  guard.setSessionEmail("corretor@nox.com");
  for (const path of ["/auth/v1/token", "/auth/v1/logout"])
    assert.equal((await guard.fetch(url + path, { method: "POST" })).status, 200);
  assert.equal(calls.length, 2);
  const input = new Request(url + "/rest/v1/profiles", { method: "GET" });
  assert.equal((await guard.fetch(input, { method: "PATCH" })).status, 403);
  assert.equal(calls.length, 2);
  assert.equal(demoEmailFromBearer("Bearer invalid"), undefined);
  assert.equal(demoEmailFromBearer("Bearer x.!invalid.x"), undefined);
});
test("server-function client veto never grants authorization using decoded bearer or marker", () => {
  for (const role of ["proprietario", "corretor", "imobiliaria", "inquilino"])
    assert.throws(() => assertNonDemoOperation(`${role}@nox.com`), /bloqueada/);
  assert.doesNotThrow(() => assertNonDemoOperation("real@example.invalid"));
});
