import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const originalDeno = (globalThis as { Deno?: unknown }).Deno;
const environment = new Map<string, string>();

before(() => {
  (globalThis as { Deno?: unknown }).Deno = {
    env: {
      get(name: string) {
        return environment.get(name);
      },
    },
  };
});

after(() => {
  if (originalDeno === undefined) delete (globalThis as { Deno?: unknown }).Deno;
  else (globalThis as { Deno?: unknown }).Deno = originalDeno;
});

async function originAllowed(origin: string) {
  const { isAllowedOrigin } = await import("../supabase/functions/_shared/http-security.ts");
  return isAllowedOrigin(new Request("https://project.supabase.co/functions/v1/test", {
    headers: { origin },
  }));
}

test("mantém todos os domínios oficiais mesmo quando ALLOWED_ORIGINS está configurado", async () => {
  environment.set("ALLOWED_ORIGINS", "https://noxfianca.com");

  assert.equal(await originAllowed("https://noxfianca.com"), true);
  assert.equal(await originAllowed("https://www.noxfianca.com"), true);
  assert.equal(await originAllowed("https://noxfinancaon.vercel.app"), true);
});

test("aceita previews do projeto NOX na Vercel e rejeita origens parecidas", async () => {
  assert.equal(
    await originAllowed("https://noxfinancaon-git-main-leoznx-projects.vercel.app"),
    true,
  );
  assert.equal(await originAllowed("https://malicious-example.vercel.app"), false);
  assert.equal(await originAllowed("http://noxfinancaon.vercel.app"), false);
});
