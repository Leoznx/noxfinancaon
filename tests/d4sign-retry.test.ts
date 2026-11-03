import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  d4SignRetryDelayMinutes,
  isD4SignProviderLimitError,
  nextD4SignRetryAt,
} from "../supabase/functions/_shared/d4sign-retry.ts";

describe("D4Sign provider-limit retry", () => {
  it("classifica somente a mensagem conhecida de cota", () => {
    assert.equal(
      isD4SignProviderLimitError(
        new Error("d4sign_api_error:400:This account has no more limits to send documents"),
      ),
      true,
    );
    assert.equal(isD4SignProviderLimitError(new Error("d4sign_api_error:500:timeout")), false);
  });

  it("aplica backoff e limita o intervalo máximo a seis horas", () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6, 20].map(d4SignRetryDelayMinutes),
      [15, 30, 60, 120, 240, 360, 360],
    );
  });

  it("calcula o próximo horário sem depender do relógio global", () => {
    assert.equal(
      nextD4SignRetryAt(2, new Date("2026-11-03T17:00:00.000Z")),
      "2026-11-03T17:30:00.000Z",
    );
  });
});
