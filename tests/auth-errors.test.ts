import assert from "node:assert/strict";
import test from "node:test";

import { isEmailNotConfirmedError } from "../src/lib/auth-errors.ts";

test("identifica o código estável do Supabase", () => {
  assert.equal(isEmailNotConfirmedError({ code: "email_not_confirmed" }), true);
});

test("mantém compatibilidade com a mensagem antiga do Supabase", () => {
  assert.equal(isEmailNotConfirmedError({ message: "Email not confirmed" }), true);
  assert.equal(isEmailNotConfirmedError({ message: "Email is not confirmed" }), true);
});

test("não confunde credenciais inválidas com e-mail pendente", () => {
  assert.equal(isEmailNotConfirmedError({ message: "Invalid login credentials" }), false);
  assert.equal(isEmailNotConfirmedError(null), false);
});
