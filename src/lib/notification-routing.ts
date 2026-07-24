/**
 * Converte links legados de notificações para rotas que existem no site.
 *
 * O backend já gravou `/consulta/:id` (singular) e o fluxo jurídico gravava
 * `/consultas/:id/status`. Para notificações de resultado, ambos devem abrir a
 * tela canônica que mostra o resultado e, quando aprovada, a escolha de planos.
 */
export function routeForNotification(link?: string | null): string | null {
  const normalized = (link ?? "").trim();
  if (!normalized) return null;

  const legacyConsultaMatch = normalized.match(/^\/consulta\/([^/?#]+)(?:[/?#]|$)/i);
  if (legacyConsultaMatch?.[1]) {
    return `/consultas/${legacyConsultaMatch[1]}/resultado`;
  }

  const consultaResultMatch = normalized.match(
    /^\/consultas\/([^/?#]+)\/(?:status|resultado)(?:[/?#]|$)/i,
  );
  if (consultaResultMatch?.[1]) {
    return `/consultas/${consultaResultMatch[1]}/resultado`;
  }

  const consultaRootMatch = normalized.match(/^\/consultas\/([^/?#]+)\/?(?:[?#].*)?$/i);
  if (consultaRootMatch?.[1] && consultaRootMatch[1].toLowerCase() !== "nova") {
    return `/consultas/${consultaRootMatch[1]}/resultado`;
  }

  return normalized;
}
