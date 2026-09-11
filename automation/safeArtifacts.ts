import type { Page } from "playwright";
import { redactSensitiveText, sanitizeUrl } from "./redaction";
import type { SafeErrorArtifacts } from "./recoveryTypes";

/**
 * Coleta contexto limitado e seguro. Depois que a simulacao pode ter sido
 * enviada, screenshot e DOM sao omitidos para nunca persistir uma resposta de
 * credito ou dados pessoais devolvidos pelo parceiro.
 */
export async function captureSafeErrorArtifacts(
  page: Page | null,
  simulationSubmitted: boolean,
): Promise<SafeErrorArtifacts> {
  if (!page || page.isClosed()) return { screenshotSkippedReason: "A aba ja estava fechada." };

  const base: SafeErrorArtifacts = {
    url: sanitizeUrl(page.url()),
    pageTitle: redactSensitiveText(await page.title().catch(() => ""), 300),
  };
  if (simulationSubmitted) {
    return {
      ...base,
      screenshotSkippedReason: "Captura omitida apos o envio para proteger dados e resultado de credito.",
    };
  }

  // Nunca persiste o texto integral da pagina. Somente a estrutura estritamente
  // necessaria para diagnosticar o formulario, sem valores digitados, menus de
  // conta ou a resposta da analise de credito.
  const formOutline = await page
    .locator('input, select, textarea, button, label, [role="button"]')
    .evaluateAll((elements) =>
      elements.slice(0, 120).map((element) => ({
        tag: element.tagName.toLowerCase(),
        type: element.getAttribute("type"),
        name: element.getAttribute("name"),
        placeholder: element.getAttribute("placeholder"),
        ariaLabel: element.getAttribute("aria-label"),
        text:
          element.tagName === "BUTTON" || element.tagName === "LABEL"
            ? (element.textContent || "").trim().slice(0, 120)
            : null,
        visible: Boolean((element as HTMLElement).offsetWidth || (element as HTMLElement).offsetHeight),
      })),
    )
    .catch(() => []);
  base.sanitizedDomText = redactSensitiveText(JSON.stringify(formOutline), 8_000);

  try {
    await page.evaluate(() => {
      const style = document.createElement("style");
      style.setAttribute("data-nox-safe-capture", "true");
      style.textContent = `
        input, textarea, [contenteditable="true"], [autocomplete],
        [class*="avatar" i], [class*="profile" i], [class*="user" i] {
          color: transparent !important;
          text-shadow: 0 0 10px #111 !important;
          -webkit-text-security: disc !important;
        }
      `;
      document.head.appendChild(style);
      document.querySelectorAll("input, textarea").forEach((element) => {
        const field = element as HTMLInputElement | HTMLTextAreaElement;
        field.value = "••••";
        field.setAttribute("value", "••••");
      });
    });
    base.screenshot = await page.screenshot({ type: "png", fullPage: false, animations: "disabled" });
  } catch (error) {
    base.screenshotSkippedReason = `Falha segura de captura: ${redactSensitiveText(error, 400)}`;
  }
  return base;
}
