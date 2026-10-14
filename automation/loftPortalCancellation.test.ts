import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import {
  cancelLoftProposalViaPortal,
  listLoftProposalIdsForDocument,
  listLoftProposalsForDocument,
  LOFT_PROPOSALS_URL,
  LoftPortalCancellationError,
  probeLoftProposalCancellationPortal,
  resolveLoftProposalReconciliation,
  resolveSingleNewLoftProposalId,
} from "./loftPortalCancellation";

let browser: Browser;

before(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
  });
});

after(async () => {
  await browser?.close();
});

function proposalRow(input: {
  id: string;
  document: string;
  createdAt: string;
  status?: string;
  tab?: "active" | "sent" | "cancelled" | "delayed";
}): string {
  return `<tr data-proposal-id="${input.id}" data-tab="${input.tab ?? "active"}"${input.tab && input.tab !== "active" ? " hidden" : ""}>
    <td><a href="/fianca-aluguel/imobiliaria/proposta/${input.id}">${input.id}</a></td>
    <td>CLIENTE TESTE<br />CPF: ${input.document}</td>
    <td>R$ 1.900,00</td>
    <td class="situation">${input.status ?? "Rascunho • Aprovado"}</td>
    <td>${input.createdAt}</td>
    <td><button type="button">Continuar</button><button type="button" aria-label="Ações da proposta ${input.id}">⋮</button></td>
  </tr>`;
}

function pageHtml(
  rows: string,
  confirmSuccess = true,
  cancelledRows = "",
  cancelledTabWorks = true,
): string {
  return `<!doctype html><html lang="pt-BR"><body>
    <button id="sent-tab" role="tab" type="button">Enviadas aguardando ativação</button>
    <button id="cancelled-tab" role="tab" type="button">Canceladas</button>
    <label>Proposta, nome/razão social, CPF/CNPJ ou tag
      <input id="search" placeholder="Proposta, nome/razão social, CPF/CNPJ ou tag" />
    </label>
    <label>Situação
      <select aria-label="Situação"><option>Todos</option></select>
    </label>
    <button id="search-button" type="button">Pesquisar</button>
    <table>
      <thead><tr><th>Proposta</th><th>Cliente</th><th>Valor locatício</th><th>Situação</th><th>Criação</th><th>Ações</th></tr></thead>
      <tbody>${rows}${cancelledRows}</tbody>
    </table>
    <div id="menu" role="menu" hidden><button role="menuitem" type="button">Cancelar proposta</button></div>
    <div id="dialog" role="dialog" aria-label="Cancelar proposta" hidden>
      <h2>Cancelar proposta</h2>
      <label>Motivo
        <select id="reason">
          <option value="" disabled selected>Selecione o motivo</option>
          <option value="desistencia">Inquilino desistiu do aluguel</option>
          <option value="outra-garantia">Inquilino vai usar outro tipo de garantia</option>
        </select>
      </label>
      <label>Comentário opcional<textarea id="comment" placeholder="Comentário opcional"></textarea></label>
      <button type="button">Voltar</button>
      <button id="confirm" type="button">Confirmar cancelamento</button>
    </div>
    <div id="notice" role="alert"></div>
    <script>
      let activeRow = null;
      const onlyDigits = (value) => String(value || '').replace(/\\D/g, '');
      const applyFilter = () => {
        const query = onlyDigits(document.querySelector('#search').value);
        document.querySelectorAll('tbody tr').forEach((row) => {
          const selectedTab = document.body.dataset.tab || 'active';
          row.hidden = row.dataset.tab !== selectedTab || !onlyDigits(row.textContent).includes(query);
        });
      };
      document.querySelector('#search-button').addEventListener('click', applyFilter);
      document.querySelector('#sent-tab').addEventListener('click', () => {
        document.body.dataset.tab = 'sent';
        applyFilter();
      });
      document.querySelector('#cancelled-tab').addEventListener('click', () => {
        ${
          cancelledTabWorks
            ? "document.body.dataset.tab = 'cancelled';"
            : "document.body.dataset.tab = 'active'; document.querySelectorAll('[data-tab=delayed]').forEach((row) => { row.dataset.tab = 'active'; });"
        }
        applyFilter();
      });
      document.querySelectorAll('button[aria-label^="Ações"]').forEach((button) => {
        button.addEventListener('click', () => {
          activeRow = button.closest('tr');
          document.querySelector('#menu').hidden = false;
        });
      });
      document.querySelector('[role="menuitem"]').addEventListener('click', () => {
        document.querySelector('#menu').hidden = true;
        document.querySelector('#dialog').hidden = false;
      });
      document.querySelector('#confirm').addEventListener('click', () => {
        document.body.dataset.cancelledId = activeRow.dataset.proposalId;
        document.body.dataset.selectedReason = document.querySelector('#reason').value;
        document.body.dataset.comment = document.querySelector('#comment').value;
        document.querySelector('#dialog').hidden = true;
        ${
          confirmSuccess
            ? `activeRow.querySelector('.situation').textContent = 'Cancelada';
        document.querySelector('#notice').textContent = 'Proposta cancelada com sucesso.';`
            : ""
        }
      });
    </script>
  </body></html>`;
}

async function pageWithHtml(html: string): Promise<Page> {
  const page = await browser.newPage();
  await page.route(LOFT_PROPOSALS_URL, (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }),
  );
  return page;
}

test("aguarda a hidratação da pesquisa antes de declarar o cancelamento indisponível", async () => {
  const page = await pageWithHtml(`<!doctype html><html lang="pt-BR"><body>
    <main id="root"><p>Carregando propostas...</p></main>
    <script>
      setTimeout(() => {
        document.querySelector('#root').innerHTML = \`
          <label>Proposta, nome/razão social, CPF/CNPJ ou tag
            <input id="search" placeholder="Proposta, nome/razão social, CPF/CNPJ ou tag" />
          </label>
          <button type="button" id="search-button">Pesquisar</button>
          <table><thead><tr><th>Proposta</th></tr></thead><tbody></tbody></table>
        \`;
      }, 350);
    </script>
  </body></html>`);

  await probeLoftProposalCancellationPortal(page, 1_500);
  await page.close();
});

test("cancela somente o ID exato, seleciona o motivo configurado e preenche o comentário", async () => {
  const page = await pageWithHtml(
    pageHtml(
      [
        proposalRow({ id: "4789594", document: "792.531.729-91", createdAt: "13/10/2026" }),
        proposalRow({ id: "4789356", document: "792.531.729-91", createdAt: "12/10/2026" }),
      ].join(""),
    ),
  );

  const result = await cancelLoftProposalViaPortal(page, {
    proposalId: "4789594",
    document: "79253172991",
    reason: "Inquilino vai usar outro tipo de garantia",
    comment: "Simulação criada automaticamente pela NOX.",
    timeoutMs: 1_000,
    onProposalResolved: async (proposalId) => {
      assert.equal(proposalId, "4789594");
      assert.equal(await page.locator("body").getAttribute("data-cancelled-id"), null);
    },
  });

  assert.deepEqual(result, {
    proposalId: "4789594",
    status: "Cancelado",
    cancellationReason: "Inquilino vai usar outro tipo de garantia",
  });
  assert.equal(await page.locator("body").getAttribute("data-cancelled-id"), "4789594");
  assert.equal(await page.locator("body").getAttribute("data-selected-reason"), "outra-garantia");
  assert.equal(
    await page.locator("body").getAttribute("data-comment"),
    "Simulação criada automaticamente pela NOX.",
  );
  await page.close();
});

test("usa a primeira opção real e devolve o rótulo efetivamente selecionado", async () => {
  const page = await pageWithHtml(
    pageHtml(proposalRow({ id: "4789594", document: "792.531.729-91", createdAt: "13/10/2026" })),
  );

  const result = await cancelLoftProposalViaPortal(page, {
    proposalId: "4789594",
    document: "79253172991",
    reason: "Motivo que não existe mais na tela",
    timeoutMs: 1_000,
  });

  assert.equal(result.cancellationReason, "Inquilino desistiu do aluguel");
  assert.equal(await page.locator("body").getAttribute("data-selected-reason"), "desistencia");
  await page.close();
});

test("repete a navegação oficial uma vez quando o SSO redireciona na primeira abertura", async () => {
  const page = await browser.newPage();
  let officialNavigations = 0;
  await page.route("**/*", (route) => {
    const requestUrl = new URL(route.request().url());
    if (
      requestUrl.origin === "https://app.loft.com.br" &&
      requestUrl.pathname === "/fianca-aluguel/imobiliaria/view/index.php"
    ) {
      officialNavigations += 1;
      if (officialNavigations === 1) {
        return route.fulfill({
          status: 200,
          contentType: "text/html",
          body: '<script>window.location.replace("https://login.example.test/session")</script>',
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: pageHtml(
          proposalRow({ id: "4789594", document: "792.531.729-91", createdAt: "13/10/2026" }),
        ),
      });
    }
    if (requestUrl.origin === "https://login.example.test") {
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<p>Login transitório</p>",
      });
    }
    return route.abort("blockedbyclient");
  });

  const result = await cancelLoftProposalViaPortal(page, {
    proposalId: "4789594",
    document: "79253172991",
    reason: "Inquilino desistiu do aluguel",
    timeoutMs: 5_000,
  });

  assert.equal(result.proposalId, "4789594");
  assert.equal(officialNavigations, 2);
  await page.close();
});

test("falha fechado quando as duas navegações saem da lista oficial", async () => {
  const page = await browser.newPage();
  let officialNavigations = 0;
  await page.route("**/*", (route) => {
    const requestUrl = new URL(route.request().url());
    if (
      requestUrl.origin === "https://app.loft.com.br" &&
      requestUrl.pathname === "/fianca-aluguel/imobiliaria/view/index.php"
    ) {
      officialNavigations += 1;
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: '<script>window.location.replace("https://login.example.test/session")</script>',
      });
    }
    if (requestUrl.origin === "https://login.example.test") {
      return route.fulfill({ status: 200, contentType: "text/html", body: "<p>Login</p>" });
    }
    return route.abort("blockedbyclient");
  });

  await assert.rejects(
    () =>
      cancelLoftProposalViaPortal(page, {
        proposalId: "4789594",
        document: "79253172991",
        reason: "Inquilino desistiu do aluguel",
        timeoutMs: 5_000,
      }),
    (error: unknown) =>
      error instanceof LoftPortalCancellationError && /sessão não permaneceu/i.test(error.message),
  );
  assert.equal(officialNavigations, 2);
  await page.close();
});

test("lista somente IDs visíveis que correspondem exatamente ao CPF", async () => {
  const page = await pageWithHtml(
    pageHtml(
      [
        proposalRow({ id: "4789594", document: "792.531.729-91", createdAt: "13/10/2026" }),
        proposalRow({ id: "4788303", document: "792.531.729-91", createdAt: "10/10/2026" }),
        proposalRow({ id: "4787000", document: "023.640.362-16", createdAt: "09/10/2026" }),
      ].join(""),
    ),
  );

  const ids = await listLoftProposalIdsForDocument(page, "79253172991", 1_000);

  assert.deepEqual(ids, ["4789594", "4788303"]);
  await page.close();
});

test("cria o snapshot reunindo propostas iniciadas, enviadas e canceladas", async () => {
  const page = await pageWithHtml(
    pageHtml(
      proposalRow({ id: "4788303", document: "792.531.729-91", createdAt: "10/10/2026" }),
      true,
      [
        proposalRow({
          id: "4789594",
          document: "792.531.729-91",
          createdAt: "13/10/2026",
          tab: "sent",
        }),
        proposalRow({
          id: "4787000",
          document: "792.531.729-91",
          createdAt: "09/10/2026",
          status: "Cancelada",
          tab: "cancelled",
        }),
      ].join(""),
    ),
  );

  const ids = await listLoftProposalIdsForDocument(page, "79253172991", 1_000);

  assert.deepEqual(ids, ["4788303", "4789594", "4787000"]);
  await page.close();
});

test("classifica como terminais todas as propostas encontradas na aba Canceladas", async () => {
  const page = await pageWithHtml(
    pageHtml(
      proposalRow({ id: "4788303", document: "792.531.729-91", createdAt: "10/10/2026" }),
      true,
      [
        proposalRow({
          id: "4789594",
          document: "792.531.729-91",
          createdAt: "13/10/2026",
          status: "Reprovado",
          tab: "cancelled",
        }),
        proposalRow({
          id: "4787000",
          document: "792.531.729-91",
          createdAt: "09/10/2026",
          status: "Cancelada",
          tab: "cancelled",
        }),
      ].join(""),
    ),
  );

  const proposals = await listLoftProposalsForDocument(page, "79253172991", 1_000);

  assert.deepEqual(proposals, [
    { proposalId: "4788303", terminal: false },
    { proposalId: "4789594", terminal: true },
    { proposalId: "4787000", terminal: true },
  ]);
  await page.close();
});

test("aceita uma tabela carregada e vazia como snapshot sem propostas anteriores", async () => {
  const page = await pageWithHtml(pageHtml(""));

  const ids = await listLoftProposalIdsForDocument(page, "79253172991", 2_500);

  assert.deepEqual(ids, []);
  await page.close();
});

test("aceita a linha vazia usada atualmente pela Loft como snapshot sem propostas", async () => {
  const page = await pageWithHtml(
    pageHtml('<tr><td colspan="6">Você não tem propostas pendentes</td></tr>'),
  );

  const ids = await listLoftProposalIdsForDocument(page, "79253172991", 2_500);

  assert.deepEqual(ids, []);
  await page.close();
});

test("resolve somente uma proposta nova em relação ao snapshot anterior", () => {
  assert.equal(
    resolveSingleNewLoftProposalId(["4788303", "4789594", "4789594"], ["4788303"]),
    "4789594",
  );
  assert.equal(resolveSingleNewLoftProposalId(["4788303"], ["4788303"]), null);
  assert.throws(
    () => resolveSingleNewLoftProposalId(["4789594", "4789700"], []),
    (error: unknown) =>
      error instanceof LoftPortalCancellationError &&
      /mais de uma proposta nova/i.test(error.message),
  );
});

test("encerra sem clique quando todas as novas candidatas já são terminais", () => {
  assert.deepEqual(
    resolveLoftProposalReconciliation(
      [
        { proposalId: "4789594", terminal: true },
        { proposalId: "4789700", terminal: true },
      ],
      [],
    ),
    {
      kind: "already-terminal",
      proposalIds: ["4789594", "4789700"],
    },
  );
  assert.deepEqual(
    resolveLoftProposalReconciliation(
      [
        { proposalId: "4788303", terminal: true },
        { proposalId: "4789594", terminal: false },
      ],
      ["4788303"],
    ),
    { kind: "attach", proposalId: "4789594" },
  );
  assert.throws(
    () =>
      resolveLoftProposalReconciliation(
        [
          { proposalId: "4789594", terminal: true },
          { proposalId: "4789700", terminal: false },
        ],
        [],
      ),
    (error: unknown) =>
      error instanceof LoftPortalCancellationError &&
      /ao menos uma ainda ativa/i.test(error.message),
  );
});

test("sem ID exato falha fechado mesmo quando o CPF possui propostas novas", async () => {
  const page = await pageWithHtml(
    pageHtml(
      [
        proposalRow({ id: "4789594", document: "792.531.729-91", createdAt: "13/10/2026" }),
        proposalRow({ id: "4789000", document: "792.531.729-91", createdAt: "12/10/2026" }),
        proposalRow({ id: "4788303", document: "792.531.729-91", createdAt: "10/10/2026" }),
        proposalRow({ id: "4787000", document: "023.640.362-16", createdAt: "09/10/2026" }),
      ].join(""),
    ),
  );

  await assert.rejects(
    () =>
      cancelLoftProposalViaPortal(page, {
        proposalId: "",
        document: "79253172991",
        reason: "Inquilino desistiu do aluguel",
        timeoutMs: 500,
      }),
    (error: unknown) =>
      error instanceof LoftPortalCancellationError && /identificador exato/i.test(error.message),
  );
  assert.equal(await page.locator("body").getAttribute("data-cancelled-id"), null);
  await page.close();
});

test("falha ao persistir o ID interrompe o fluxo antes do clique destrutivo", async () => {
  const page = await pageWithHtml(
    pageHtml(
      [
        proposalRow({ id: "4789594", document: "792.531.729-91", createdAt: "13/10/2026" }),
        proposalRow({ id: "4788303", document: "792.531.729-91", createdAt: "10/10/2026" }),
      ].join(""),
    ),
  );

  await assert.rejects(
    () =>
      cancelLoftProposalViaPortal(page, {
        proposalId: "4789594",
        document: "79253172991",
        reason: "Inquilino desistiu do aluguel",
        onProposalResolved: async () => {
          throw new Error("banco indisponível");
        },
        timeoutMs: 500,
      }),
    /banco indisponível/i,
  );
  assert.equal(await page.locator("body").getAttribute("data-cancelled-id"), null);
  assert.equal(await page.locator("#dialog").isHidden(), true);
  await page.close();
});

test("não abre ações quando o ID exato não está entre os resultados", async () => {
  const page = await pageWithHtml(
    pageHtml(proposalRow({ id: "4789594", document: "792.531.729-91", createdAt: "13/10/2026" })),
  );

  await assert.rejects(
    () =>
      cancelLoftProposalViaPortal(page, {
        proposalId: "9999999",
        document: "79253172991",
        reason: "Inquilino desistiu do aluguel",
        timeoutMs: 500,
      }),
    (error: unknown) =>
      error instanceof LoftPortalCancellationError &&
      /nem entre as propostas ativas/i.test(error.message),
  );
  assert.equal(await page.locator("body").getAttribute("data-cancelled-id"), null);
  assert.equal(await page.locator("#dialog").isHidden(), true);
  await page.close();
});

test("não retorna sucesso sem confirmação visível nem estado cancelado", async () => {
  const page = await pageWithHtml(
    pageHtml(
      proposalRow({ id: "4789594", document: "792.531.729-91", createdAt: "13/10/2026" }),
      false,
    ),
  );

  await assert.rejects(
    () =>
      cancelLoftProposalViaPortal(page, {
        proposalId: "4789594",
        document: "79253172991",
        reason: "Inquilino desistiu do aluguel",
        timeoutMs: 500,
      }),
    (error: unknown) =>
      error instanceof LoftPortalCancellationError && /não exibiu confirmação/i.test(error.message),
  );
  assert.equal(await page.locator("body").getAttribute("data-cancelled-id"), "4789594");

  // Simula a situação real em que a Loft aceitou a ação, mas a resposta visual
  // se perdeu: no retry, o mesmo ID já aparece em Canceladas enquanto outra
  // proposta do mesmo CPF continua ativa.
  await page.unroute(LOFT_PROPOSALS_URL);
  await page.route(LOFT_PROPOSALS_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: pageHtml(
        proposalRow({ id: "4789700", document: "792.531.729-91", createdAt: "13/10/2026" }),
        true,
        proposalRow({
          id: "4789594",
          document: "792.531.729-91",
          createdAt: "13/10/2026",
          status: "Cancelada",
          tab: "cancelled",
        }),
      ),
    }),
  );

  const retryResult = await cancelLoftProposalViaPortal(page, {
    proposalId: "4789594",
    document: "79253172991",
    reason: "Inquilino desistiu do aluguel",
    timeoutMs: 500,
  });
  assert.equal(retryResult.proposalId, "4789594");
  assert.equal(retryResult.cancellationReason, null);
  assert.equal(await page.locator("body").getAttribute("data-cancelled-id"), null);
  assert.equal(await page.locator("#menu").isHidden(), true);
  await page.close();
});

test("reconhece de forma idempotente uma proposta já cancelada sem abrir o menu", async () => {
  const page = await pageWithHtml(
    pageHtml(
      proposalRow({
        id: "4789594",
        document: "792.531.729-91",
        createdAt: "13/10/2026",
        status: "Cancelada",
      }),
    ),
  );

  const result = await cancelLoftProposalViaPortal(page, {
    proposalId: "4789594",
    document: "79253172991",
    reason: "Inquilino desistiu do aluguel",
    timeoutMs: 1_000,
  });

  assert.equal(result.status, "Cancelado");
  assert.equal(result.cancellationReason, null);
  assert.equal(await page.locator("body").getAttribute("data-cancelled-id"), null);
  assert.equal(await page.locator("#menu").isHidden(), true);
  await page.close();
});

test("reconhece proposta reprovada na aba Canceladas como terminal sem abrir o menu", async () => {
  const page = await pageWithHtml(
    pageHtml(
      "",
      true,
      proposalRow({
        id: "4789594",
        document: "792.531.729-91",
        createdAt: "13/10/2026",
        status: "Reprovada",
        tab: "cancelled",
      }),
    ),
  );

  const result = await cancelLoftProposalViaPortal(page, {
    proposalId: "4789594",
    document: "79253172991",
    reason: "Inquilino desistiu do aluguel",
    timeoutMs: 500,
  });

  assert.equal(result.status, "Cancelado");
  assert.equal(result.cancellationReason, null);
  assert.equal(await page.locator("body").getAttribute("data-cancelled-id"), null);
  assert.equal(await page.locator("#menu").isHidden(), true);
  await page.close();
});

test("retry encontra o mesmo ID na aba Canceladas e não abre outra linha", async () => {
  const page = await pageWithHtml(
    pageHtml(
      proposalRow({ id: "4789700", document: "792.531.729-91", createdAt: "13/10/2026" }),
      true,
      proposalRow({
        id: "4789594",
        document: "792.531.729-91",
        createdAt: "13/10/2026",
        status: "Cancelada",
        tab: "cancelled",
      }),
    ),
  );

  const result = await cancelLoftProposalViaPortal(page, {
    proposalId: "4789594",
    document: "79253172991",
    reason: "Inquilino desistiu do aluguel",
    timeoutMs: 500,
  });

  assert.equal(result.proposalId, "4789594");
  assert.equal(result.cancellationReason, null);
  assert.equal(await page.locator("body").getAttribute("data-cancelled-id"), null);
  assert.equal(await page.locator("#menu").isHidden(), true);
  await page.close();
});

test("não presume cancelamento quando o clique em Canceladas mantém uma linha ativa", async () => {
  const page = await pageWithHtml(
    pageHtml(
      proposalRow({
        id: "4789594",
        document: "792.531.729-91",
        createdAt: "13/10/2026",
        status: "Rascunho • Aprovado",
        tab: "delayed",
      }),
      true,
      "",
      false,
    ),
  );

  await assert.rejects(
    () =>
      cancelLoftProposalViaPortal(page, {
        proposalId: "4789594",
        document: "79253172991",
        reason: "Inquilino desistiu do aluguel",
        timeoutMs: 500,
      }),
    (error: unknown) =>
      error instanceof LoftPortalCancellationError && /não confirmou o estado/i.test(error.message),
  );
  assert.equal(await page.locator("body").getAttribute("data-cancelled-id"), null);
  assert.equal(await page.locator("#menu").isHidden(), true);
  await page.close();
});
