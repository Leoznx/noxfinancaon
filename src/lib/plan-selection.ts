import { normalizeContractPeriodMonths } from "@/lib/contract-period";

type ExtrasSnapshot = {
  external_painting_enabled?: unknown;
  external_painting_total?: unknown;
  external_painting_installment?: unknown;
  activation_fee_enabled?: unknown;
  activation_fee_amount?: unknown;
  activation_fee_commission?: unknown;
};

export type SavedPlanSelection = {
  plano_id?: unknown;
  contract_period_months?: unknown;
  valor_premio_mensal?: unknown;
  valor_anual?: unknown;
  status?: unknown;
  documentos?: unknown;
  external_painting_enabled?: unknown;
  external_painting_total?: unknown;
  external_painting_installment?: unknown;
  activation_fee_enabled?: unknown;
  activation_fee_amount?: unknown;
  activation_fee_commission?: unknown;
};

export type NextPlanSelection = {
  planId: string;
  contractPeriodMonths: number;
  monthlyAmount: number;
  annualAmount: number;
  extras: ExtrasSnapshot;
  calculatedPlan?: unknown;
};

const MONEY_TOLERANCE = 0.005;

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function sameMoney(left: unknown, right: unknown) {
  const parsedLeft = Number(left);
  const parsedRight = Number(right);
  return (
    Number.isFinite(parsedLeft) &&
    Number.isFinite(parsedRight) &&
    Math.abs(parsedLeft - parsedRight) < MONEY_TOLERANCE
  );
}

function sameExtras(leftValue: unknown, rightValue: ExtrasSnapshot) {
  const left = asRecord(leftValue);
  return (
    Boolean(left.external_painting_enabled) === Boolean(rightValue.external_painting_enabled) &&
    sameMoney(left.external_painting_total ?? 0, rightValue.external_painting_total ?? 0) &&
    sameMoney(
      left.external_painting_installment ?? 0,
      rightValue.external_painting_installment ?? 0,
    ) &&
    Boolean(left.activation_fee_enabled) === Boolean(rightValue.activation_fee_enabled) &&
    sameMoney(left.activation_fee_amount ?? 0, rightValue.activation_fee_amount ?? 0) &&
    sameMoney(left.activation_fee_commission ?? 0, rightValue.activation_fee_commission ?? 0)
  );
}

/**
 * Retoma uma proposta já salva sem regravar plano, extras ou status quando a
 * única escolha nova é o prazo. Isso evita que editar o período faça o funil
 * voltar para `pendente_documentacao` ou descarte dados preenchidos depois.
 */
export function buildPlanSelectionUpdate(saved: SavedPlanSelection, next: NextPlanSelection) {
  const period = normalizeContractPeriodMonths(next.contractPeriodMonths);
  if (period === null) {
    throw new Error("Selecione um período de contrato válido.");
  }

  const documents = asRecord(saved.documentos);
  const documentExtras = asRecord(documents.extras);
  const storedExtras = Object.keys(documentExtras).length > 0 ? documentExtras : saved;
  const canResumeSavedSelection =
    saved.plano_id === next.planId &&
    sameMoney(saved.valor_premio_mensal, next.monthlyAmount) &&
    sameMoney(saved.valor_anual, next.annualAmount) &&
    sameExtras(storedExtras, next.extras);

  if (canResumeSavedSelection) {
    return {
      payload: { contract_period_months: period },
      resumed: true,
      periodChanged: normalizeContractPeriodMonths(saved.contract_period_months) !== period,
    };
  }

  return {
    payload: {
      plano_id: next.planId,
      contract_period_months: period,
      valor_premio_mensal: next.monthlyAmount,
      valor_anual: next.annualAmount,
      status: "pendente_documentacao",
      documentos: {
        ...documents,
        extras: next.extras,
        plano_calculado: next.calculatedPlan ?? null,
      },
    },
    resumed: false,
    periodChanged: normalizeContractPeriodMonths(saved.contract_period_months) !== period,
  };
}
