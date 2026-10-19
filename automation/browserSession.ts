import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
} from "playwright";
import {
  fingerprintSessionFile,
  loadStorageStateWithFallback,
  sameFingerprint,
  sessionHasProviderCookies,
  writeStorageStateAtomically,
  type SessionFileFingerprint,
} from "./sessionStore";

/**
 * Dono do navegador/contexto do worker. Concentra o que antes estava espalhado
 * e frágil em `abrirContexto`/`fecharContexto`:
 *
 * - o contexto nunca é aberto a partir de um arquivo corrompido (o estado é
 *   validado e passado como objeto; se o Chromium ainda o rejeitar, a sessão
 *   começa limpa em vez de derrubar o worker);
 * - `persist()` só grava uma sessão autenticada, de forma atômica, e nunca
 *   sobrescreve um arquivo que uma pessoa acabou de substituir;
 * - `isAlive()` permite detectar um Chromium morto ANTES de usá-lo, em vez de
 *   descobrir pelo erro "Target page, context or browser has been closed".
 */

export interface BrowserSessionConfig {
  /** Arquivo `storageState`. Vazio = perfil persistente local (modo desenvolvimento). */
  storageStatePath: string;
  profileDir: string;
  headless: boolean;
  viewport?: { width: number; height: number };
  info: (message: string) => void;
  warn: (message: string, error?: unknown) => void;
}

const DEFAULT_VIEWPORT = { width: 1366, height: 900 };

/** Formato que o Playwright aceita em `newContext({ storageState })` (objeto, não caminho). */
export type PlaywrightStorageState = Exclude<
  BrowserContextOptions["storageState"],
  string | undefined
>;

export class BrowserSession {
  /** Preenchido quando o arquivo de sessão mudou no disco sem ter sido gravado por este processo. */
  externalUpdatePending = false;
  readonly loadedFrom: "primary" | "backup" | "none" | "profile";

  private closed = false;
  private disconnected = false;
  private authenticated = false;
  private persistInFlight: Promise<boolean> | null = null;
  private knownFingerprint: SessionFileFingerprint | null;

  private constructor(
    readonly context: BrowserContext,
    readonly browser: Browser | null,
    private readonly config: BrowserSessionConfig,
    loadedFrom: BrowserSession["loadedFrom"],
    fingerprint: SessionFileFingerprint | null,
  ) {
    this.loadedFrom = loadedFrom;
    this.knownFingerprint = fingerprint;
    browser?.on("disconnected", () => {
      this.disconnected = true;
    });
    context.on("close", () => {
      this.disconnected = true;
    });
  }

  static async open(config: BrowserSessionConfig): Promise<BrowserSession> {
    const viewport = config.viewport ?? DEFAULT_VIEWPORT;

    if (!config.storageStatePath) {
      try {
        const context = await chromium.launchPersistentContext(config.profileDir, {
          headless: config.headless,
          viewport,
        });
        return new BrowserSession(context, null, config, "profile", null);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/lock|already in use|singleton|profile.*use/i.test(message)) {
          throw new Error(
            `Não foi possível abrir o perfil do Chrome em ${config.profileDir} — ele já está em uso por outro processo ` +
              `(outra execução do worker, ou uma janela do Chrome aberta manualmente nessa mesma pasta). ` +
              `Feche o outro processo/janela e rode o worker de novo. Detalhe técnico: ${message}`,
          );
        }
        throw error;
      }
    }

    const loaded = await loadStorageStateWithFallback(config.storageStatePath, {
      warn: (message) => config.warn(message),
    });
    if (loaded.source === "none") {
      config.info(
        "Nenhuma sessão salva utilizável — o navegador inicia sem login e tentará renová-lo.",
      );
    } else {
      config.info(
        `Usando sessão portátil (${loaded.source === "backup" ? "backup" : "arquivo principal"}): ${config.storageStatePath}`,
      );
    }

    const browser = await chromium.launch({ headless: config.headless });
    let context: BrowserContext;
    try {
      context = await browser.newContext({
        // Já validado por sessionStore: o Chromium nunca recebe um arquivo corrompido.
        ...(loaded.state ? { storageState: loaded.state as unknown as PlaywrightStorageState } : {}),
        viewport,
      });
    } catch (error) {
      if (!loaded.state) {
        await browser.close().catch(() => {});
        throw error;
      }
      config.warn(
        "O Chromium rejeitou o estado de sessão; iniciando sem sessão para renovar o login.",
        error,
      );
      try {
        context = await browser.newContext({ viewport });
      } catch (retryError) {
        await browser.close().catch(() => {});
        throw retryError;
      }
    }

    return new BrowserSession(context, browser, config, loaded.source, loaded.fingerprint);
  }

  /** Forma esperada pelas rotinas do worker que recebem um `() => Promise<void>`. */
  readonly persistirSessao = async (): Promise<void> => {
    await this.persist();
  };

  isAlive(): boolean {
    if (this.closed || this.disconnected) return false;
    return this.browser ? this.browser.isConnected() : true;
  }

  /** Informa se o login atual está confirmado; só então a sessão em memória é gravada. */
  markAuthenticated(value: boolean): void {
    this.authenticated = value;
  }

  /** Detecta que alguém substituiu o arquivo de sessão (por exemplo, após um novo login manual). */
  async detectExternalUpdate(): Promise<boolean> {
    if (!this.config.storageStatePath || this.closed) return false;
    if (this.externalUpdatePending) return true;
    const onDisk = await fingerprintSessionFile(this.config.storageStatePath);
    if (!onDisk) return false;
    if (!sameFingerprint(onDisk, this.knownFingerprint)) this.externalUpdatePending = true;
    return this.externalUpdatePending;
  }

  /**
   * Grava a sessão atual. Retorna `true` somente quando o arquivo foi atualizado.
   * Não grava quando: o login não está confirmado, o arquivo foi trocado por uma
   * pessoa, o contexto não responde ou o estado não contém cookies do provedor.
   */
  async persist(options: { force?: boolean } = {}): Promise<boolean> {
    if (!this.config.storageStatePath || this.closed || !this.isAlive()) return false;
    if (!this.authenticated && !options.force) return false;
    if (this.persistInFlight) return this.persistInFlight;

    this.persistInFlight = (async () => {
      const path = this.config.storageStatePath;
      if (await this.detectExternalUpdate()) {
        this.config.info(
          "O arquivo de sessão foi substituído externamente; ele será preservado e recarregado.",
        );
        return false;
      }

      let lastError: unknown;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const state = await this.context.storageState();
          if (!sessionHasProviderCookies({ cookies: state.cookies, origins: state.origins })) {
            this.config.info(
              "A sessão atual não contém cookies do provedor; o arquivo salvo foi preservado.",
            );
            return false;
          }
          this.knownFingerprint = await writeStorageStateAtomically(path, {
            cookies: state.cookies,
            origins: state.origins,
          });
          return true;
        } catch (error) {
          lastError = error;
          if (!this.isAlive()) break;
          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
        }
      }
      // O contexto pode estar no meio de uma navegação; a próxima gravação periódica tenta de novo.
      this.config.warn("Não foi possível salvar a sessão agora; tentaremos novamente.", lastError);
      return false;
    })().finally(() => {
      this.persistInFlight = null;
    });

    return this.persistInFlight;
  }

  async close(options: { persist?: boolean } = {}): Promise<void> {
    if (this.closed) return;
    if (options.persist) await this.persist().catch(() => false);
    this.closed = true;
    await this.context.close().catch(() => {});
    if (this.browser) await this.browser.close().catch(() => {});
  }
}
