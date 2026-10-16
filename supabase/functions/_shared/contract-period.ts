export const MIN_CONTRACT_PERIOD_MONTHS = 1;
export const MAX_CONTRACT_PERIOD_MONTHS = 120;

export const INVALID_CONTRACT_PERIOD_CODE = "invalid_contract_period_months";
export const CONTRACT_PERIOD_LOCK_CONFLICT_CODE =
  "contract_period_lock_conflict";
export const CONTRACT_PERIOD_LOCK_FAILED_CODE = "contract_period_lock_failed";

type ContractPeriodSource = {
  contract_period_months?: unknown;
};

type ContractPeriodLockRow = {
  contract_period_months?: unknown;
  contract_period_locked_at?: unknown;
  contract_period_change_pending_at?: unknown;
};

export class ContractPeriodLockError extends Error {
  readonly code:
    | typeof CONTRACT_PERIOD_LOCK_CONFLICT_CODE
    | typeof CONTRACT_PERIOD_LOCK_FAILED_CODE;

  constructor(
    code:
      | typeof CONTRACT_PERIOD_LOCK_CONFLICT_CODE
      | typeof CONTRACT_PERIOD_LOCK_FAILED_CODE,
  ) {
    super(code);
    this.name = "ContractPeriodLockError";
    this.code = code;
  }
}

function contractPeriodValue(source: ContractPeriodSource | unknown) {
  if (
    source !== null &&
    typeof source === "object" &&
    "contract_period_months" in source
  ) {
    return (source as ContractPeriodSource).contract_period_months;
  }
  return source;
}

export function parseContractPeriodMonths(
  source: ContractPeriodSource | unknown,
): number | null {
  const value = contractPeriodValue(source);
  if (value === null || value === undefined || value === "") return null;

  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value.trim())
    ? Number(value.trim())
    : Number.NaN;

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_CONTRACT_PERIOD_MONTHS ||
    parsed > MAX_CONTRACT_PERIOD_MONTHS
  ) {
    return null;
  }
  return parsed;
}

export function resolveContractPeriodMonths(
  source: ContractPeriodSource | unknown,
): number {
  const months = parseContractPeriodMonths(source);
  if (months === null) throw new Error(INVALID_CONTRACT_PERIOD_CODE);
  return months;
}

/**
 * Congela o prazo com um UPDATE condicionado ao valor que acabou de ser lido.
 * Assim, se outra requisição mudar o período entre a leitura e o primeiro
 * efeito externo, nenhuma das integrações continua com um valor obsoleto.
 *
 * O cliente recebido precisa usar a service role. Uma segunda aquisição com
 * o mesmo prazo é idempotente. Uma troca de prazo só volta a ser possível
 * quando o banco identifica uma reserva antiga sem efeito externo.
 */
export async function lockContractPeriod(
  supabase: any,
  consultationId: string,
  expectedMonthsSource: ContractPeriodSource | unknown,
  lockedAt = new Date().toISOString(),
) {
  const expectedMonths = resolveContractPeriodMonths(expectedMonthsSource);
  const { data: acquired, error: acquireError } = await supabase
    .from("consultas_credito")
    .update({ contract_period_locked_at: lockedAt })
    .eq("id", consultationId)
    .eq("contract_period_months", expectedMonths)
    .is("contract_period_locked_at", null)
    .is("contract_period_change_pending_at", null)
    .select(
      "contract_period_months, contract_period_locked_at, contract_period_change_pending_at",
    )
    .maybeSingle();

  if (acquireError) {
    throw new ContractPeriodLockError(CONTRACT_PERIOD_LOCK_FAILED_CODE);
  }
  if (acquired) {
    return {
      contractPeriodMonths: expectedMonths,
      lockedAt: String(acquired.contract_period_locked_at || lockedAt),
      acquired: true,
    };
  }

  // UPDATE sem linha pode significar apenas que uma tentativa anterior já
  // adquiriu o mesmo lock. A leitura confirma isso sem liberar o prazo.
  const { data: current, error: currentError } = await supabase
    .from("consultas_credito")
    .select(
      "contract_period_months, contract_period_locked_at, contract_period_change_pending_at",
    )
    .eq("id", consultationId)
    .maybeSingle();

  if (currentError) {
    throw new ContractPeriodLockError(CONTRACT_PERIOD_LOCK_FAILED_CODE);
  }

  const currentRow = current as ContractPeriodLockRow | null;
  if (
    !currentRow ||
    parseContractPeriodMonths(currentRow.contract_period_months) !==
      expectedMonths ||
    currentRow.contract_period_change_pending_at != null ||
    typeof currentRow.contract_period_locked_at !== "string" ||
    !currentRow.contract_period_locked_at
  ) {
    throw new ContractPeriodLockError(CONTRACT_PERIOD_LOCK_CONFLICT_CODE);
  }

  return {
    contractPeriodMonths: expectedMonths,
    lockedAt: currentRow.contract_period_locked_at,
    acquired: false,
  };
}

export function formatContractPeriodMonths(
  source: ContractPeriodSource | unknown,
) {
  const months = resolveContractPeriodMonths(source);
  return `${months} ${months === 1 ? "mês" : "meses"}`;
}

/**
 * Soma meses em UTC sem deixar datas no fim do mês transbordarem para o mês
 * seguinte (31/08 + 6 meses = 28/02 ou 29/02, nunca março).
 */
export function addUtcMonthsClamped(
  input: Date,
  monthsSource: ContractPeriodSource | unknown,
) {
  if (!(input instanceof Date) || Number.isNaN(input.getTime())) {
    throw new Error("invalid_contract_start_date");
  }
  const months = resolveContractPeriodMonths(monthsSource);
  const originalDay = input.getUTCDate();
  const monthIndex = input.getUTCMonth() + months;
  const targetYear = input.getUTCFullYear() + Math.floor(monthIndex / 12);
  const targetMonth = monthIndex % 12;
  const lastTargetDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();

  const result = new Date(input.getTime());
  result.setUTCDate(1);
  result.setUTCFullYear(targetYear);
  result.setUTCMonth(targetMonth);
  result.setUTCDate(Math.min(originalDay, lastTargetDay));
  return result;
}

export function replaceFixedContractPeriodText(
  text: string,
  source: ContractPeriodSource | unknown,
) {
  const period = formatContractPeriodMonths(source);
  return text.replace(/vigência de\s+12\s+meses/giu, `vigência de ${period}`);
}
