import assert from "node:assert/strict";
import test from "node:test";

import {
  DASHBOARD_ROUTE_LOADING_MAX_VISIBLE_MS,
  LoadingTokenRegistry,
} from "../src/lib/global-loading";

test("a transição visual do dashboard respeita o limite de dois segundos", () => {
  assert.ok(DASHBOARD_ROUTE_LOADING_MAX_VISIBLE_MS <= 2_000);
});

test("mantém o loading enquanto existir uma operação concorrente", () => {
  const registry = new LoadingTokenRegistry();
  const first = registry.begin();
  const second = registry.begin();

  assert.equal(registry.size, 2);
  registry.end(first);
  assert.equal(registry.active, true);
  registry.end(second);
  assert.equal(registry.active, false);
});

test("uma finalização antiga não libera uma operação nova", () => {
  const registry = new LoadingTokenRegistry();
  const oldRequest = registry.begin();
  registry.end(oldRequest);
  const currentRequest = registry.begin();

  assert.equal(registry.end(oldRequest), false);
  assert.equal(registry.active, true);
  assert.equal(registry.end(currentRequest), true);
  assert.equal(registry.active, false);
});
