import assert from "node:assert/strict";
import test from "node:test";
import {
  GOOGLE_ADS_SIGNUP_DESTINATION,
  GOOGLE_ADS_TAG_ID,
  trackCadastroConcluido,
  syncTrackingSession,
} from "../src/lib/tracking";

test("envia a conversão de inscrição configurada no Google Ads", () => {
  const gtagCalls: unknown[][] = [];
  const fbqCalls: unknown[][] = [];
  const originalWindow = globalThis.window;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { pathname: "/cadastro-concluido" },
      gtag: (...args: unknown[]) => gtagCalls.push(args),
      fbq: (...args: unknown[]) => fbqCalls.push(args),
    },
  });

  try {
    syncTrackingSession("real@example.invalid");
    trackCadastroConcluido();

    assert.deepEqual(gtagCalls, [
      ["event", "sign_up", { send_to: GOOGLE_ADS_TAG_ID }],
      [
        "event",
        "conversion",
        {
          send_to: GOOGLE_ADS_SIGNUP_DESTINATION,
          value: 1.0,
          currency: "BRL",
        },
      ],
    ]);
    assert.deepEqual(fbqCalls, [["track", "CompleteRegistration"]]);
  } finally {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  }
});
