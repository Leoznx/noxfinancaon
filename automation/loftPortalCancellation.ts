import type { Locator, Page } from "playwright";

export const LOFT_PROPOSALS_URL =
  "https://app.loft.com.br/fianca-aluguel/imobiliaria/view/index.php";

const DEFAULT_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 200;
const TERMINAL_PROPOSAL_PATTERN = /\b(?:cancelad[ao]|exclu[ií]d[ao]|reprovad[ao]|recusad[ao])\b/i;
const SUCCESS_PATTERN =
  /(?:proposta[^\n]{0,80}(?:cancelad[ao]|exclu[ií]d[ao])[^\n]{0,80}(?:sucesso|êxito)|(?:cancelamento|exclus[aã]o)[^\n]{0,80}(?:conclu[ií]d[ao]|realizad[ao]|sucesso)|proposta\s+(?:foi\s+)?(?:cancelad[ao]|exclu[ií]d[ao]))/i;
const PLACEHOLDER_REASON_PATTERN =
  /^(?:selecione|selecionar|escolha|escolher|informe|motivo|--|-)\b/i;

interface LoftPortalCancellationOptions {
  /** Identificador visível/técnico capturado no próprio envio da proposta. */
  proposalId: string;
  /** CPF/CNPJ usado apenas como validação adicional da linha exata. */
  document?: string | null;
  /** Motivo fixo aprovado para o fluxo. Se não existir na tela, usa a primeira opção real. */
  reason?: string | null;
  /** Comentário opcional; é preenchido somente quando a tela oferecer esse campo. */
  comment?: string | null;
  /** Persiste o ID resolvido antes de qualquer clique destrutivo. Falha interrompe a ação. */
  onProposalResolved?: (proposalId: string) => Promise<void>;
  timeoutMs?: number;
  proposalsUrl?: string;
}

interface LoftPortalCancellationResult {
  proposalId: string;
  document: string | null;
  selectedReason: string | null;
  alreadyCancelled: boolean;
}

export class LoftPortalCancellationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LoftPortalCancellationError";
  }
}

interface ProposalRowSnapshot {
  proposalId: string | null;
  documents: string[];
  createdText: string | null;
  statusText: string | null;
  text: string;
}

interface ProposalCandidate extends ProposalRowSnapshot {
  row: Locator;
}

function digits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeProposalId(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return /^\d{4,12}$/.test(normalized) ? normalized : null;
}

export function resolveSingleNewLoftProposalId(
  visibleProposalIds: readonly string[],
  knownProposalIds: readonly string[],
): string | null {
  const known = new Set(
    knownProposalIds
      .map((proposalId) => normalizeProposalId(proposalId))
      .filter((proposalId): proposalId is string => Boolean(proposalId)),
  );
  const newProposalIds = Array.from(
    new Set(
      visibleProposalIds
        .map((proposalId) => normalizeProposalId(proposalId))
        .filter((proposalId): proposalId is string => Boolean(proposalId)),
    ),
  ).filter((proposalId) => !known.has(proposalId));

  if (newProposalIds.length === 0) return null;
  if (newProposalIds.length > 1) {
    throw new LoftPortalCancellationError(
      "A lista exibiu mais de uma proposta nova para o mesmo CPF/CNPJ; nenhuma identidade foi presumida.",
    );
  }
  return newProposalIds[0];
}

export interface LoftProposalSummary {
  proposalId: string;
  terminal: boolean;
}

export type LoftProposalReconciliation =
  { kind: "attach"; proposalId: string } | { kind: "already-terminal"; proposalIds: string[] };

export function resolveLoftProposalReconciliation(
  visibleProposals: readonly LoftProposalSummary[],
  knownProposalIds: readonly string[],
): LoftProposalReconciliation | null {
  const known = new Set(
    knownProposalIds
      .map((proposalId) => normalizeProposalId(proposalId))
      .filter((proposalId): proposalId is string => Boolean(proposalId)),
  );
  const unseen = new Map<string, LoftProposalSummary>();
  for (const proposal of visibleProposals) {
    const proposalId = normalizeProposalId(proposal.proposalId);
    if (!proposalId || known.has(proposalId)) continue;
    const previous = unseen.get(proposalId);
    unseen.set(proposalId, {
      proposalId,
      terminal: Boolean(previous?.terminal || proposal.terminal),
    });
  }

  const newProposals = Array.from(unseen.values());
  if (newProposals.length === 0) return null;
  if (newProposals.length === 1) {
    return { kind: "attach", proposalId: newProposals[0].proposalId };
  }
  if (newProposals.every((proposal) => proposal.terminal)) {
    return {
      kind: "already-terminal",
      proposalIds: newProposals.map((proposal) => proposal.proposalId),
    };
  }
  throw new LoftPortalCancellationError(
    "A lista exibiu mais de uma proposta nova e ao menos uma ainda ativa; nenhuma identidade foi presumida.",
  );
}

function normalizeDocument(value: unknown): string | null {
  const normalized = digits(value);
  return /^(?:\d{11}|\d{14})$/.test(normalized) ? normalized : null;
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

function validateProposalsUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new LoftPortalCancellationError("A URL da lista de propostas da Loft é inválida.", {
      cause: error,
    });
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "app.loft.com.br" ||
    !/^\/fianca-aluguel\/imobiliaria\/view\/index\.php\/?$/i.test(url.pathname)
  ) {
    throw new LoftPortalCancellationError(
      "O cancelamento foi interrompido porque a URL não pertence à lista oficial de propostas da Loft.",
    );
  }
  return url.toString();
}

async function firstVisible(locators: Locator[]): Promise<Locator | null> {
  for (const locator of locators) {
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
  }
  return null;
}

async function proposalRows(page: Page): Promise<Locator> {
  const tableRows = page.locator("tbody tr");
  if ((await tableRows.count().catch(() => 0)) > 0) return tableRows;
  return page.locator('[role="row"]').filter({ has: page.locator('td, [role="cell"]') });
}

async function readRowSnapshot(row: Locator): Promise<ProposalRowSnapshot> {
  return row.evaluate((element) => {
    // Keep this browser callback free of named local helpers. Transpilers such as
    // esbuild/tsx can otherwise inject Node-only `__name` references into it.
    const text = String(element.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const table = element.closest("table");
    const headers = table
      ? Array.from(table.querySelectorAll("thead th, thead [role='columnheader']")).map((header) =>
          String(header.textContent ?? "")
            .replace(/\s+/g, " ")
            .trim(),
        )
      : [];
    const cells = Array.from(element.querySelectorAll(":scope > td, :scope > [role='cell']"));
    const proposalColumn = headers.findIndex((header) => /^proposta$/i.test(header));
    const createdColumn = headers.findIndex((header) =>
      /cria(?:ç|c)[aã]o|criado\s+em/i.test(header),
    );
    const statusColumn = headers.findIndex((header) =>
      /^(?:status|situa(?:ç|c)[aã]o|resultado)$/i.test(header),
    );

    let proposalId: string | null = null;
    for (const anchor of Array.from(element.querySelectorAll("a[href]"))) {
      const href = anchor.getAttribute("href") ?? "";
      const hrefMatch =
        href.match(/\/(?:proposta|proposal)(?:\/[^/?#]+)*\/(\d{4,12})(?:\/|$|[?#])/i) ??
        href.match(/[?&](?:proposalId|proposal_id|proposta|id_proposta)=(\d{4,12})(?:&|$)/i);
      const anchorDigits = String(anchor.textContent ?? "").replace(/\D/g, "");
      if (hrefMatch) {
        proposalId = hrefMatch[1];
        break;
      }
      if (/^\d{4,12}$/.test(anchorDigits)) {
        proposalId = anchorDigits;
        break;
      }
    }
    if (!proposalId && proposalColumn >= 0 && cells[proposalColumn]) {
      const proposalDigits = String(cells[proposalColumn].textContent ?? "").replace(/\D/g, "");
      if (/^\d{4,12}$/.test(proposalDigits)) proposalId = proposalDigits;
    }
    if (!proposalId) {
      proposalId = text.match(/\bproposta\s*(?:n[º°o.]*)?\s*[:#-]?\s*(\d{4,12})\b/i)?.[1] ?? null;
    }

    const documents = new Set<string>();
    for (const match of text.matchAll(/(?:CPF|CNPJ)\s*:?\s*([0-9.\-/]{11,20})/gi)) {
      const document = String(match[1] ?? "").replace(/\D/g, "");
      if (document.length === 11 || document.length === 14) documents.add(document);
    }
    for (const match of text.matchAll(
      /\b(\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/g,
    )) {
      documents.add(String(match[1] ?? "").replace(/\D/g, ""));
    }

    const explicitCreatedAt =
      element.getAttribute("data-created-at") ??
      element.querySelector("time[datetime]")?.getAttribute("datetime") ??
      null;
    const createdText =
      String(explicitCreatedAt ?? "")
        .replace(/\s+/g, " ")
        .trim() ||
      (createdColumn >= 0 && cells[createdColumn]
        ? String(cells[createdColumn].textContent ?? "")
            .replace(/\s+/g, " ")
            .trim()
        : (text.match(/\b\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\b/)?.[0] ?? "")) ||
      null;

    const statusText =
      statusColumn >= 0 && cells[statusColumn]
        ? String(cells[statusColumn].textContent ?? "")
            .replace(/\s+/g, " ")
            .trim() || null
        : null;

    return { proposalId, documents: Array.from(documents), createdText, statusText, text };
  });
}

function isTerminalProposal(candidate: ProposalRowSnapshot): boolean {
  return TERMINAL_PROPOSAL_PATTERN.test(candidate.statusText ?? candidate.text);
}

async function readVisibleCandidates(page: Page): Promise<ProposalCandidate[]> {
  const rows = await proposalRows(page);
  const candidates: ProposalCandidate[] = [];
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    if (!(await row.isVisible().catch(() => false))) continue;
    const snapshot = await readRowSnapshot(row);
    if (!snapshot.proposalId && snapshot.documents.length === 0) continue;
    candidates.push({ ...snapshot, row });
  }
  return candidates;
}

async function waitForExactCandidate(
  page: Page,
  proposalId: string,
  timeoutMs: number,
): Promise<ProposalCandidate | null> {
  const deadline = Date.now() + timeoutMs;
  do {
    const candidates = await readVisibleCandidates(page);
    const matches = candidates.filter((candidate) => candidate.proposalId === proposalId);
    if (matches.length === 1) {
      // Troca o nth(index), que muda de alvo se a tabela for reordenada, por
      // um locator ancorado no próprio ID sempre que o DOM oferecer essa chave.
      const anchoredRows = page.locator(
        `tbody tr[data-proposal-id="${proposalId}"], [role="row"][data-proposal-id="${proposalId}"]`,
      );
      const visibleAnchored: Locator[] = [];
      for (let index = 0; index < (await anchoredRows.count()); index += 1) {
        const row = anchoredRows.nth(index);
        if (await row.isVisible().catch(() => false)) visibleAnchored.push(row);
      }
      if (visibleAnchored.length === 1) {
        return { ...(await readRowSnapshot(visibleAnchored[0])), row: visibleAnchored[0] };
      }

      const exactLinks = page.getByRole("link", { name: proposalId, exact: true });
      const visibleLinkedRows: Locator[] = [];
      for (let index = 0; index < (await exactLinks.count()); index += 1) {
        const row = exactLinks.nth(index).locator("xpath=ancestor::tr[1]");
        if (await row.isVisible().catch(() => false)) visibleLinkedRows.push(row);
      }
      if (visibleLinkedRows.length === 1) {
        return { ...(await readRowSnapshot(visibleLinkedRows[0])), row: visibleLinkedRows[0] };
      }
      return matches[0];
    }
    if (matches.length > 1) {
      throw new LoftPortalCancellationError(
        `A lista devolveu mais de uma linha para a proposta ${proposalId}; nenhuma ação foi executada.`,
      );
    }
    await page.waitForTimeout(POLL_INTERVAL_MS);
  } while (Date.now() < deadline);
  return null;
}

async function findSearchInput(page: Page, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Locator> {
  const deadline = Date.now() + Math.max(500, timeoutMs);
  do {
    const input = await firstVisible([
      page.getByRole("textbox", {
        name: /proposta|nome|raz[aã]o social|cpf\/?cnpj|cpf|cnpj|tag/i,
      }),
      page.getByPlaceholder(/proposta|nome|raz[aã]o social|cpf\/?cnpj|cpf|cnpj|tag/i),
      page.locator('input[type="search"]'),
    ]);
    if (input) return input;
    await page.waitForTimeout(POLL_INTERVAL_MS);
  } while (Date.now() < deadline);

  throw new LoftPortalCancellationError(
    "O campo de pesquisa da lista de propostas não foi encontrado após a página terminar de carregar.",
  );
}

async function submitSearch(page: Page, input: Locator): Promise<void> {
  const button = await firstVisible([
    page.getByRole("button", { name: /^(?:pesquisar|buscar)$/i }),
    page.locator('button[type="submit"]'),
  ]);
  if (button) await button.click();
  else await input.press("Enter");
  // Dá ao filtro assíncrono a chance de substituir a tabela antes de lermos as linhas.
  await page.waitForTimeout(POLL_INTERVAL_MS);
}

const ACTIVE_PROPOSAL_TAB_PATTERNS = [
  /^iniciadas\s+aguardando\s+envio(?:\s*\d+)?$/i,
  /^enviadas\s+aguardando\s+ativa[cç][aã]o(?:\s*\d+)?$/i,
] as const;

async function findProposalTab(page: Page, name: RegExp): Promise<Locator | null> {
  return firstVisible([
    page.getByRole("tab", { name }),
    page.getByRole("button", { name }),
    page.getByText(name, { exact: true }),
  ]);
}

async function searchProposalTab(
  page: Page,
  tab: Locator,
  query: string,
  timeoutMs: number,
): Promise<void> {
  await tab.click();
  await page.waitForTimeout(POLL_INTERVAL_MS);
  const searchInput = await findSearchInput(page, timeoutMs);
  await searchInput.fill(query);
  await submitSearch(page, searchInput);
}

async function searchOtherActiveTabsForExactCandidate(
  page: Page,
  proposalId: string,
  timeoutMs: number,
): Promise<ProposalCandidate | null> {
  for (const pattern of ACTIVE_PROPOSAL_TAB_PATTERNS) {
    const tab = await findProposalTab(page, pattern);
    if (!tab || (await tab.getAttribute("aria-selected")) === "true") continue;
    await searchProposalTab(page, tab, proposalId, timeoutMs);
    const candidate = await waitForExactCandidate(page, proposalId, timeoutMs);
    if (candidate) return candidate;
  }
  return null;
}

async function navigateAndSearchProposals(
  page: Page,
  query: string,
  timeoutMs: number,
  proposalsUrl = LOFT_PROPOSALS_URL,
): Promise<void> {
  const officialUrl = validateProposalsUrl(proposalsUrl);
  let reachedOfficialPage = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto(officialUrl, {
      waitUntil: "domcontentloaded",
      timeout: Math.min(timeoutMs, 30_000),
    });
    try {
      validateProposalsUrl(page.url());
      reachedOfficialPage = true;
      break;
    } catch {
      // O SSO legado pode concluir a sessão no primeiro redirecionamento. Uma
      // segunda navegação explícita à URL oficial é segura e espelha o fluxo de
      // consulta já usado pelo worker; qualquer outro destino continua rejeitado.
    }
  }
  if (!reachedOfficialPage) {
    throw new LoftPortalCancellationError(
      "A sessão não permaneceu na lista de propostas da Loft; verifique a autenticação antes de cancelar.",
    );
  }

  const searchInput = await findSearchInput(page, timeoutMs);
  await searchInput.fill(query);
  await submitSearch(page, searchInput);
}

async function searchCancelledTab(
  page: Page,
  proposalId: string,
  timeoutMs: number,
): Promise<ProposalCandidate | null> {
  const tab = await firstVisible([
    page.getByRole("tab", { name: /^canceladas(?:\s+\d+)?$/i }),
    page.getByRole("button", { name: /^canceladas(?:\s+\d+)?$/i }),
    page.getByText(/^canceladas(?:\s+\d+)?$/i, { exact: true }),
  ]);
  if (!tab) return null;
  await tab.click();
  await page.waitForTimeout(POLL_INTERVAL_MS);
  const searchInput = await findSearchInput(page, timeoutMs);
  await searchInput.fill(proposalId);
  await submitSearch(page, searchInput);
  const candidate = await waitForExactCandidate(page, proposalId, timeoutMs);
  if (!candidate) return null;
  if (!isTerminalProposal(candidate)) {
    throw new LoftPortalCancellationError(
      `A aba Canceladas não confirmou o estado terminal da proposta ${proposalId}; nenhuma ação foi presumida como concluída.`,
    );
  }
  return candidate;
}

async function waitForVisibleProposalIdsForDocument(
  page: Page,
  document: string,
  timeoutMs: number,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  let lastSignature: string | null = null;
  let stableSince = Date.now();
  let lastIds: string[] = [];
  const stableWindowMs = Math.min(1_500, Math.max(600, Math.floor(timeoutMs / 3)));

  do {
    const candidates = await readVisibleCandidates(page);
    const ids = Array.from(
      new Set(
        candidates
          .filter((candidate): candidate is ProposalCandidate & { proposalId: string } =>
            Boolean(candidate.proposalId && candidate.documents.includes(document)),
          )
          .map((candidate) => candidate.proposalId),
      ),
    );
    const signature = ids.join("|");
    if (signature !== lastSignature) stableSince = Date.now();
    lastSignature = signature;
    lastIds = ids;

    const noResults = await firstVisible([
      page.getByText(
        /nenhuma proposta|nenhum resultado|n[aã]o encontramos propostas|(?:voc[eê]\s+)?n[aã]o (?:tem|h[aá]) propostas pendentes|sem propostas pendentes/i,
      ),
    ]);
    const rows = await proposalRows(page);
    let visibleRowCount = 0;
    for (let index = 0; index < (await rows.count()); index += 1) {
      if (
        await rows
          .nth(index)
          .isVisible()
          .catch(() => false)
      )
        visibleRowCount += 1;
    }
    const resultsTable = await firstVisible([
      page.locator("table").filter({ has: page.getByText(/^proposta$/i, { exact: true }) }),
      page.locator("table"),
    ]);
    const loading = await firstVisible([
      page.getByRole("progressbar"),
      page.locator('[aria-busy="true"]'),
      page.getByText(/carregando|buscando propostas/i),
    ]);
    const explicitEmptyTable = Boolean(resultsTable && !loading && visibleRowCount === 0);
    if (Date.now() - stableSince >= stableWindowMs) {
      if (ids.length > 0) return ids;
      if (noResults || explicitEmptyTable) return [];
    }
    await page.waitForTimeout(POLL_INTERVAL_MS);
  } while (Date.now() < deadline);

  if (lastIds.length > 0) return lastIds;
  throw new LoftPortalCancellationError(
    "A lista de propostas não confirmou se o CPF/CNPJ possui resultados; o envio foi interrompido para preservar propostas anteriores.",
  );
}

async function assertCandidateStillMatches(
  candidate: ProposalCandidate,
  expectedProposalId: string,
  expectedDocument: string | null,
): Promise<void> {
  if (!(await candidate.row.isVisible().catch(() => false))) {
    throw new LoftPortalCancellationError(
      "A linha selecionada mudou antes do cancelamento; nenhuma ação foi executada.",
    );
  }
  const current = await readRowSnapshot(candidate.row);
  const same =
    current.proposalId === expectedProposalId &&
    (!expectedDocument || current.documents.includes(expectedDocument));
  if (!same) {
    throw new LoftPortalCancellationError(
      "A linha selecionada não corresponde mais à proposta pesquisada; nenhuma ação foi executada.",
    );
  }
}

async function openActionsMenu(row: Locator): Promise<void> {
  const named = await firstVisible([
    row.getByRole("button", {
      name: /^(?:aç(?:ão|ões)|opç(?:ão|ões)|mais(?:\s+opç(?:ão|ões))?|abrir\s+menu)(?:\s+d[ae]\s+proposta.*)?$/i,
    }),
    row.locator(
      'button[aria-haspopup="menu"], button[aria-label*="ação" i], button[aria-label*="ações" i], button[aria-label*="opção" i], button[aria-label*="opções" i], button[title*="ação" i], button[title*="opção" i], [data-testid*="action" i] button, button[data-testid*="action" i]',
    ),
  ]);
  if (named) {
    await named.click();
    return;
  }

  const buttons = row.getByRole("button");
  const iconOnly: Locator[] = [];
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (!(await button.isVisible().catch(() => false))) continue;
    const innerText = await button.innerText().catch(() => "");
    const ariaLabel = (await button.getAttribute("aria-label")) ?? "";
    const title = (await button.getAttribute("title")) ?? "";
    const description = normalizeText(`${innerText} ${ariaLabel} ${title}`);
    if (/^(?:⋮|\.\.\.)$/.test(description)) {
      await button.click();
      return;
    }
    if (!description) iconOnly.push(button);
  }
  if (iconOnly.length === 1) {
    await iconOnly[0].click();
    return;
  }

  throw new LoftPortalCancellationError(
    "O menu de ações da proposta correta não foi identificado com segurança.",
  );
}

async function clickCancellationAction(page: Page): Promise<void> {
  const actionName = /^(?:cancelar|excluir)(?:\s+(?:a\s+)?proposta)?$/i;
  const action = await firstVisible([
    page.getByRole("menuitem", { name: actionName }),
    page.getByRole("button", { name: actionName }),
    page.getByRole("link", { name: actionName }),
    page.getByText(actionName, { exact: true }),
  ]);
  if (!action) {
    throw new LoftPortalCancellationError(
      "A ação Cancelar/Excluir proposta não apareceu no menu da linha selecionada.",
    );
  }
  await action.click();
}

async function waitForCancellationScope(page: Page, timeoutMs: number): Promise<Locator> {
  const deadline = Date.now() + timeoutMs;
  do {
    const dialogs = page.getByRole("dialog");
    const dialogCount = await dialogs.count().catch(() => 0);
    for (let index = 0; index < dialogCount; index += 1) {
      const dialog = dialogs.nth(index);
      if (!(await dialog.isVisible().catch(() => false))) continue;
      const dialogText = normalizeText(await dialog.innerText().catch(() => ""));
      if (/\b(?:cancelar|excluir)\b/.test(dialogText)) return dialog;
    }

    const body = page.locator("body");
    const reasonControl = await firstVisible([
      body.getByLabel(/motivo|raz[aã]o/i),
      body.locator(
        'select[name*="motivo" i], select[name*="reason" i], select[id*="motivo" i], select[id*="reason" i], [role="combobox"][aria-label*="motivo" i], [role="combobox"][aria-label*="razão" i], input[type="radio"][name*="motivo" i], input[type="radio"][name*="reason" i]',
      ),
    ]);
    if (reasonControl) return body;
    await page.waitForTimeout(POLL_INTERVAL_MS);
  } while (Date.now() < deadline);

  throw new LoftPortalCancellationError(
    "O formulário de cancelamento não apareceu depois da ação selecionada.",
  );
}

interface SelectableReason {
  label: string;
  value: string;
  index: number;
}

function chooseReason(
  reasons: SelectableReason[],
  configuredReason: string | null,
): SelectableReason {
  const realReasons = reasons.filter(
    ({ label, value }) =>
      Boolean(value.trim()) &&
      Boolean(label.trim()) &&
      !PLACEHOLDER_REASON_PATTERN.test(label.trim()),
  );
  if (realReasons.length === 0) {
    throw new LoftPortalCancellationError(
      "Nenhum motivo real de cancelamento está disponível na tela.",
    );
  }
  if (configuredReason) {
    const configured = normalizeText(configuredReason);
    const exact = realReasons.find(({ label }) => normalizeText(label) === configured);
    if (exact) return exact;
  }
  return realReasons[0];
}

async function selectCancellationReason(
  page: Page,
  scope: Locator,
  configuredReason: string | null,
): Promise<string> {
  const labelledSelect = await firstVisible([
    scope.getByLabel(/motivo|raz[aã]o/i),
    scope.locator(
      'select[name*="motivo" i], select[name*="reason" i], select[id*="motivo" i], select[id*="reason" i]',
    ),
  ]);
  const nativeSelect =
    labelledSelect && (await labelledSelect.evaluate((element) => element.tagName === "SELECT"))
      ? labelledSelect
      : await firstVisible([scope.locator("select")]);
  if (nativeSelect) {
    const reasons = await nativeSelect.locator("option").evaluateAll((options) =>
      options
        .map((option, index) => ({
          label: (option.textContent ?? "").replace(/\s+/g, " ").trim(),
          value: (option as HTMLOptionElement).value,
          index,
          disabled: (option as HTMLOptionElement).disabled,
        }))
        .filter((option) => !option.disabled),
    );
    const selected = chooseReason(reasons, configuredReason);
    await nativeSelect.selectOption({ value: selected.value });
    return selected.label;
  }

  const combobox = await firstVisible([
    scope.getByRole("combobox", { name: /motivo|raz[aã]o/i }),
    scope.locator('[role="combobox"]'),
  ]);
  if (combobox) {
    await combobox.click();
    const optionLocator = page.getByRole("option");
    const reasons: SelectableReason[] = [];
    const count = await optionLocator.count();
    for (let index = 0; index < count; index += 1) {
      const option = optionLocator.nth(index);
      if (!(await option.isVisible().catch(() => false))) continue;
      if ((await option.getAttribute("aria-disabled")) === "true") continue;
      const label = (await option.innerText()).replace(/\s+/g, " ").trim();
      reasons.push({ label, value: label, index });
    }
    const selected = chooseReason(reasons, configuredReason);
    await optionLocator.nth(selected.index).click();
    return selected.label;
  }

  const radios = scope.getByRole("radio");
  const radioReasons: Array<SelectableReason & { radio: Locator }> = [];
  const radioCount = await radios.count();
  for (let index = 0; index < radioCount; index += 1) {
    const radio = radios.nth(index);
    if (!(await radio.isVisible().catch(() => false))) continue;
    if (await radio.isDisabled().catch(() => true)) continue;
    const label = await radio.evaluate((element) => {
      const id = element.getAttribute("id");
      const explicit = id
        ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent
        : null;
      return (
        explicit ??
        element.closest("label")?.textContent ??
        element.getAttribute("aria-label") ??
        (element as HTMLInputElement).value ??
        ""
      )
        .replace(/\s+/g, " ")
        .trim();
    });
    radioReasons.push({ label, value: label, index, radio });
  }
  const selectedRadio = chooseReason(radioReasons, configuredReason);
  await radioReasons.find(({ index }) => index === selectedRadio.index)!.radio.check();
  return selectedRadio.label;
}

async function fillOptionalComment(scope: Locator, comment: string | null): Promise<void> {
  if (!comment) return;
  const input = await firstVisible([
    scope.getByLabel(/coment[aá]rio|observa[cç][aã]o|detalhes?/i),
    scope.getByPlaceholder(/coment[aá]rio|observa[cç][aã]o|detalhes?/i),
    scope.locator("textarea"),
  ]);
  if (input) await input.fill(comment.slice(0, 500));
}

async function confirmCancellation(scope: Locator): Promise<void> {
  const confirmName =
    /^(?:confirmar(?:\s+(?:o\s+)?cancelamento)?|sim,?\s*(?:cancelar|excluir)|(?:cancelar|excluir)\s+(?:a\s+)?proposta)$/i;
  const button = await firstVisible([
    scope.getByRole("button", { name: confirmName }),
    scope.locator('button[type="submit"]'),
  ]);
  if (!button) {
    throw new LoftPortalCancellationError(
      "O botão de confirmação do cancelamento não foi encontrado.",
    );
  }
  await button.click();
}

async function hasVisibleSuccess(page: Page): Promise<boolean> {
  const candidates = [
    page.getByRole("alert"),
    page.getByRole("status"),
    page.locator('[class*="toast" i], [data-testid*="toast" i], [class*="notification" i]'),
    page.getByText(SUCCESS_PATTERN),
  ];
  for (const locator of candidates) {
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      if (!(await item.isVisible().catch(() => false))) continue;
      if (SUCCESS_PATTERN.test(await item.innerText().catch(() => ""))) return true;
    }
  }
  return false;
}

async function selectedRowIsCancelled(
  page: Page,
  selected: ProposalCandidate,
  document: string | null,
): Promise<boolean> {
  const candidates = await readVisibleCandidates(page);
  const sameRows = selected.proposalId
    ? candidates.filter((candidate) => candidate.proposalId === selected.proposalId)
    : candidates.filter(
        (candidate) =>
          Boolean(document && candidate.documents.includes(document)) &&
          candidate.createdText === selected.createdText,
      );
  return sameRows.some((candidate) => isTerminalProposal(candidate));
}

async function waitForCancellationConfirmation(
  page: Page,
  selected: ProposalCandidate,
  document: string | null,
  timeoutMs: number,
  acceptSuccessMessage: boolean,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (acceptSuccessMessage && (await hasVisibleSuccess(page))) return;
    if (await selectedRowIsCancelled(page, selected, document)) return;
    await page.waitForTimeout(POLL_INTERVAL_MS);
  } while (Date.now() < deadline);

  throw new LoftPortalCancellationError(
    "A Loft não exibiu confirmação de sucesso nem o estado cancelado para a proposta selecionada.",
  );
}

/**
 * Cancela exatamente uma proposta pela tela autenticada da Loft.
 *
 * O helper exige o ID capturado no próprio envio, identifica novamente a linha
 * antes do clique e exige confirmação positiva depois da ação. CPF/CNPJ nunca é
 * usado para escolher uma linha; serve apenas como revalidação adicional.
 */
async function cancelLoftProposalFromPortal(
  page: Page,
  options: LoftPortalCancellationOptions,
): Promise<LoftPortalCancellationResult> {
  const proposalId = normalizeProposalId(options.proposalId);
  const document = normalizeDocument(options.document);
  if (!proposalId) {
    throw new LoftPortalCancellationError(
      "O cancelamento exige o identificador exato capturado no envio; nenhuma ação foi executada.",
    );
  }

  const timeoutMs = Math.max(500, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  await navigateAndSearchProposals(page, proposalId, timeoutMs, options.proposalsUrl);

  let candidate = await waitForExactCandidate(page, proposalId, timeoutMs);
  let foundInCancelledTab = false;
  if (!candidate) {
    candidate = await searchOtherActiveTabsForExactCandidate(page, proposalId, timeoutMs);
  }
  if (!candidate) {
    candidate = await searchCancelledTab(page, proposalId, timeoutMs);
    foundInCancelledTab = Boolean(candidate);
  }
  if (!candidate) {
    throw new LoftPortalCancellationError(
      `A proposta ${proposalId} não apareceu nem entre as propostas ativas nem entre as canceladas; nenhuma ação foi executada.`,
    );
  }
  await assertCandidateStillMatches(candidate, proposalId, document);
  await options.onProposalResolved?.(proposalId);

  if (foundInCancelledTab || isTerminalProposal(candidate)) {
    return {
      proposalId,
      document,
      selectedReason: null,
      alreadyCancelled: true,
    };
  }

  await openActionsMenu(candidate.row);
  await clickCancellationAction(page);
  const scope = await waitForCancellationScope(page, timeoutMs);
  const selectedReason = await selectCancellationReason(
    page,
    scope,
    options.reason?.trim() || null,
  );
  await fillOptionalComment(scope, options.comment?.trim() || null);
  const candidateBeforeConfirmation = await waitForExactCandidate(
    page,
    proposalId,
    Math.min(timeoutMs, 2_000),
  );
  if (!candidateBeforeConfirmation) {
    throw new LoftPortalCancellationError(
      "A proposta exata deixou de estar visível antes da confirmação; nenhuma confirmação foi enviada.",
    );
  }
  await assertCandidateStillMatches(candidateBeforeConfirmation, proposalId, document);
  // Uma notificação antiga não pode confirmar esta ação. Se já havia uma mensagem
  // de sucesso visível, exigimos que a própria linha passe ao estado cancelado.
  const acceptSuccessMessage = !(await hasVisibleSuccess(page));
  await confirmCancellation(scope);
  await waitForCancellationConfirmation(page, candidate, document, timeoutMs, acceptSuccessMessage);

  return {
    proposalId,
    document,
    selectedReason,
    alreadyCancelled: false,
  };
}

export interface CancelLoftProposalViaPortalOptions {
  proposalId: string;
  document: string;
  reason: string;
  comment?: string;
  onProposalResolved?: (proposalId: string) => Promise<void>;
  timeoutMs?: number;
}

export interface CancelLoftProposalViaPortalResult {
  proposalId: string;
  status: string;
  cancellationReason: string | null;
}

/**
 * Captura as propostas visíveis que já pertencem ao CPF/CNPJ antes de uma nova simulação.
 * O retorno contém somente IDs exatos e o estado terminal extraído da linha correspondente.
 */
export async function listLoftProposalsForDocument(
  page: Page,
  document: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<LoftProposalSummary[]> {
  const normalizedDocument = normalizeDocument(document);
  if (!normalizedDocument) {
    throw new LoftPortalCancellationError("Informe um CPF/CNPJ válido para criar o snapshot.");
  }
  const boundedTimeout = Math.max(500, timeoutMs);
  await navigateAndSearchProposals(page, normalizedDocument, boundedTimeout);
  const proposals = new Map<string, LoftProposalSummary>();

  const collectCurrentTab = async (): Promise<void> => {
    const proposalIds = await waitForVisibleProposalIdsForDocument(
      page,
      normalizedDocument,
      boundedTimeout,
    );
    const candidates = await readVisibleCandidates(page);
    for (const proposalId of proposalIds) {
      const candidate = candidates.find(
        (item) => item.proposalId === proposalId && item.documents.includes(normalizedDocument),
      );
      const previous = proposals.get(proposalId);
      proposals.set(proposalId, {
        proposalId,
        terminal: Boolean(previous?.terminal || (candidate && isTerminalProposal(candidate))),
      });
    }
  };

  await collectCurrentTab();

  const tabPatterns = [...ACTIVE_PROPOSAL_TAB_PATTERNS, /^canceladas(?:\s*\d+)?$/i];
  for (const pattern of tabPatterns) {
    const tab = await findProposalTab(page, pattern);
    if (!tab || (await tab.getAttribute("aria-selected")) === "true") continue;
    await searchProposalTab(page, tab, normalizedDocument, boundedTimeout);
    await collectCurrentTab();
  }

  return Array.from(proposals.values());
}

export async function listLoftProposalIdsForDocument(
  page: Page,
  document: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string[]> {
  const proposals = await listLoftProposalsForDocument(page, document, timeoutMs);
  return proposals.map((proposal) => proposal.proposalId);
}

/** Valida URL e busca da superfície de cancelamento sem selecionar nem alterar propostas. */
export async function probeLoftProposalCancellationPortal(
  page: Page,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  const boundedTimeout = Math.max(500, timeoutMs);
  await navigateAndSearchProposals(page, "00000000000", boundedTimeout);
  validateProposalsUrl(page.url());
  await findSearchInput(page, boundedTimeout);
}

/** Interface mínima usada pelo worker para cancelar uma proposta já identificada. */
export async function cancelLoftProposalViaPortal(
  page: Page,
  options: CancelLoftProposalViaPortalOptions,
): Promise<CancelLoftProposalViaPortalResult> {
  const result = await cancelLoftProposalFromPortal(page, options);
  return {
    proposalId: result.proposalId,
    status: "Cancelado",
    cancellationReason: result.selectedReason,
  };
}
