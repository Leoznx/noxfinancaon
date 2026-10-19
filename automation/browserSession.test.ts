import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BrowserSession, type BrowserSessionConfig } from "./browserSession";
import { readStorageStateFile, writeStorageStateAtomically } from "./sessionStore";

const loftCookie = {
  name: "session",
  value: "opaque",
  domain: ".loft.com.br",
  path: "/",
  expires: -1,
  httpOnly: true,
  secure: true,
  sameSite: "Lax" as const,
};

async function withSession<T>(
  prepare: (file: string) => Promise<void>,
  run: (session: BrowserSession, file: string, logs: string[]) => Promise<T>,
): Promise<T> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nox-browser-session-"));
  const file = path.join(directory, "session.json");
  const logs: string[] = [];
  await prepare(file);
  const config: BrowserSessionConfig = {
    storageStatePath: file,
    profileDir: path.join(directory, "profile"),
    headless: true,
    info: (message) => logs.push(message),
    warn: (message) => logs.push(message),
  };
  const session = await BrowserSession.open(config);
  try {
    return await run(session, file, logs);
  } finally {
    await session.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test("inicia sem lançar erro quando o arquivo de sessão está corrompido", async () => {
  await withSession(
    (file) => fs.writeFile(file, '{"cookies":[{"name":'),
    async (session, file, logs) => {
      assert.equal(session.isAlive(), true);
      assert.equal(session.loadedFrom, "none");
      assert.ok(logs.some((line) => /quarentena/i.test(line)));
      const names = await fs.readdir(path.dirname(file));
      assert.ok(names.some((name) => name.startsWith("session.json.invalid-")));
      // O contexto funciona normalmente, sem cookies herdados.
      assert.deepEqual(await session.context.cookies(), []);
    },
  );
});

test("carrega os cookies do arquivo de sessão válido", async () => {
  await withSession(
    (file) => writeStorageStateAtomically(file, { cookies: [loftCookie], origins: [] }).then(() => {}),
    async (session) => {
      assert.equal(session.loadedFrom, "primary");
      const cookies = await session.context.cookies("https://app.loft.com.br");
      assert.equal(cookies.length, 1);
      assert.equal(cookies[0].name, "session");
    },
  );
});

test("só grava a sessão depois que o login foi confirmado", async () => {
  await withSession(
    async () => {},
    async (session, file) => {
      await session.context.addCookies([loftCookie]);

      assert.equal(await session.persist(), false);
      assert.equal((await readStorageStateFile(file)).ok, false);

      session.markAuthenticated(true);
      assert.equal(await session.persist(), true);
      const saved = await readStorageStateFile(file);
      assert.equal(saved.ok && saved.state.cookies.length, 1);
    },
  );
});

test("não grava uma sessão sem cookies do provedor por cima de uma sessão boa", async () => {
  await withSession(
    (file) => writeStorageStateAtomically(file, { cookies: [loftCookie], origins: [] }).then(() => {}),
    async (session, file) => {
      await session.context.clearCookies();
      session.markAuthenticated(true);

      assert.equal(await session.persist(), false);
      const saved = await readStorageStateFile(file);
      assert.equal(saved.ok && saved.state.cookies.length, 1);
    },
  );
});

test("preserva um arquivo substituído externamente e sinaliza a recarga", async () => {
  await withSession(
    (file) => writeStorageStateAtomically(file, { cookies: [loftCookie], origins: [] }).then(() => {}),
    async (session, file) => {
      session.markAuthenticated(true);
      assert.equal(await session.detectExternalUpdate(), false);

      // Alguém fez um novo login e copiou o arquivo para o servidor.
      const novaSessao = { ...loftCookie, value: "nova-sessao-feita-por-uma-pessoa" };
      await new Promise((resolve) => setTimeout(resolve, 15));
      await fs.writeFile(file, JSON.stringify({ cookies: [novaSessao], origins: [] }));

      assert.equal(await session.detectExternalUpdate(), true);
      assert.equal(await session.persist(), false);
      const saved = await readStorageStateFile(file);
      assert.equal(saved.ok && saved.state.cookies[0].value, "nova-sessao-feita-por-uma-pessoa");
      assert.equal(session.externalUpdatePending, true);
    },
  );
});

test("a própria gravação não é confundida com uma substituição externa", async () => {
  await withSession(
    async () => {},
    async (session) => {
      await session.context.addCookies([loftCookie]);
      session.markAuthenticated(true);

      assert.equal(await session.persist(), true);
      assert.equal(await session.detectExternalUpdate(), false);
      assert.equal(await session.persist(), true);
    },
  );
});

test("informa que o navegador deixou de responder antes de ele ser reutilizado", async () => {
  await withSession(
    async () => {},
    async (session) => {
      assert.equal(session.isAlive(), true);
      await session.browser?.close();
      assert.equal(session.isAlive(), false);
      assert.equal(await session.persist({ force: true }), false);
    },
  );
});

test("preserva um arquivo ainda ilegível e o recarrega assim que ele passa a ser legível", async () => {
  await withSession(
    // Um diretório no lugar do arquivo faz a leitura falhar como "unreadable" — o mesmo caso de
    // um arquivo copiado por outro usuário com permissão 600 (EACCES).
    (file) => fs.mkdir(file).then(() => {}),
    async (session, file, logs) => {
      assert.ok(logs.some((line) => /Sem permissão para ler/i.test(line)));
      session.markAuthenticated(true);
      await session.context.addCookies([loftCookie]);

      // Nunca sobrescreve o que não conseguiu ler e não pede recarga enquanto continua ilegível.
      assert.equal(await session.persist(), false);
      assert.equal(await session.detectExternalUpdate(), false);

      // A permissão é corrigida (ou o arquivo é trocado): chown não muda mtime nem tamanho, então
      // só a releitura percebe que o arquivo agora pode ser usado.
      await fs.rm(file, { recursive: true });
      await writeStorageStateAtomically(file, {
        cookies: [{ ...loftCookie, value: "sessao-nova" }],
        origins: [],
      });

      assert.equal(await session.detectExternalUpdate(), true);
      assert.equal(await session.persist(), false);
      const saved = await readStorageStateFile(file);
      assert.equal(saved.ok && saved.state.cookies[0].value, "sessao-nova");
    },
  );
});
