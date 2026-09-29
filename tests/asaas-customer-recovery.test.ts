import assert from "node:assert/strict";
import test from "node:test";

import {
  type AsaasCustomerFetcher,
  recoverStoredAsaasCustomer,
} from "../supabase/functions/_shared/asaas-customer-recovery";

function apiError(status: number) {
  return Object.assign(new Error(`Asaas API responded ${status}`), { status });
}

test("mantem um cliente Asaas que continua ativo", async () => {
  const calls: string[] = [];
  const fetcher: AsaasCustomerFetcher = async (path) => {
    calls.push(path);
    return { id: "cus_active", deleted: false };
  };

  assert.equal(await recoverStoredAsaasCustomer("cus_active", fetcher), "cus_active");
  assert.deepEqual(calls, ["/customers/cus_active"]);
});

test("restaura automaticamente um cliente removido", async () => {
  const calls: string[] = [];
  const fetcher: AsaasCustomerFetcher = async (path) => {
    calls.push(path);
    if (path.endsWith("/restore")) return { id: "cus_removed", deleted: false };
    return { id: "cus_removed", deleted: true };
  };

  assert.equal(await recoverStoredAsaasCustomer("cus_removed", fetcher), "cus_removed");
  assert.deepEqual(calls, ["/customers/cus_removed", "/customers/cus_removed/restore"]);
});

test("tenta restaurar pelo ID quando a consulta do removido devolve 404", async () => {
  const calls: string[] = [];
  const fetcher: AsaasCustomerFetcher = async (path) => {
    calls.push(path);
    if (path.endsWith("/restore")) return { id: "cus_hidden", deleted: false };
    throw apiError(404);
  };

  assert.equal(await recoverStoredAsaasCustomer("cus_hidden", fetcher), "cus_hidden");
  assert.deepEqual(calls, ["/customers/cus_hidden", "/customers/cus_hidden/restore"]);
});

test("confirma o cliente ativo depois de uma corrida de restauracao", async () => {
  let reads = 0;
  const fetcher: AsaasCustomerFetcher = async (path) => {
    if (path.endsWith("/restore")) throw apiError(400);
    reads += 1;
    return { id: "cus_race", deleted: reads === 1 };
  };

  assert.equal(await recoverStoredAsaasCustomer("cus_race", fetcher), "cus_race");
  assert.equal(reads, 2);
});

test("libera o fallback quando o ID nao existe mais no Asaas", async () => {
  const fetcher: AsaasCustomerFetcher = async () => {
    throw apiError(404);
  };

  assert.equal(await recoverStoredAsaasCustomer("cus_missing", fetcher), null);
});
