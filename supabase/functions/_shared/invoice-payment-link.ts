export type InvoicePaymentLinkSource = {
  id?: string | null;
  consulta_id?: string | null;
  asaas_payment_id?: string | null;
  billing_key?: string | null;
  charge_kind?: string | null;
  numero_parcela?: number | string | null;
  vencimento?: string | null;
  valor?: number | string | null;
};

export type LocalAsaasPaymentLinkCandidate = {
  id?: string | null;
  consultation_id?: string | null;
  asaas_payment_id?: string | null;
  external_reference?: string | null;
  charge_kind?: string | null;
  value?: number | string | null;
  due_date?: string | null;
  status?: string | null;
};

export type InvoicePaymentLinkResolution<T> = {
  payment: T | null;
  ambiguous: boolean;
  strategy: "billing_key" | "installment" | "due_date" | null;
};

const moneyInCents = (value: unknown) => Math.round(Number(value || 0) * 100);
const dateOnly = (value: unknown) => String(value || "").slice(0, 10);

function referenceInstallment(reference: unknown) {
  const match = String(reference || "").match(
    /(?:(?:^|:)installment:|:(?:initial|monthly):)(\d+)/i,
  );
  return match ? Number(match[1]) : null;
}

function referenceChargeKind(reference: unknown) {
  const match = String(reference || "").match(/:(initial|monthly):/i);
  return match?.[1]?.toLowerCase() || null;
}

/**
 * Reconciles a canonical invoice with an older local Asaas row when the UUID
 * foreign key was not persisted. The matcher never crosses consultations and
 * only accepts an exact billing key or compatible amount plus installment/date.
 * Tied candidates are deliberately rejected instead of guessing.
 */
export function resolveInvoicePaymentLink<T extends LocalAsaasPaymentLinkCandidate>(
  invoice: InvoicePaymentLinkSource,
  candidates: T[],
  options: { preferCandidate?: (candidate: T) => boolean } = {},
): InvoicePaymentLinkResolution<T> {
  const eligible = candidates.filter(
    (candidate) =>
      !!candidate.id &&
      !!candidate.asaas_payment_id &&
      !!invoice.consulta_id &&
      candidate.consultation_id === invoice.consulta_id,
  );
  const billingKey = String(invoice.billing_key || "").trim();
  if (billingKey) {
    const exact = eligible.filter(
      (candidate) => String(candidate.external_reference || "") === billingKey,
    );
    if (exact.length === 1) {
      return { payment: exact[0], ambiguous: false, strategy: "billing_key" };
    }
    if (exact.length > 1) {
      return { payment: null, ambiguous: true, strategy: "billing_key" };
    }
  }

  const invoiceInstallment = Number(invoice.numero_parcela || 0) || null;
  const invoiceDueDate = dateOnly(invoice.vencimento);
  const invoiceKind = String(invoice.charge_kind || "").toLowerCase() || null;
  const ranked = eligible.flatMap((candidate) => {
    if (moneyInCents(candidate.value) !== moneyInCents(invoice.valor)) return [];

    const candidateInstallment = referenceInstallment(candidate.external_reference);
    const candidateDueDate = dateOnly(candidate.due_date);
    const candidateKind =
      referenceChargeKind(candidate.external_reference) ||
      String(candidate.charge_kind || "").toLowerCase() ||
      null;
    const installmentMatches = !!invoiceInstallment && candidateInstallment === invoiceInstallment;
    const dueDateMatches = !!invoiceDueDate && candidateDueDate === invoiceDueDate;
    if (!installmentMatches && !dueDateMatches) return [];

    const kindMatches = !!invoiceKind && candidateKind === invoiceKind;
    const score =
      (installmentMatches ? 40 : 0) +
      (dueDateMatches ? 20 : 0) +
      (kindMatches ? 5 : 0) +
      (options.preferCandidate?.(candidate) ? 2 : 0);
    return [{ candidate, score, installmentMatches, dueDateMatches }];
  });

  if (ranked.length === 0) {
    return { payment: null, ambiguous: false, strategy: null };
  }
  const highestScore = Math.max(...ranked.map((entry) => entry.score));
  const best = ranked.filter((entry) => entry.score === highestScore);
  if (best.length !== 1) {
    return { payment: null, ambiguous: true, strategy: null };
  }
  return {
    payment: best[0].candidate,
    ambiguous: false,
    strategy: best[0].installmentMatches ? "installment" : "due_date",
  };
}
