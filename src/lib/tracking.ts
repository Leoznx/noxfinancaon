import { isDemoSimulationEmail } from "./demo-simulation";
/**
 * Pixels de marketing do site (Meta e Google Ads).
 *
 * A raiz inicia os pixels somente após resolver Auth. Este módulo mantém
 * a barreira de identidade, as filas existentes e os disparos de evento,
 * para que as telas não precisem conhecer fbq/gtag diretamente.
 */

let trackingSessionResolved = false;
let trackingDemo = false;
let trackingInitialized = false;
let reloadRequested = false;

function trackingAllowed() {
  return (
    typeof window !== "undefined" &&
    trackingSessionResolved &&
    !trackingDemo &&
    !reloadRequested &&
    !window.location.pathname.startsWith("/demo/")
  );
}

// Called synchronously by the SDK session observer, before profile/UI reconciliation.
export function syncTrackingSession(email: string | undefined) {
  trackingSessionResolved = true;
  trackingDemo = isDemoSimulationEmail(email);
  if (trackingDemo) prepareDemoTrackingDocument();
}

// Loaded third-party SDKs cannot be reliably unloaded. Discard their document
// before continuing a demo bootstrap/session; never send a consent/event command.
export function prepareDemoTrackingDocument() {
  if (typeof window === "undefined" || !trackingInitialized) return false;
  trackingDemo = true;
  if (!reloadRequested) {
    reloadRequested = true;
    window.location.reload();
  }
  return true;
}

export function initializeTracking() {
  if (!trackingAllowed() || trackingInitialized) return false;
  trackingInitialized = true;
  const target = window as Window & { dataLayer?: unknown[] };
  target.dataLayer = target.dataLayer || [];
  // Keep existing queues/functions, including any existing consent commands.
  target.gtag =
    target.gtag ||
    function () {
      // eslint-disable-next-line prefer-rest-params -- Preserve the vendor gtag command queue format.
      target.dataLayer!.push(arguments);
    };
  target.gtag("js", new Date());
  target.gtag("config", GOOGLE_ADS_TAG_ID);
  if (!target.fbq) {
    const pixel = function (...args: unknown[]) {
      if (pixel.callMethod) pixel.callMethod(...args);
      else pixel.queue.push(args);
    } as ((...args: unknown[]) => void) & {
      queue: unknown[][];
      callMethod?: (...args: unknown[]) => void;
      push?: unknown;
      loaded?: boolean;
      version?: string;
    };
    pixel.queue = [];
    pixel.push = pixel;
    pixel.loaded = true;
    pixel.version = "2.0";
    target.fbq = pixel;
    target._fbq = target._fbq || pixel;
  }
  target.fbq("init", META_PIXEL_ID);
  target.fbq("track", "PageView");
  for (const src of [
    `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_TAG_ID}`,
    "https://connect.facebook.net/en_US/fbevents.js",
  ]) {
    const script = document.createElement("script");
    script.async = true;
    script.src = src;
    document.head.appendChild(script);
  }
  return true;
}

export const META_PIXEL_ID = "1585883566320931";
export const GOOGLE_ADS_TAG_ID = "AW-18391707457";
export const GOOGLE_ADS_SIGNUP_DESTINATION = "AW-18391707457/1MnBCKjjtOgcEMHe7MFE";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    fbq?: ((...args: unknown[]) => void) & { queue?: unknown[] };
    _fbq?: unknown;
  }
}

/** PageView em navegação de SPA — o carregamento inicial já é contado pelo código-base. */
export function trackPageView() {
  if (!trackingAllowed()) return false;

  window.gtag?.("event", "page_view", {
    page_location: window.location.href,
    page_title: document.title,
    send_to: GOOGLE_ADS_TAG_ID,
  });
  window.fbq?.("track", "PageView");
  return true;
}

/**
 * Conversão de cadastro concluído. Disparada uma única vez por usuário, na tela
 * `/cadastro-concluido` — é essa URL que os dois pixels registram.
 */
export function trackCadastroConcluido() {
  if (!trackingAllowed()) return;

  window.fbq?.("track", "CompleteRegistration");

  window.gtag?.("event", "sign_up", { send_to: GOOGLE_ADS_TAG_ID });
  window.gtag?.("event", "conversion", {
    send_to: GOOGLE_ADS_SIGNUP_DESTINATION,
    value: 1.0,
    currency: "BRL",
  });
}
