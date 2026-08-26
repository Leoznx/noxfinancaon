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
  for (const [role, account] of Object.entries(noxInternalAccounts)) {
    assert.equal(account.dashboardRoute, redirectPathForRole(role));
  }
});
