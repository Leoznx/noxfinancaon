import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boundedCelebrationSince,
  isTrustedTvDisplayRequest,
  saoPauloMonthYear,
} from "../supabase/functions/_shared/tv-display-access.ts";

describe("TV APK display access", () => {
  it("aceita somente o WebView oficial carregado no domínio da NOX", () => {
    assert.equal(
      isTrustedTvDisplayRequest(
        new Request("https://example.test", {
          headers: {
            origin: "https://noxfianca.com",
            "user-agent": "Mozilla/5.0 NOX-TV/1.4",
          },
        }),
      ),
      true,
    );
    assert.equal(
      isTrustedTvDisplayRequest(
        new Request("https://example.test", {
          headers: { origin: "https://noxfianca.com", "user-agent": "Mozilla/5.0 Chrome" },
        }),
      ),
      false,
    );
    assert.equal(
      isTrustedTvDisplayRequest(
        new Request("https://example.test", {
          headers: { origin: "https://evil.example", "user-agent": "NOX-TV/1.4" },
        }),
      ),
      false,
    );
  });

  it("usa o mês corrente de São Paulo", () => {
    assert.deepEqual(saoPauloMonthYear(new Date("2026-11-01T01:30:00.000Z")), {
      month: 10,
      year: 2026,
    });
  });

  it("limita a recuperação de comemorações aos últimos dez minutos", () => {
    const now = new Date("2026-11-04T15:00:00.000Z");
    assert.equal(
      boundedCelebrationSince("2026-11-04T14:58:00.000Z", now),
      "2026-11-04T14:58:00.000Z",
    );
    assert.equal(
      boundedCelebrationSince("2026-11-04T12:00:00.000Z", now),
      "2026-11-04T14:50:00.000Z",
    );
  });
});
