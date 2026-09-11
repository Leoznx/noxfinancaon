import assert from "node:assert/strict";
import test from "node:test";
import { formatErrorDetail } from "./logger";

test("formata erros estruturados do Supabase com dados úteis", () => {
  assert.equal(
    formatErrorDetail({
      message: "connection failed",
      code: "PGRST000",
      details: "upstream unavailable",
      hint: "retry",
    }),
    "message=connection failed | code=PGRST000 | details=upstream unavailable | hint=retry",
  );
});

test("formata Error e sua causa sem produzir [object Object]", () => {
  const error = new Error("falha externa", { cause: { code: "ECONNRESET", message: "reset" } });
  const detail = formatErrorDetail(error);
  assert.match(detail, /falha externa/);
  assert.match(detail, /ECONNRESET/);
  assert.doesNotMatch(detail, /\[object Object\]/);
});
