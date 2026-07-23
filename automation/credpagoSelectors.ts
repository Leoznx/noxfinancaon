import type { Page, Locator } from "playwright";

// Teto/intervalo de poll pra dar tempo do formulário (SPA) terminar de hidratar
// antes de desistir de achar um campo/botão. Sem isso, uma checagem única logo
// após "domcontentloaded" corre atrás do JS que ainda está montando a UI — no
// desktop do usuário (Chrome com aceleração de hardware, headed) isso quase
// sempre vencia a corrida por sorte; num container headless de VPS (mais lento
// pra renderizar/hidratar) a mesma checagem única passou a falhar direto no
// primeiro botão da tela ("Pessoa Física"), mesmo com a sessão/login corretos.
const FIND_TIMEOUT_MS = 8000;
const FIND_POLL_MS = 200;
const LOGIN_LOFT_URL_PATTERN = /(?:^https?:\/\/sso\.loft\.com\.br\/|\/realms\/loft\/)/i;

/**
 * Tenta localizar um campo por várias estratégias, na ordem: label, placeholder,
 * role+name. Necessário porque o site da CredPago pode alterar atributos
 * técnicos (id/name) sem aviso — preferimos o texto visível ao usuário. Faz
 * polling até FIND_TIMEOUT_MS em vez de checar uma única vez (ver comentário
 * acima de FIND_TIMEOUT_MS).
 */
async function locateField(
  page: Page,
  opts: {
    label?: RegExp | string;
    placeholder?: RegExp | string;
    role?: { name: RegExp | string };
  },
): Promise<Locator> {
  const candidates: Locator[] = [];
  if (opts.label) candidates.push(page.getByLabel(opts.label));
  if (opts.placeholder) candidates.push(page.getByPlaceholder(opts.placeholder));
  if (opts.role) candidates.push(page.getByRole("textbox", { name: opts.role.name }));

  const inicio = Date.now();
  do {
    for (const candidate of candidates) {
      const count = await candidate.count().catch(() => 0);
      if (count > 0) {
        const first = candidate.first();
        if (await first.isVisible().catch(() => false)) return first;
      }
    }
    await page.waitForTimeout(FIND_POLL_MS);
  } while (Date.now() - inicio < FIND_TIMEOUT_MS);

  throw new Error(
    `Campo não encontrado (label=${opts.label ?? "-"}, placeholder=${opts.placeholder ?? "-"}). O layout da CredPago pode ter mudado.`,
  );
}

async function clickButtonByText(page: Page, textos: (string | RegExp)[]): Promise<void> {
  const inicio = Date.now();
  do {
    for (const t of textos) {
      const byRole = page.getByRole("button", { name: t });
      if (
        (await byRole.count().catch(() => 0)) > 0 &&
        (await byRole
          .first()
          .isVisible()
          .catch(() => false))
      ) {
        await byRole.first().click();
        return;
      }
      const byText = page.getByText(t, { exact: false });
      if (
        (await byText.count().catch(() => 0)) > 0 &&
        (await byText
          .first()
          .isVisible()
          .catch(() => false))
      ) {
        await byText.first().click();
        return;
      }
    }
    await page.waitForTimeout(FIND_POLL_MS);
  } while (Date.now() - inicio < FIND_TIMEOUT_MS);

  // Diagnóstico temporário (ver DIAGNOSTICO_HEADLESS.md) — nunca deve conter
  // dados do cliente, só o suficiente pra saber o que a CredPago realmente
  // devolveu nesta tentativa (detecção de headless? captcha fora do padrão
  // já checado? página completamente diferente?).
  const urlAtual = page.url();
  const amostraTexto = await page
    .locator("body")
    .innerText()
    .then((t) => t.replace(/\s+/g, " ").trim().slice(0, 400))
    .catch(() => "(não foi possível ler o corpo da página)");
  throw new Error(
    `Botão não encontrado (tentativas: ${textos.map(String).join(", ")}). O layout da CredPago pode ter mudado. ` +
      `[diagnóstico] url=${urlAtual} | amostra="${amostraTexto}"`,
  );
}

export async function fillPessoa(page: Page, tipo: "PF" | "PJ"): Promise<void> {
  const textos =
    tipo === "PF"
      ? [/pessoa\s+f[ií]sica/i, /^\s*pf\s*$/i]
      : [/pessoa\s+jur[ií]dica/i, /^\s*pj\s*$/i];
  await clickButtonByText(page, textos);
}

export async function fillDocumento(
  page: Page,
  documento: string,
  tipo: "PF" | "PJ",
): Promise<void> {
  const field = await locateField(page, {
    label: tipo === "PF" ? /cpf/i : /cnpj/i,
    placeholder: tipo === "PF" ? /cpf/i : /cnpj/i,
    role: { name: tipo === "PF" ? /cpf/i : /cnpj/i },
  });
  await field.fill(documento);
}

export async function fillTipoImovel(page: Page, tipo: "Residencial" | "Comercial"): Promise<void> {
  await clickButtonByText(page, [new RegExp(tipo, "i")]);
}

/**
 * Preenche o CEP e aguarda o autocomplete de endereço (ex.: "Blumenau, SC") aparecer,
 * em vez de um `waitForTimeout` fixo — sai assim que detectar a cidade/UF resolvida
 * (deixa a automação mais rápida no caminho feliz), com um teto de segurança para
 * o caso do autocomplete não existir ou não responder.
 */
export async function fillCep(page: Page, cep: string): Promise<void> {
  const field = await locateField(page, {
    label: /cep/i,
    placeholder: /cep/i,
    role: { name: /cep/i },
  });
  await field.fill(cep);

  const TETO_MS = 2500;
  const POLL_MS = 150;
  const inicio = Date.now();
  while (Date.now() - inicio < TETO_MS) {
    const texto = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    // Restringe a checagem ao trecho entre os rótulos "CEP" e "Valores" (onde a
    // CredPago mostra a cidade/UF resolvida, ex.: "Blumenau, SC") — evita falso
    // positivo com algum outro "Texto, UF" que já exista em outra parte da página.
    const trechoCep = texto.split(/\bCEP\b/i)[1]?.split(/\bValores\b/i)[0] ?? "";
    if (/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]*,\s*[A-Z]{2}\b/.test(trechoCep)) return;
    await page.waitForTimeout(POLL_MS);
  }
}

export async function fillValores(
  page: Page,
  valores: { aluguel: number; condominio: number; taxas: number },
): Promise<void> {
  const aluguelField = await locateField(page, {
    label: /aluguel/i,
    placeholder: /aluguel/i,
    role: { name: /aluguel/i },
  });
  await aluguelField.fill(String(valores.aluguel));

  if (valores.condominio > 0) {
    try {
      const condominioField = await locateField(page, {
        label: /condom[ií]nio/i,
        placeholder: /condom[ií]nio/i,
        role: { name: /condom[ií]nio/i },
      });
      await condominioField.fill(String(valores.condominio));
    } catch {
      // campo opcional em alguns formulários — não bloqueia a simulação
    }
  }

  if (valores.taxas > 0) {
    try {
      const taxasField = await locateField(page, {
        label: /taxas?/i,
        placeholder: /taxas?/i,
        role: { name: /taxas?/i },
      });
      await taxasField.fill(String(valores.taxas));
    } catch {
      // campo opcional
    }
  }
}

export async function submitSimulation(page: Page): Promise<void> {
  await clickButtonByText(page, [/simular\s+cr[ée]dito/i, /simular/i]);
}

export async function isLoginPage(page: Page): Promise<boolean> {
  if (LOGIN_LOFT_URL_PATTERN.test(page.url()) || /login|signin|entrar/i.test(page.url())) {
    return true;
  }

  const loginLoftButton = page.getByRole("button", { name: /login\s+loft/i });
  if (
    (await loginLoftButton.count().catch(() => 0)) > 0 &&
    (await loginLoftButton
      .first()
      .isVisible()
      .catch(() => false))
  ) {
    return true;
  }

  const senhaField = page.getByLabel(/senha|password/i);
  return (
    (await senhaField.count().catch(() => 0)) > 0 &&
    (await senhaField
      .first()
      .isVisible()
      .catch(() => false))
  );
}

async function waitUntil(
  page: Page,
  predicate: () => Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  const inicio = Date.now();
  do {
    if (await predicate().catch(() => false)) return true;
    await page.waitForTimeout(FIND_POLL_MS);
  } while (Date.now() - inicio < timeoutMs);
  return false;
}

async function isAuthenticatedCredPagoPage(page: Page): Promise<boolean> {
  let hostname = "";
  try {
    hostname = new URL(page.url()).hostname;
  } catch {
    return false;
  }
  if (hostname !== "credpago.com" && !hostname.endsWith(".credpago.com")) return false;

  const loginLoftButton = page.getByRole("button", { name: /login\s+loft/i });
  if (
    (await loginLoftButton.count().catch(() => 0)) > 0 &&
    (await loginLoftButton
      .first()
      .isVisible()
      .catch(() => false))
  ) {
    return false;
  }

  const senhaField = page.getByLabel(/senha|password/i);
  if (
    (await senhaField.count().catch(() => 0)) > 0 &&
    (await senhaField
      .first()
      .isVisible()
      .catch(() => false))
  ) {
    return false;
  }

  const bodyText = await page
    .locator("body")
    .innerText()
    .catch(() => "");
  return bodyText.trim().length > 0;
}

export async function detectAuthenticationState(
  page: Page,
  timeoutMs = FIND_TIMEOUT_MS,
): Promise<"authenticated" | "login" | "unknown"> {
  const inicio = Date.now();
  do {
    if (await isLoginPage(page)) return "login";
    if (await isAuthenticatedCredPagoPage(page)) return "authenticated";
    await page.waitForTimeout(FIND_POLL_MS);
  } while (Date.now() - inicio < timeoutMs);
  return "unknown";
}

/**
 * Refaz o login legítimo da conta da imobiliária quando a sessão da VPS expira.
 * As credenciais vêm exclusivamente de variáveis secretas do servidor; nunca são
 * gravadas no storageState, nos logs ou no repositório.
 */
export async function loginWithCredentials(
  page: Page,
  login: string,
  password: string,
  timeoutMs: number,
): Promise<void> {
  const initialState = await detectAuthenticationState(page, timeoutMs);
  if (initialState === "authenticated") return;
  if (initialState === "unknown") {
    throw new Error("A CredPago não informou se a sessão está autenticada.");
  }

  // A página pública da CredPago agora é uma porta de entrada para o SSO da Loft.
  const loginLoftButton = page.getByRole("button", { name: /login\s+loft/i });
  if (
    (await loginLoftButton.count().catch(() => 0)) > 0 &&
    (await loginLoftButton
      .first()
      .isVisible()
      .catch(() => false))
  ) {
    await loginLoftButton.first().click();
  }

  const formularioDisponivel = await waitUntil(
    page,
    async () => {
      const loginField = page.getByLabel(/e-?mail ou telefone|e-?mail|telefone/i);
      const senhaField = page.getByLabel(/senha|password/i);
      const loginFormReady =
        (await loginField.count().catch(() => 0)) > 0 &&
        (await senhaField.count().catch(() => 0)) > 0;
      return loginFormReady || (await isAuthenticatedCredPagoPage(page));
    },
    timeoutMs,
  );

  if (!formularioDisponivel) {
    throw new Error("O formulário do Login Loft não ficou disponível dentro do tempo esperado.");
  }
  if (await isAuthenticatedCredPagoPage(page)) return;

  const loginField = await locateField(page, {
    label: /e-?mail ou telefone|e-?mail|telefone/i,
    placeholder: /e-?mail ou telefone|e-?mail|telefone/i,
    role: { name: /e-?mail ou telefone|e-?mail|telefone/i },
  });
  const senhaField = await locateField(page, {
    label: /senha|password/i,
    placeholder: /\*{4,}|senha|password/i,
    role: { name: /senha|password/i },
  });

  await loginField.fill(login);
  await senhaField.fill(password);

  const entrarButton = page.getByRole("button", { name: /^entrar$/i });
  if ((await entrarButton.count().catch(() => 0)) === 0) {
    throw new Error("O botão Entrar do Login Loft não foi encontrado.");
  }
  await entrarButton.first().click({ timeout: timeoutMs });

  const autenticou = await waitUntil(
    page,
    async () => isAuthenticatedCredPagoPage(page),
    timeoutMs,
  );
  if (!autenticou) {
    const texto = await page
      .locator("body")
      .innerText()
      .then((value) => value.replace(/\s+/g, " ").trim().slice(0, 500))
      .catch(() => "");
    const motivo = /captcha|recaptcha|verifica/i.test(texto)
      ? "A Loft solicitou uma verificação de segurança durante o login."
      : "O Login Loft não confirmou as credenciais dentro do tempo esperado.";
    throw new Error(motivo);
  }
}

export async function isCaptchaPresent(page: Page): Promise<boolean> {
  const captcha = page.locator(
    'iframe[src*="recaptcha"], iframe[title*="captcha" i], [class*="captcha" i]',
  );
  return (await captcha.count().catch(() => 0)) > 0;
}
