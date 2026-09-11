import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface AutomationLockOwner {
  instanceId: string;
  pid: number;
  processStartMarker: string;
  startedAt: string;
  heartbeatAt: string;
  mode: "portable-session" | "persistent-profile";
}

export interface AutomationLockHandle {
  path: string;
  owner: AutomationLockOwner;
  release: () => Promise<void>;
}

export class AutomationLockActiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutomationLockActiveError";
  }
}

async function readProcessStartMarker(pid: number): Promise<string | null> {
  if (process.platform !== "linux") return null;
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/);
    return fields[19] || null;
  } catch {
    return null;
  }
}

async function processMatches(owner: AutomationLockOwner): Promise<boolean> {
  try {
    process.kill(owner.pid, 0);
  } catch {
    return false;
  }
  const marker = await readProcessStartMarker(owner.pid);
  if (marker == null) {
    return Date.now() - Date.parse(owner.heartbeatAt) < 45_000;
  }
  return marker === owner.processStartMarker;
}

async function readOwner(lockPath: string): Promise<AutomationLockOwner | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(lockPath, "utf8")) as AutomationLockOwner;
    if (!parsed?.instanceId || !Number.isInteger(parsed.pid) || !parsed.processStartMarker) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function inspectAutomationLock(lockPath: string): Promise<Record<string, unknown>> {
  const owner = await readOwner(lockPath);
  if (!owner) return { exists: false };
  return {
    exists: true,
    active: await processMatches(owner),
    pid: owner.pid,
    startedAt: owner.startedAt,
    heartbeatAt: owner.heartbeatAt,
    mode: owner.mode,
  };
}

export async function acquireAutomationLock(
  lockPath: string,
  mode: AutomationLockOwner["mode"],
): Promise<AutomationLockHandle> {
  const resolved = path.resolve(lockPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const now = new Date().toISOString();
    const owner: AutomationLockOwner = {
      instanceId: crypto.randomUUID(),
      pid: process.pid,
      processStartMarker: (await readProcessStartMarker(process.pid)) ?? `${process.pid}-${Date.now()}`,
      startedAt: now,
      heartbeatAt: now,
      mode,
    };
    try {
      const handle = await fs.open(resolved, "wx", 0o600);
      await handle.writeFile(JSON.stringify(owner));
      await handle.close();

      const heartbeat = setInterval(async () => {
        const current = await readOwner(resolved);
        if (current?.instanceId !== owner.instanceId) return;
        owner.heartbeatAt = new Date().toISOString();
        await fs.writeFile(resolved, JSON.stringify(owner), { mode: 0o600 }).catch(() => {});
      }, 10_000);
      heartbeat.unref();

      return {
        path: resolved,
        owner,
        release: async () => {
          clearInterval(heartbeat);
          const current = await readOwner(resolved);
          if (current?.instanceId === owner.instanceId) await fs.unlink(resolved).catch(() => {});
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readOwner(resolved);
      if (existing && (await processMatches(existing))) {
        throw new AutomationLockActiveError(
          `credit-automation.lock pertence ao processo ativo ${existing.pid} desde ${existing.startedAt}.`,
        );
      }

      const staleName = `${resolved}.stale-${Date.now()}-${crypto.randomBytes(2).toString("hex")}`;
      await fs.rename(resolved, staleName).catch((renameError) => {
        if ((renameError as NodeJS.ErrnoException).code !== "ENOENT") throw renameError;
      });
    }
  }
  throw new AutomationLockActiveError("Nao foi possivel adquirir credit-automation.lock com seguranca.");
}
