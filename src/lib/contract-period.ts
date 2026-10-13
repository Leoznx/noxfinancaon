export const CONTRACT_PERIOD_OPTIONS = [6, 12, 24, 36] as const;

export const MIN_CONTRACT_PERIOD_MONTHS = 1;
export const MAX_CONTRACT_PERIOD_MONTHS = 120;
export const LEGACY_CONTRACT_PERIOD_MONTHS = 12;

/**
 * Converte um valor vindo de formulario ou do banco em um periodo contratual
 * valido. Retorna `null` em vez de assumir 12 meses para que novas propostas
 * continuem exigindo uma escolha explicita do corretor.
 */
export function normalizeContractPeriodMonths(value: unknown): number | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    value = Number(trimmed);
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < MIN_CONTRACT_PERIOD_MONTHS ||
    value > MAX_CONTRACT_PERIOD_MONTHS
  ) {
    return null;
  }

  return value;
}

/** Mantem propostas antigas, sem a nova coluna preenchida, no prazo historico de 12 meses. */
export function resolveContractPeriodMonths(
  value: unknown,
  fallback = LEGACY_CONTRACT_PERIOD_MONTHS,
): number {
  return normalizeContractPeriodMonths(value) ?? normalizeContractPeriodMonths(fallback) ?? LEGACY_CONTRACT_PERIOD_MONTHS;
}

export function formatContractPeriodMonths(value: unknown): string {
  const months = normalizeContractPeriodMonths(value);
  if (months === null) return "—";
  return `${months} ${months === 1 ? "mês" : "meses"}`;
}
