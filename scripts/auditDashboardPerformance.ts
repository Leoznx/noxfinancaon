import { chromium, type Page, type Request } from "playwright";

const baseUrl = (process.env.NOX_AUDIT_BASE_URL || "https://www.noxfianca.com").replace(/\/$/, "");
const roles = (process.env.NOX_AUDIT_ROLES || "corretor,imobiliaria,proprietario")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

type ApiCall = {
  key: string;
  startedAt: number;
  finishedAt?: number;
  bytes?: number;
  failed?: boolean;
  status?: number;
};

type Measurement = {
  role: string;
  pass: "first" | "repeat";
  label: string;
  path: string;
  visualMs: number;
  dataReadyMs: number;
  apiRequests: number;
  duplicateRequests: string[];
  apiBytes: number | null;
  slowestApiMs: number | null;
  failedRequests: string[];
  apiBreakdown: string[];
};

const routeCandidates = [
  { label: "Dashboard", path: "/dashboard" },
  { label: "Nova Consulta", path: "/consultas/nova" },
  { label: "Minhas Consultas", path: "/consultas" },
  { label: "Contratos Ativos", path: "/apolices" },
  { label: "Faturas Inquilinos", path: "/faturas-inquilinos" },
  { label: "Carteira de Cobranças", path: "/carteira-cobrancas" },
  { label: "Minhas Comissões", path: "/minhas-comissoes" },
  { label: "Abrir Sinistro", path: "/sinistros" },
  { label: "Plano de Carreira", path: "/plano-carreira" },
  { label: "Meus Corretores", path: "/corretores-admin" },
  { label: "Meus Imóveis", path: "/imoveis" },
  { label: "Documentos", path: "/documentos" },
  { label: "Meu Perfil", path: "/configuracoes" },
];

function isApiRequest(request: Request) {
  const url = new URL(request.url());
  return (
    url.pathname.includes("/rest/v1/") ||
    url.pathname.includes("/auth/v1/") ||
    url.pathname.includes("/functions/v1/")
  );
}

function requestKey(request: Request) {
  const url = new URL(request.url());
  return `${request.method()} ${url.pathname}`;
}

function attachApiTracker(page: Page) {
  const pending = new Set<Request>();
  const calls: ApiCall[] = [];
  page.on("request", (request) => {
    if (!isApiRequest(request)) return;
    pending.add(request);
    calls.push({ key: requestKey(request), startedAt: performance.now() });
  });
  const finish = async (request: Request, failed: boolean) => {
    if (!isApiRequest(request)) return;
    pending.delete(request);
    const call = [...calls].reverse().find((candidate) => candidate.key === requestKey(request) && !candidate.finishedAt);
    if (!call) return;
    call.finishedAt = performance.now();
    call.failed = failed;
    const response = await request.response();
    call.status = response?.status();
    const header = response?.headers()["content-length"];
    if (header && /^\d+$/.test(header)) call.bytes = Number(header);
  };
  page.on("requestfinished", (request) => void finish(request, false));
  page.on("requestfailed", (request) => void finish(request, true));
  return { pending, calls };
}

async function waitForApiIdle(page: Page, pending: Set<Request>, timeoutMs = 20_000) {
  const startedAt = performance.now();
  let idleSince = pending.size === 0 ? performance.now() : 0;
  while (performance.now() - startedAt < timeoutMs) {
    if (pending.size === 0) {
      if (!idleSince) idleSince = performance.now();
      if (performance.now() - idleSince >= 250) return;
    } else {
      idleSince = 0;
    }
    await page.waitForTimeout(50);
  }
}

function summarizeCalls(calls: ApiCall[], fromIndex: number) {
  const slice = calls.slice(fromIndex);
  const counts = new Map<string, number>();
  for (const call of slice) counts.set(call.key, (counts.get(call.key) ?? 0) + 1);
  const durations = slice.flatMap((call) =>
    call.finishedAt ? [Math.round(call.finishedAt - call.startedAt)] : [],
  );
  const knownBytes = slice.flatMap((call) => (call.bytes === undefined ? [] : [call.bytes]));
  return {
    apiRequests: slice.length,
    duplicateRequests: [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([key, count]) => `${key} ×${count}`),
    apiBytes: knownBytes.length ? knownBytes.reduce((sum, value) => sum + value, 0) : null,
    slowestApiMs: durations.length ? Math.max(...durations) : null,
    failedRequests: slice
      .filter((call) => call.failed || (call.status !== undefined && call.status >= 400))
      .map((call) => `${call.key}=${call.failed ? "network" : call.status}`),
    apiBreakdown: slice
      .map((call) => ({
        key: call.key,
        duration: call.finishedAt ? Math.round(call.finishedAt - call.startedAt) : null,
        status: call.status,
      }))
      .sort((a, b) => (b.duration ?? Number.MAX_SAFE_INTEGER) - (a.duration ?? Number.MAX_SAFE_INTEGER))
      .map(
        (call) =>
          `${call.key}=${call.duration ?? "timeout"}ms${call.status ? `(${call.status})` : ""}`,
      ),
  };
}

async function measureClick(
  page: Page,
  tracker: ReturnType<typeof attachApiTracker>,
  role: string,
  pass: "first" | "repeat",
  label: string,
  path: string,
): Promise<Measurement> {
  await waitForApiIdle(page, tracker.pending);
  const callIndex = tracker.calls.length;
  const startedAt = performance.now();
  await page.getByRole("link", { name: label, exact: true }).click();
  await page.waitForURL((url) => url.pathname === path, { timeout: 20_000 });
  await page.locator("main").first().waitFor({ state: "visible", timeout: 20_000 });
  const visualMs = Math.round(performance.now() - startedAt);
  await waitForApiIdle(page, tracker.pending);
  const dataReadyMs = Math.round(performance.now() - startedAt);
  return {
    role,
    pass,
    label,
    path,
    visualMs,
    dataReadyMs,
    ...summarizeCalls(tracker.calls, callIndex),
  };
}

async function runRole(role: string) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "pt-BR" });
  const page = await context.newPage();
  const tracker = attachApiTracker(page);
  const errors: string[] = [];
  let blockedAnalyticsErrors = 0;
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/google|doubleclick|googletagmanager|pagead|rmkt\/collect|ccm\/collect/i.test(text)) {
      blockedAnalyticsErrors += 1;
      return;
    }
    errors.push(text.slice(0, 240));
  });
  page.on("pageerror", (error) => errors.push(error.message.slice(0, 240)));

  const entryStartedAt = performance.now();
  const entryCallIndex = tracker.calls.length;
  await page.goto(`${baseUrl}/demo/${role}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForURL((url) => url.pathname !== `/demo/${role}`, { timeout: 30_000 });
  await page.locator("main").first().waitFor({ state: "visible", timeout: 20_000 });
  const entryVisualMs = Math.round(performance.now() - entryStartedAt);
  await waitForApiIdle(page, tracker.pending);
  const entryDataReadyMs = Math.round(performance.now() - entryStartedAt);
  const entryCalls = summarizeCalls(tracker.calls, entryCallIndex);

  const available = [] as typeof routeCandidates;
  for (const candidate of routeCandidates) {
    const link = page.getByRole("link", { name: candidate.label, exact: true });
    if ((await link.count()) > 0) available.push(candidate);
  }

  const measurements: Measurement[] = [];
  for (const pass of ["first", "repeat"] as const) {
    for (const route of available) {
      if (new URL(page.url()).pathname !== "/dashboard") {
        const dashboard = page.getByRole("link", { name: "Dashboard", exact: true });
        if ((await dashboard.count()) > 0) await dashboard.click();
        else await page.goBack({ waitUntil: "domcontentloaded" });
        await page.waitForURL((url) => url.pathname === "/dashboard", { timeout: 20_000 });
        await waitForApiIdle(page, tracker.pending);
      }
      if (route.path === "/dashboard") continue;
      measurements.push(await measureClick(page, tracker, role, pass, route.label, route.path));
    }
  }

  await context.close();
  await browser.close();
  return {
    role,
    entry: { visualMs: entryVisualMs, dataReadyMs: entryDataReadyMs, ...entryCalls },
    measurements,
    blockedAnalyticsErrors,
    consoleErrors: [...new Set(errors)],
  };
}

const results = [];
for (const role of roles) results.push(await runRole(role));
if (process.env.NOX_AUDIT_FORMAT === "tsv") {
  process.stdout.write("role\tpass\tlabel\tvisual_ms\tdata_ready_ms\tapi_requests\tapi_bytes\tslowest_api_ms\tduplicates\tfailed_requests\tapi_breakdown\n");
  for (const result of results) {
    process.stdout.write(
      `${result.role}\tentry\tDashboard inicial\t${result.entry.visualMs}\t${result.entry.dataReadyMs}\t${result.entry.apiRequests}\t${result.entry.apiBytes ?? "?"}\t${result.entry.slowestApiMs ?? "-"}\t${result.entry.duplicateRequests.join("; ") || "-"}\t${result.entry.failedRequests.join("; ") || "-"}\t${result.entry.apiBreakdown.join("; ")}\n`,
    );
    for (const item of result.measurements) {
      process.stdout.write(
        [
          item.role,
          item.pass,
          item.label,
          item.visualMs,
          item.dataReadyMs,
          item.apiRequests,
          item.apiBytes ?? "?",
          item.slowestApiMs ?? "-",
          item.duplicateRequests.join("; ") || "-",
          item.failedRequests.join("; ") || "-",
          item.apiBreakdown.join("; ") || "-",
        ].join("\t") + "\n",
      );
    }
    process.stdout.write(
      `# ${result.role}: analytics_bloqueado=${result.blockedAnalyticsErrors}; erros_app=${JSON.stringify(result.consoleErrors)}\n`,
    );
  }
} else {
  process.stdout.write(`${JSON.stringify({ capturedAt: new Date().toISOString(), baseUrl, results }, null, 2)}\n`);
}
