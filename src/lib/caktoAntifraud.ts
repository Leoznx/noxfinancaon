/**
 * Carrega o SDK JS da Cakto no navegador e coleta a referência antifraude exigida
 * pela API em toda criação de cobrança (antifraudProfilingAttemptReference) — sem
 * ela a Cakto recusa a chamada com 400. Roda só no cliente; nunca usar server-side.
 *
 * Usa apenas a chave pública VITE_CAKTO_CLIENT_ID (nunca o client_secret).
 */

declare global {
  interface Window {
    Cakto?: { CaktoSDK: new (config: { client_id: string }) => CaktoSdkInstance };
  }
}

interface CaktoSdkInstance {
  initAntifraud?: () => Promise<void>;
  completeAntifraudProfile?: () => Promise<void>;
  getAntifraudReference?: () => string | undefined;
  getFingerprint?: () => string | undefined;
}

const SDK_URL = "https://cakto-sdk.pages.dev/cakto-sdk.min.js";

let sdkPromise: Promise<CaktoSdkInstance> | null = null;

function carregarScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${SDK_URL}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Falha ao carregar o SDK da Cakto."));
    document.head.appendChild(script);
  });
}

function obterSdk(): Promise<CaktoSdkInstance> {
  if (!sdkPromise) {
    sdkPromise = carregarScript().then(() => {
      const clientId = import.meta.env.VITE_CAKTO_CLIENT_ID as string | undefined;
      if (!clientId) throw new Error("VITE_CAKTO_CLIENT_ID não configurado.");
      if (!window.Cakto) throw new Error("SDK da Cakto não carregou corretamente.");
      return new window.Cakto.CaktoSDK({ client_id: clientId });
    });
  }
  return sdkPromise;
}

/** Fallback só usado se o SDK não expuser um método próprio de fingerprint. */
function fingerprintLocal(): string {
  const KEY = "nox_device_fp";
  let semente = localStorage.getItem(KEY);
  if (!semente) {
    semente = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(KEY, semente);
  }
  const bruto = [
    navigator.userAgent,
    screen.width,
    screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    semente,
  ].join("|");
  return bruto.replace(/[^a-zA-Z0-9]/g, "").slice(0, 128);
}

export interface PerfilAntifraude {
  antifraudProfilingAttemptReference: string;
  fingerprint: string;
}

export async function coletarPerfilAntifraude(): Promise<PerfilAntifraude> {
  try {
    const sdk = await obterSdk();
    await sdk.initAntifraud?.();
    await sdk.completeAntifraudProfile?.();
    const reference = sdk.getAntifraudReference?.();
    const fingerprint = sdk.getFingerprint?.() || fingerprintLocal();
    if (!reference) throw new Error("SDK não retornou uma referência antifraude.");
    return { antifraudProfilingAttemptReference: reference, fingerprint };
  } catch (err) {
    throw new Error(
      `Não foi possível preparar a verificação de segurança do pagamento (${err instanceof Error ? err.message : "erro desconhecido"}).`,
    );
  }
}

/** Pré-aquece o SDK/antifraude em segundo plano (chamar quando a etapa de pagamento abrir). */
export function preAquecerAntifraude(): void {
  obterSdk()
    .then((sdk) => sdk.initAntifraud?.())
    .catch(() => {
      // silencioso — se falhar aqui, a tentativa real (no clique de "Pagar") vai
      // reexecutar e mostrar o erro pro usuário se persistir.
    });
}
