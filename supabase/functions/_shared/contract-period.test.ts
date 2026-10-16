import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CONTRACT_PERIOD_LOCK_CONFLICT_CODE,
  addUtcMonthsClamped,
  formatContractPeriodMonths,
  lockContractPeriod,
  parseContractPeriodMonths,
  replaceFixedContractPeriodText,
  resolveContractPeriodMonths,
} from "./contract-period.ts";

function fakeLockClient(options: {
  acquired?: Record<string, unknown> | null;
  current?: Record<string, unknown> | null;
}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  return {
    calls,
    from(table: string) {
      calls.push({ method: "from", args: [table] });
      let operation: "update" | "read" = "read";
      const query = {
        update(value: unknown) {
          operation = "update";
          calls.push({ method: "update", args: [value] });
          return query;
        },
        select(value: unknown) {
          calls.push({ method: "select", args: [value] });
          return query;
        },
        eq(column: unknown, value: unknown) {
          calls.push({ method: "eq", args: [column, value] });
          return query;
        },
        is(column: unknown, value: unknown) {
          calls.push({ method: "is", args: [column, value] });
          return query;
        },
        maybeSingle() {
          return Promise.resolve({
            data: operation === "update"
              ? options.acquired ?? null
              : options.current ?? null,
            error: null,
          });
        },
      };
      return query;
    },
  };
}

Deno.test("valida períodos inteiros entre 1 e 120 meses", () => {
  assertEquals(parseContractPeriodMonths(6), 6);
  assertEquals(parseContractPeriodMonths("36"), 36);
  assertEquals(parseContractPeriodMonths({ contract_period_months: 120 }), 120);
  assertEquals(parseContractPeriodMonths(null), null);
  assertEquals(parseContractPeriodMonths(0), null);
  assertEquals(parseContractPeriodMonths(121), null);
  assertEquals(parseContractPeriodMonths(12.5), null);
  assertEquals(parseContractPeriodMonths("12 meses"), null);
  assertThrows(() => resolveContractPeriodMonths(undefined));
});

Deno.test("formata período em meses no singular e plural", () => {
  assertEquals(formatContractPeriodMonths(1), "1 mês");
  assertEquals(formatContractPeriodMonths(24), "24 meses");
});

Deno.test("soma meses em UTC preservando horário e limitando o fim do mês", () => {
  assertEquals(
    addUtcMonthsClamped(new Date("2027-01-31T15:45:12.123Z"), 1).toISOString(),
    "2027-02-28T15:45:12.123Z",
  );
  assertEquals(
    addUtcMonthsClamped(new Date("2028-08-31T00:00:00.000Z"), 6).toISOString(),
    "2029-02-28T00:00:00.000Z",
  );
  assertEquals(
    addUtcMonthsClamped(new Date("2027-02-28T08:00:00.000Z"), 12).toISOString(),
    "2028-02-28T08:00:00.000Z",
  );
  assertThrows(() => addUtcMonthsClamped(new Date("invalid"), 12));
});

Deno.test("substitui somente a vigência fixa legada", () => {
  assertEquals(
    replaceFixedContractPeriodText(
      "Preço pelo serviço (vigência de 12 meses). Reajuste anual.",
      36,
    ),
    "Preço pelo serviço (vigência de 36 meses). Reajuste anual.",
  );
});

Deno.test("adquire lock por UPDATE condicionado ao período lido", async () => {
  const lockedAt = "2026-10-13T12:00:00.000Z";
  const client = fakeLockClient({
    acquired: {
      contract_period_months: 24,
      contract_period_locked_at: lockedAt,
    },
  });

  assertEquals(
    await lockContractPeriod(client, "consulta-1", 24, lockedAt),
    { contractPeriodMonths: 24, lockedAt, acquired: true },
  );
  assertEquals(
    client.calls.filter((call) => call.method === "eq").map((call) => call.args),
    [["id", "consulta-1"], ["contract_period_months", 24]],
  );
  assertEquals(
    client.calls.filter((call) => call.method === "is").map((call) => call.args),
    [
      ["contract_period_locked_at", null],
      ["contract_period_change_pending_at", null],
    ],
  );
});

Deno.test("lock repetido com o mesmo período é idempotente", async () => {
  const lockedAt = "2026-10-13T12:00:00.000Z";
  const client = fakeLockClient({
    acquired: null,
    current: {
      contract_period_months: 36,
      contract_period_locked_at: lockedAt,
    },
  });

  assertEquals(
    await lockContractPeriod(client, "consulta-2", 36),
    { contractPeriodMonths: 36, lockedAt, acquired: false },
  );
});

Deno.test("lock recusa continuar se o período mudou durante a requisição", async () => {
  const client = fakeLockClient({
    acquired: null,
    current: {
      contract_period_months: 12,
      contract_period_locked_at: null,
    },
  });

  await assertRejects(
    () => lockContractPeriod(client, "consulta-3", 24),
    Error,
    CONTRACT_PERIOD_LOCK_CONFLICT_CODE,
  );
});

Deno.test("lock recusa criar cobrança durante a troca segura do período", async () => {
  const client = fakeLockClient({
    acquired: null,
    current: {
      contract_period_months: 24,
      contract_period_locked_at: "2026-10-16T12:00:00.000Z",
      contract_period_change_pending_at: "2026-10-16T11:59:59.000Z",
    },
  });

  await assertRejects(
    () => lockContractPeriod(client, "consulta-4", 24),
    Error,
    CONTRACT_PERIOD_LOCK_CONFLICT_CODE,
  );
});
