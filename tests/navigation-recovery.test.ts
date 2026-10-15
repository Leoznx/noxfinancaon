import assert from "node:assert/strict";
import test from "node:test";

import {
  isRecoverableNavigationError,
  reloadCurrentDocumentForNavigationError,
} from "../src/lib/navigation-recovery.ts";

test("reconhece falhas de módulos de uma versão antiga do site", () => {
  const messages = [
    "Failed to fetch dynamically imported module: /assets/dashboard-A1B2.js",
    "error loading dynamically imported module: /assets/consultas-C3D4.js",
    "Importing a module script failed.",
    "ChunkLoadError: Loading chunk 42 failed",
    "Unable to preload CSS for /assets/dashboard-E5F6.css",
    'Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html"',
  ];

  for (const message of messages) {
    assert.equal(isRecoverableNavigationError(new Error(message)), true, message);
  }
});

test("encontra a falha recuperável dentro de eventos e causas encadeadas", () => {
  assert.equal(
    isRecoverableNavigationError({
      reason: {
        cause: new TypeError("Failed to fetch dynamically imported module: /assets/app.js"),
      },
    }),
    true,
  );
});

test("não recarrega automaticamente por erro comum de API ou regra de negócio", () => {
  assert.equal(
    isRecoverableNavigationError(new Error("Falha ao buscar proposta no Supabase")),
    false,
  );
  assert.equal(isRecoverableNavigationError(new TypeError("Failed to fetch")), false);
  assert.equal(isRecoverableNavigationError(undefined), false);
});

test("limita a recuperação automática e permite uma nova tentativa manual", () => {
  const stored = new Map<string, string>();
  let reloads = 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        href: "https://noxfianca.com/dashboard",
        reload: () => {
          reloads += 1;
        },
      },
      sessionStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
      },
    },
  });

  try {
    const error = new Error("Failed to fetch dynamically imported module: /assets/dashboard.js");
    assert.equal(reloadCurrentDocumentForNavigationError(error), true);
    assert.equal(reloadCurrentDocumentForNavigationError(error), false);
    assert.equal(reloadCurrentDocumentForNavigationError(error, { force: true }), true);
    assert.equal(reloads, 2);
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});
