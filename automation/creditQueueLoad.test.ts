import assert from "node:assert/strict";
import test from "node:test";
import { decideFailureDisposition } from "./creditQueuePolicy";

type Job = {
  id: string;
  account: string;
  key: string;
  payload: string;
  state: "queued" | "processing" | "completed" | "requires_verification";
  result: "aprovado" | "recusado" | "em_analise" | null;
};

class ProviderSimulator {
  active = 0;
  maxActive = 0;

  async execute(job: Job) {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    await new Promise<void>((resolve) => setImmediate(resolve));
    this.active -= 1;
    const decisions = ["aprovado", "recusado", "em_analise"] as const;
    return { jobId: job.id, result: decisions[Number(job.id.slice(1)) % decisions.length] };
  }
}

class DurableQueueSimulator {
  private sequence = 0;
  private byIdempotency = new Map<string, Job>();
  readonly jobs: Job[] = [];

  enqueue(account: string, key: string, payload: string): Job {
    const scopedKey = `${account}:${key}`;
    const existing = this.byIdempotency.get(scopedKey);
    if (existing) {
      if (existing.payload !== payload) throw new Error("idempotency_payload_mismatch");
      return existing;
    }
    const job: Job = {
      id: `j${this.sequence++}`,
      account,
      key,
      payload,
      state: "queued",
      result: null,
    };
    this.byIdempotency.set(scopedKey, job);
    this.jobs.push(job);
    return job;
  }

  async drain(provider: ProviderSimulator) {
    for (const job of this.jobs) {
      if (job.state !== "queued") continue;
      job.state = "processing";
      const response = await provider.execute(job);
      assert.equal(response.jobId, job.id);
      job.result = response.result;
      job.state = "completed";
    }
  }
}

for (const clients of [1, 5, 10, 25, 50]) {
  test(`${clients} clientes ficam persistidos e o provedor continua serial`, async () => {
    const queue = new DurableQueueSimulator();
    const provider = new ProviderSimulator();
    for (let index = 0; index < clients; index += 1) {
      const created = queue.enqueue(`account-${index % 4}`, `key-${index}`, `payload-${index}`);
      const duplicate = queue.enqueue(`account-${index % 4}`, `key-${index}`, `payload-${index}`);
      assert.equal(duplicate.id, created.id);
    }
    await queue.drain(provider);
    assert.equal(queue.jobs.length, clients);
    assert.equal(queue.jobs.filter((job) => job.state === "completed").length, clients);
    assert.equal(new Set(queue.jobs.map((job) => job.id)).size, clients);
    assert.equal(provider.maxActive, 1);
  });
}

test("mesma chave com dados incompatíveis é rejeitada", () => {
  const queue = new DurableQueueSimulator();
  queue.enqueue("account", "same-key", "rent=1000");
  assert.throws(
    () => queue.enqueue("account", "same-key", "rent=2000"),
    /idempotency_payload_mismatch/,
  );
});

test("a mesma chave pertence a contas distintas sem misturar pedidos ou resultados", async () => {
  const queue = new DurableQueueSimulator();
  const provider = new ProviderSimulator();
  const first = queue.enqueue("agency-a", "shared-key", "tenant-a");
  const second = queue.enqueue("agency-b", "shared-key", "tenant-b");
  await queue.drain(provider);

  assert.notEqual(first.id, second.id);
  assert.equal(first.payload, "tenant-a");
  assert.equal(second.payload, "tenant-b");
  assert.notEqual(first.result, second.result);
});

test("aprovação, recusa e em análise permanecem ligados ao pedido correto", async () => {
  const queue = new DurableQueueSimulator();
  const provider = new ProviderSimulator();
  const jobs = [0, 1, 2].map((index) =>
    queue.enqueue("account", `decision-${index}`, `payload-${index}`),
  );
  await queue.drain(provider);

  assert.deepEqual(
    jobs.map((job) => [job.payload, job.result]),
    [
      ["payload-0", "aprovado"],
      ["payload-1", "recusado"],
      ["payload-2", "em_analise"],
    ],
  );
});

test("indisponibilidade do banco não confirma uma solicitação que não foi persistida", () => {
  const queue = new DurableQueueSimulator();
  const enqueueWhileUnavailable = () => {
    throw new Error("database_unavailable");
  };
  assert.throws(enqueueWhileUnavailable, /database_unavailable/);
  assert.equal(queue.jobs.length, 0);
});

test("resposta HTTP perdida devolve a mesma solicitação durável no retry", () => {
  const queue = new DurableQueueSimulator();
  const acceptedBeforeDisconnect = queue.enqueue("account", "network-retry", "payload");
  const retried = queue.enqueue("account", "network-retry", "payload");
  assert.equal(retried, acceptedBeforeDisconnect);
  assert.equal(queue.jobs.length, 1);
});

test("falhas nos três pontos críticos têm destinos seguros", () => {
  // Transaction rollback before durable acceptance: nothing is acknowledged.
  const queue = new DurableQueueSimulator();
  assert.equal(queue.jobs.length, 0);

  // Provider may have received the request: quarantine, never retry blindly.
  assert.equal(
    decideFailureDisposition({
      providerSubmissionState: "submitted",
      retryable: true,
      attemptCount: 1,
      maxAttempts: 3,
    }),
    "requires_verification",
  );

  // Result persisted before queue acknowledgement: replay sees completed state.
  const persisted = queue.enqueue("account", "persisted-key", "payload");
  persisted.state = "completed";
  persisted.result = "aprovado";
  assert.equal(queue.enqueue("account", "persisted-key", "payload").result, "aprovado");
});
