import { supabase } from "@/integrations/supabase/client";

export type InternalCreditAnalysis = {
  consultationId: string;
  score: number | null;
  paymentCommitmentPercentage: number | null;
  paymentCommitmentDescription: string | null;
  scoreBand: string | null;
  decision: string | null;
};

type InternalCreditAnalysisRow = {
  consultation_id: string;
  score: number | null;
  payment_commitment_percentage: number | null;
  payment_commitment_description: string | null;
  score_band: string | null;
  decision: string | null;
};

export async function getInternalCreditAnalysis(
  consultationId: string,
): Promise<InternalCreditAnalysis | null> {
  const { data, error } = await supabase.rpc("get_internal_credit_analyses", {
    p_consultation_ids: [consultationId],
  });
  if (error) throw error;

  const row = (data as InternalCreditAnalysisRow[] | null)?.[0];
  if (!row) return null;

  return {
    consultationId: row.consultation_id,
    score: row.score,
    paymentCommitmentPercentage: row.payment_commitment_percentage,
    paymentCommitmentDescription: row.payment_commitment_description,
    scoreBand: row.score_band,
    decision: row.decision,
  };
}

export function formatPaymentCommitmentPercentage(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}
