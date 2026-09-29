import assert from "node:assert/strict";
import test from "node:test";
import { resolveZApiDeliveryStatus } from "../supabase/functions/_shared/zapi.ts";

test("classifica o retorno de fila da Z-API", () => {
  assert.deepEqual(resolveZApiDeliveryStatus({ type: "QueueCallback" }), {
    status: "queued",
    error: null,
  });
});

test("classifica envio, entrega e leitura da Z-API", () => {
  assert.deepEqual(resolveZApiDeliveryStatus({ type: "DeliveryCallback" }), {
    status: "sent",
    error: null,
  });
  assert.deepEqual(
    resolveZApiDeliveryStatus({
      type: "MessageStatusCallback",
      status: "RECEIVED",
    }),
    { status: "delivered", error: null },
  );
  assert.deepEqual(
    resolveZApiDeliveryStatus({
      type: "MessageStatusCallback",
      status: "READ",
    }),
    {
      status: "read",
      error: null,
    },
  );
});

test("classifica falha explícita da Z-API", () => {
  assert.deepEqual(
    resolveZApiDeliveryStatus({ status: "FAILED", error: "número inválido" }),
    {
      status: "failed",
      error: "número inválido",
    },
  );
});
