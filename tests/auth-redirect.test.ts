import assert from "node:assert/strict";
import test from "node:test";
import { redirectPathForRole } from "../src/lib/authRedirect";
import { noxInternalAccounts } from "../src/lib/nox-internal-accounts";

test("jurídico entra primeiro no dashboard", () => {
  assert.equal(redirectPathForRole("juridico"), "/dashboard");
});

test("cargos com dashboard próprio entram no painel novo", () => {
  assert.equal(redirectPathForRole("financeiro"), "/dashboard");
  assert.equal(redirectPathForRole("marketing"), "/dashboard");
});

test("cargos com portal próprio não caem no dashboard compartilhado", () => {
  assert.equal(redirectPathForRole("suporte"), "/suporte");
  assert.equal(redirectPathForRole("vendedor"), "/vendedor");
});

test("cadastros internos usam o mesmo destino dos redirects de autenticação", () => {
  // SDR/Closer são tipos de conta; o cargo autenticado é internalRole (e6600b6).
  for (const account of Object.values(noxInternalAccounts)) {
    assert.equal(account.dashboardRoute, redirectPathForRole(account.internalRole));
  }
});
