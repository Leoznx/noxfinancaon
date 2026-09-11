import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { log, logErro, logStructured } from "./logger";

const baseDir = path.dirname(fileURLToPath(import.meta.url));
let stopping = false;
let credit: ChildProcess | null = null;
let repair: ChildProcess | null = null;
let creditRestarting = false;
const restartHistory: number[] = [];

function spawnWorker(file: string, ipc = false): ChildProcess {
  const child = spawn(process.execPath, ["--import", "tsx", path.join(baseDir, file)], {
    cwd: baseDir,
    env: process.env,
    stdio: ipc ? ["inherit", "inherit", "inherit", "ipc"] : "inherit",
  });
  child.on("error", (error) => logErro(`Nao foi possivel iniciar ${file}`, error));
  return child;
}

function restartDelay(): number {
  const now = Date.now();
  while (restartHistory.length && restartHistory[0] < now - 10 * 60_000) restartHistory.shift();
  restartHistory.push(now);
  if (restartHistory.length <= 3) return 1_000;
  if (restartHistory.length <= 5) return 10_000;
  return 5 * 60_000;
}

function startCredit(): void {
  if (stopping || credit) return;
  credit = spawnWorker("credpagoWorker.ts");
  const child = credit;
  logStructured("supervisor_credit_started", { pid: child.pid });
  child.once("exit", (code, signal) => {
    if (credit === child) credit = null;
    logStructured("supervisor_credit_exited", { code, signal, stopping });
    if (!stopping && !creditRestarting) {
      const delay = restartDelay();
      log(`Worker de credito sera reiniciado em ${delay}ms.`);
      setTimeout(startCredit, delay).unref();
    }
  });
}

async function stopChild(child: ChildProcess | null, timeoutMs = 20_000): Promise<void> {
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
  if (child.exitCode == null) child.kill("SIGKILL");
}

async function controlledCreditRestart(requestId: string, reason: string): Promise<void> {
  if (creditRestarting) {
    repair?.send?.({ type: "restart-credit-result", requestId, ok: false, error: "Restart ja em andamento." });
    return;
  }
  creditRestarting = true;
  try {
    logStructured("supervisor_credit_restart_requested", { requestId, reason });
    const current = credit;
    await stopChild(current);
    if (credit === current) credit = null;
    startCredit();
    repair?.send?.({ type: "restart-credit-result", requestId, ok: true });
  } catch (error) {
    logErro("Restart controlado do worker de credito falhou", error);
    repair?.send?.({ type: "restart-credit-result", requestId, ok: false, error: "Falha interna do supervisor." });
  } finally {
    creditRestarting = false;
  }
}

function startRepair(): void {
  if (stopping || repair) return;
  repair = spawnWorker("repairWorker.ts", true);
  const child = repair;
  logStructured("supervisor_repair_started", { pid: child.pid });
  child.on("message", (message: unknown) => {
    const value = message as { type?: string; requestId?: string; reason?: string };
    if (value?.type !== "restart-credit" || !value.requestId) return;
    void controlledCreditRestart(value.requestId, String(value.reason || "runbook"));
  });
  child.once("exit", (code, signal) => {
    if (repair === child) repair = null;
    logStructured("supervisor_repair_exited", { code, signal, stopping });
    if (!stopping) setTimeout(startRepair, 5_000).unref();
  });
}

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  log("Supervisor encerrando os dois processos de forma graciosa.");
  await Promise.all([stopChild(repair), stopChild(credit)]);
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());

startCredit();
startRepair();
log("Supervisor NOX iniciado: credito e reparo em processos independentes.");
