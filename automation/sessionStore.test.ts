import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  fingerprintSessionFile,
  loadStorageStateWithFallback,
  readStorageStateFile,
  sameFingerprint,
  sessionHasProviderCookies,
  validateStorageState,
  writeStorageStateAtomically,
  type StorageStateLike,
} from "./sessionStore";

const loftCookie = {
  name: "session",
  value: "opaque",
  domain: ".loft.com.br",
  path: "/",
  expires: -1,
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
};

function validState(value = "opaque"): StorageStateLike {
  return { cookies: [{ ...loftCookie, value }], origins: [] };
}

async function withTempDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nox-session-"));
  try {
    return await run(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test("descarta cookies e origens malformados sem rejeitar a sessão inteira", () => {
  const state = validateStorageState({
    cookies: [loftCookie, { name: "sem-dominio", value: "x", path: "/" }, null, "texto"],
    origins: [
      { origin: "https://app.loft.com.br", localStorage: [{ name: "a", value: "b" }] },
      { origin: "https://quebrado.example", localStorage: "não é lista" },
    ],
  });

  assert.ok(state);
  assert.equal(state.cookies.length, 1);
  assert.equal(state.origins.length, 1);
});

test("rejeita valores que não têm o formato de storageState", () => {
  assert.equal(validateStorageState(null), null);
  assert.equal(validateStorageState([]), null);
  assert.equal(validateStorageState({ origins: [] }), null);
  assert.equal(validateStorageState({ cookies: [], origins: "x" }), null);
});

test("só considera autenticada uma sessão com cookies do provedor", () => {
  assert.equal(sessionHasProviderCookies({ cookies: [], origins: [] }), false);
  assert.equal(
    sessionHasProviderCookies({
      cookies: [{ ...loftCookie, domain: "analytics.example.com" }],
      origins: [],
    }),
    false,
  );
  assert.equal(sessionHasProviderCookies(validState()), true);
  assert.equal(
    sessionHasProviderCookies({
      cookies: [{ ...loftCookie, domain: "app.loft.com.br" }],
      origins: [],
    }),
    true,
  );
});

test("distingue arquivo ausente, vazio, JSON inválido e formato inválido", async () => {
  await withTempDirectory(async (directory) => {
    const file = path.join(directory, "session.json");
    assert.deepEqual(await readStorageStateFile(file), { ok: false, reason: "missing" });

    await fs.writeFile(file, "   ");
    assert.deepEqual(await readStorageStateFile(file), { ok: false, reason: "empty" });

    await fs.writeFile(file, '{"cookies": [');
    const invalidJson = await readStorageStateFile(file);
    assert.equal(invalidJson.ok, false);
    assert.equal(invalidJson.ok === false && invalidJson.reason, "invalid_json");

    await fs.writeFile(file, JSON.stringify({ outra: "coisa" }));
    assert.deepEqual(await readStorageStateFile(file), { ok: false, reason: "invalid_shape" });

    await fs.writeFile(file, JSON.stringify(validState()));
    const valid = await readStorageStateFile(file);
    assert.equal(valid.ok, true);
  });
});

test("grava de forma atômica, valida o conteúdo e mantém o backup do arquivo anterior", async () => {
  await withTempDirectory(async (directory) => {
    const file = path.join(directory, "data", "session.json");

    const first = await writeStorageStateAtomically(file, validState("primeira"));
    assert.ok(first.size > 0);
    assert.equal((await readStorageStateFile(`${file}.bak`)).ok, false);

    await writeStorageStateAtomically(file, validState("segunda"));
    const current = await readStorageStateFile(file);
    const backup = await readStorageStateFile(`${file}.bak`);
    assert.ok(current.ok && backup.ok);
    assert.equal(current.ok && current.state.cookies[0].value, "segunda");
    assert.equal(backup.ok && backup.state.cookies[0].value, "primeira");

    const leftovers = (await fs.readdir(path.dirname(file))).filter((name) => name.includes(".tmp-"));
    assert.deepEqual(leftovers, []);
  });
});

test("não substitui o arquivo principal quando a gravação falha na validação", async () => {
  await withTempDirectory(async (directory) => {
    const file = path.join(directory, "session.json");
    await writeStorageStateAtomically(file, validState("boa"));

    await assert.rejects(
      writeStorageStateAtomically(file, { cookies: "quebrado" } as unknown as StorageStateLike),
    );

    const current = await readStorageStateFile(file);
    assert.equal(current.ok && current.state.cookies[0].value, "boa");
    const leftovers = (await fs.readdir(directory)).filter((name) => name.includes(".tmp-"));
    assert.deepEqual(leftovers, []);
  });
});

test("restaura o backup e coloca em quarentena um arquivo principal corrompido", async () => {
  await withTempDirectory(async (directory) => {
    const file = path.join(directory, "session.json");
    await writeStorageStateAtomically(file, validState("antiga"));
    await writeStorageStateAtomically(file, validState("recente"));
    // Simula um desligamento no meio da gravação do arquivo principal.
    await fs.writeFile(file, '{"cookies":[{"name":"sess');

    const warnings: string[] = [];
    const loaded = await loadStorageStateWithFallback(file, { warn: (m) => warnings.push(m) });

    assert.equal(loaded.source, "backup");
    assert.equal(loaded.primaryFailure, "invalid_json");
    assert.equal(loaded.state?.cookies[0].value, "antiga");
    assert.equal(warnings.length, 2);
    // O principal volta a ser legível e o arquivo ruim fica guardado para diagnóstico.
    assert.equal((await readStorageStateFile(file)).ok, true);
    const names = await fs.readdir(directory);
    assert.ok(names.some((name) => name.startsWith("session.json.invalid-")));
  });
});

test("inicia sem sessão, sem lançar erro, quando nem o backup existe", async () => {
  await withTempDirectory(async (directory) => {
    const file = path.join(directory, "session.json");
    await fs.writeFile(file, "isto não é json");

    const loaded = await loadStorageStateWithFallback(file);

    assert.equal(loaded.state, null);
    assert.equal(loaded.source, "none");
    assert.equal(loaded.primaryFailure, "invalid_json");
  });
});

test("um arquivo ausente não gera aviso nem quarentena", async () => {
  await withTempDirectory(async (directory) => {
    const warnings: string[] = [];
    const loaded = await loadStorageStateWithFallback(path.join(directory, "nada.json"), {
      warn: (message) => warnings.push(message),
    });

    assert.equal(loaded.source, "none");
    assert.equal(loaded.primaryFailure, "missing");
    assert.deepEqual(warnings, []);
  });
});

test("compara impressões digitais de arquivo", async () => {
  await withTempDirectory(async (directory) => {
    const file = path.join(directory, "session.json");
    assert.equal(await fingerprintSessionFile(file), null);

    await fs.writeFile(file, "a");
    const first = await fingerprintSessionFile(file);
    assert.ok(first);
    assert.equal(sameFingerprint(first, { ...first }), true);
    assert.equal(sameFingerprint(first, { ...first, size: first.size + 1 }), false);
    assert.equal(sameFingerprint(first, null), false);
    assert.equal(sameFingerprint(null, null), true);
  });
});
