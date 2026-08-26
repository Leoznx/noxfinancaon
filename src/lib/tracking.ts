/**
 * Pixels de marketing do site (Meta e Google Ads).
 *
 * O carregamento do código-base dos dois fica em `src/routes/__root.tsx`; aqui
 * ficam só os IDs e os disparos de evento, para que nenhuma tela precise
 * conhecer a API do `fbq`/`gtag` diretamente.
 */

export const META_PIXEL_ID = "1585883566320931";
export const GOOGLE_ADS_TAG_ID = "AW-18391707457";
export const GOOGLE_ADS_SIGNUP_DESTINATION =
  "AW-18391707457/1MnBCKjjtOgcEMHe7MFE";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    fbq?: ((...args: unknown[]) => void) & { queue?: unknown[] };
    _fbq?: unknown;
  }
}

/** PageView em navegação de SPA — o carregamento inicial já é contado pelo código-base. */
export function trackPageView() {
  if (typeof window === "undefined") return;

  window.gtag?.("event", "page_view", {
    page_location: window.location.href,
    page_title: document.title,
    send_to: GOOGLE_ADS_TAG_ID,
  });
  window.fbq?.("track", "PageView");
}

/**
 * Conversão de cadastro concluído. Disparada uma única vez por usuário, na tela
 * `/cadastro-concluido` — é essa URL que os dois pixels registram.
 */
export function trackCadastroConcluido() {
  if (typeof window === "undefined") return;

  window.fbq?.("track", "CompleteRegistration");

  window.gtag?.("event", "sign_up", { send_to: GOOGLE_ADS_TAG_ID });
  window.gtag?.("event", "conversion", {
    send_to: GOOGLE_ADS_SIGNUP_DESTINATION,
    value: 1.0,
    currency: "BRL",
  });
}
