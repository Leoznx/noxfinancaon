import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resendProviderMessageId } from "../supabase/functions/_shared/resend-response.ts";

describe("Resend response tracking", () => {
  it("preserva o identificador retornado pelo provedor", () => {
    assert.equal(resendProviderMessageId({ id: "  email_123  " }), "email_123");
  });

  it("ignora respostas sem identificador utilizável", () => {
    assert.equal(resendProviderMessageId({ id: 123 }), undefined);
    assert.equal(resendProviderMessageId(null), undefined);
  });
});
