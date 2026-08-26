import assert from "node:assert/strict";
import test from "node:test";
import { redirectPathForRole } from "../src/lib/authRedirect";

test("jurídico entra primeiro no dashboard", () => {
  assert.equal(redirectPathForRole("juridico"), "/dashboard");
});

test("mantém os destinos operacionais dos demais cargos internos", () => {
  assert.equal(redirectPathForRole("financeiro"), "/admin/financeiro");
  assert.equal(redirectPathForRole("marketing"), "/admin/leads");
  assert.equal(redirectPathForRole("suporte"), "/suporte");
  assert.equal(redirectPathForRole("vendedor"), "/vendedor");
});
