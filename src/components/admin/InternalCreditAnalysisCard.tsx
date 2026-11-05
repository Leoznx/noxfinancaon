import { Gauge, LockKeyhole, Percent } from "lucide-react";
import { useEffect, useState } from "react";

import {
  formatPaymentCommitmentPercentage,
  getInternalCreditAnalysis,
  type InternalCreditAnalysis,
} from "@/lib/internal-credit-analysis";

export function InternalCreditAnalysisCard({ consultationId }: { consultationId: string }) {
  const [analysis, setAnalysis] = useState<InternalCreditAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setAnalysis(null);
    setFailed(false);
    setLoading(true);

    void getInternalCreditAnalysis(consultationId)
      .then((nextAnalysis) => {
        if (active) setAnalysis(nextAnalysis);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [consultationId]);

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-neutral-900">
            <LockKeyhole size={16} className="text-amber-700" />
            Análise interna
          </h3>
          <p className="mt-1 text-xs text-neutral-500">Visível somente para administradores.</p>
        </div>
        {loading && <span className="text-xs font-medium text-amber-700">Carregando...</span>}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Metric
          icon={<Gauge size={17} />}
          label="Score da consulta"
          value={analysis?.score != null ? String(analysis.score) : "—"}
        />
        <Metric
          icon={<Percent size={17} />}
          label="Poder de pagamento"
          value={formatPaymentCommitmentPercentage(
            analysis?.paymentCommitmentPercentage ?? null,
          )}
        />
      </div>

      {!loading && (failed || !analysis) && (
        <p className="mt-3 text-xs text-neutral-500">
          {failed
            ? "Não foi possível carregar a análise interna."
            : "Esta consulta não possui análise interna registrada."}
        </p>
      )}
    </section>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-amber-100 bg-white px-4 py-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-800">
        {icon}
      </span>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">{label}</p>
        <p className="mt-0.5 text-lg font-black text-neutral-950">{value}</p>
      </div>
    </div>
  );
}
