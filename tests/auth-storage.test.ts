import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import {
  dynamicAuthStorage,
  getRememberMe,
  setRememberMe,
} from "../src/lib/authStorage";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

const originalWindow = globalThis.window;
let localStorage: MemoryStorage;
let sessionStorage: MemoryStorage;

beforeEach(() => {
  localStorage = new MemoryStorage();
  sessionStorage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage, sessionStorage },
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
});

test("Lembrar de mim migra token e usuário para o armazenamento persistente", () => {
  sessionStorage.setItem("sb-project-auth-token", "session-token");
  sessionStorage.setItem("nox_user", '{"id":"user-1"}');

  setRememberMe(true);

  assert.equal(getRememberMe(), true);
  assert.equal(localStorage.getItem("sb-project-auth-token"), "session-token");
  assert.equal(localStorage.getItem("nox_user"), '{"id":"user-1"}');
  assert.equal(sessionStorage.getItem("sb-project-auth-token"), null);
  assert.equal(sessionStorage.getItem("nox_user"), null);
});

test("sessão temporária sai do armazenamento persistente", () => {
  localStorage.setItem("sb-project-auth-token", "persistent-token");
  localStorage.setItem("nox_user", '{"id":"user-2"}');

  setRememberMe(false);

  assert.equal(getRememberMe(), false);
  assert.equal(sessionStorage.getItem("sb-project-auth-token"), "persistent-token");
  assert.equal(sessionStorage.getItem("nox_user"), '{"id":"user-2"}');
  assert.equal(localStorage.getItem("sb-project-auth-token"), null);
  assert.equal(localStorage.getItem("nox_user"), null);
});

test("adapter recupera no localStorage uma sessão lembrada gravada na aba", () => {
  localStorage.setItem("nox_remember_me", "1");
  sessionStorage.setItem("sb-project-auth-token", "legacy-token");

  assert.equal(dynamicAuthStorage.getItem("sb-project-auth-token"), "legacy-token");
  assert.equal(localStorage.getItem("sb-project-auth-token"), "legacy-token");
  assert.equal(sessionStorage.getItem("sb-project-auth-token"), null);
});

test("adapter nunca restaura localStorage quando Lembrar de mim está desmarcado", () => {
  localStorage.setItem("nox_remember_me", "0");
  localStorage.setItem("sb-project-auth-token", "old-token");

  assert.equal(dynamicAuthStorage.getItem("sb-project-auth-token"), null);
});
