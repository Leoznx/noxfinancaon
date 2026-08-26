import assert from "node:assert/strict";
import test from "node:test";
import {
  GOOGLE_ADS_SIGNUP_DESTINATION,
  GOOGLE_ADS_TAG_ID,
  trackCadastroConcluido,
} from "../src/lib/tracking";

test("envia a conversão de inscrição configurada no Google Ads", () => {
  const gtagCalls: unknown[][] = [];
  const fbqCalls: unknown[][] = [];
  const originalWindow = globalThis.window;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      gtag: (...args: unknown[]) => gtagCalls.push(args),
      fbq: (...args: unknown[]) => fbqCalls.push(args),
    },
  });

  try {
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
