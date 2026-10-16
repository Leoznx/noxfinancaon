import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeWatchdogTimeoutError, runWithRuntimeWatchdog } from "./runtimeWatchdog";

test("watchdog devolve o resultado e cancela o timer quando a tarefa termina", async () => {
  let aborted = false;
  const result = await runWithRuntimeWatchdog(Promise.resolve("ok"), {
    timeoutMs: 100,
    message: "não deveria expirar",
    abort: () => {
      aborted = true;
    },
  });

  assert.equal(result, "ok");
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(aborted, false);
});

test("watchdog aborta uma tarefa travada dentro do prazo total", async () => {
  let abortCount = 0;
  const startedAt = Date.now();

  await assert.rejects(
    runWithRuntimeWatchdog(new Promise<never>(() => {}), {
      timeoutMs: 25,
      message: "validação excedeu o prazo",
      abort: () => {
        abortCount += 1;
      },
    }),
    (error: unknown) =>
      error instanceof RuntimeWatchdogTimeoutError && error.message === "validação excedeu o prazo",
  );

  assert.equal(abortCount, 1);
  assert.ok(Date.now() - startedAt < 2_000);
});
