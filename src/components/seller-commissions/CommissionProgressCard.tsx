import {
  Check,
  LockKeyhole,
  Rocket,
  Target,
  TrendingUp,
  Trophy,
  type LucideIcon,
} from "lucide-react";

import {
  getDesempenhoComissaoVendedor,
  MARCOS_BONUS_VENDEDOR,
  type NivelComissaoVendedor,
} from "@/lib/comissao-vendedor";
import { formatMoney } from "@/lib/vendedor-portal";

type CommissionProgressCardProps = {
  contracts: number;
  level: NivelComissaoVendedor;
  monthlyGain: { comissao: number; bonus: number; total: number };
};

const LEVEL_VISUALS: Record<
  NivelComissaoVendedor["nome"],
  {
    icon: LucideIcon;
    card: string;
    iconBox: string;
    badge: string;
    progress: string;
    dot: string;
    highlight: string;
  }
> = {
  Arranque: {
    icon: Rocket,
    card: "border-[#F0CD28] bg-gradient-to-br from-[#FFF9D9] via-white to-[#FFFDF3]",
    iconBox: "bg-[#FFD91A] text-[#111]",
    badge: "border-[#F0CD28] bg-[#FFF3A8] text-[#5B4800]",
    progress: "bg-gradient-to-r from-[#FFD400] to-[#F5B800]",
    dot: "border-[#FFD400]",
    highlight: "text-[#9A7600]",
  },
  Aceleração: {
    icon: TrendingUp,
    card: "border-[#8BC8F4] bg-gradient-to-br from-[#EAF7FF] via-white to-[#F4F4FF]",
    iconBox: "bg-[#1686D9] text-white",
    badge: "border-[#98D2FA] bg-[#E3F4FF] text-[#075C9A]",
    progress: "bg-gradient-to-r from-[#1BA3F4] to-[#5765E8]",
    dot: "border-[#1686D9]",
    highlight: "text-[#0875BD]",
  },
  Elite: {
    icon: Trophy,
    card: "border-[#C9B2F4] bg-gradient-to-br from-[#F4EEFF] via-white to-[#FFF9DB]",
    iconBox: "bg-[#221637] text-[#FFD91A]",
    badge: "border-[#D2BEF6] bg-[#EEE5FF] text-[#513484]",
    progress: "bg-gradient-to-r from-[#7250B6] to-[#D9A900]",
    dot: "border-[#7250B6]",
    highlight: "text-[#62409F]",
  },
};

export function CommissionProgressCard({
  contracts,
  level,
  monthlyGain,
}: CommissionProgressCardProps) {
  const performance = getDesempenhoComissaoVendedor(contracts);
  const visual = LEVEL_VISUALS[level.nome];
  const LevelIcon = visual.icon;
  const nextMilestone = MARCOS_BONUS_VENDEDOR.find(
    (milestone) => contracts < milestone.contratos,
  )?.contratos;
  const progressMax = performance.totalNaFaixa || 1;
  const progressNow = performance.nivelMaximo ? 1 : performance.realizadosNaFaixa;

  return (
    <section
      className={`overflow-hidden rounded-[22px] border p-4 shadow-[0_12px_36px_rgba(30,30,30,0.07)] sm:p-5 ${visual.card}`}
      aria-label={`Nível de desempenho ${level.nome}`}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`flex h-12 w-12 items-center justify-center rounded-2xl shadow-sm ${visual.iconBox}`}
            >
              <LevelIcon className="h-6 w-6" aria-hidden="true" />
            </span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#777]">
                Nível de desempenho
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-xl font-black tracking-[-0.03em] text-[#111]">
                  {level.nome}
                </span>
                <span
                  className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${visual.badge}`}
                >
                  {performance.situacao}
                </span>
              </div>
            </div>
          </div>

          <h2 className="mt-4 max-w-3xl text-base font-black leading-snug tracking-[-0.015em] text-[#101010] sm:text-lg">
            {level.mensagem}
          </h2>
          <p className="mt-1.5 text-xs font-semibold text-[#666] sm:text-sm">
            {contracts} {contracts === 1 ? "contrato pago" : "contratos pagos"} no mês · seu próximo
            contrato vale{" "}
            <strong className={visual.highlight}>
              {formatMoney(level.valorPorProximoContrato)}
            </strong>
            .
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2.5" aria-label="Resumo do desempenho mensal">
          <div className="col-span-2 flex items-center justify-between rounded-2xl border border-white/80 bg-white/85 px-4 py-3 shadow-sm">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[#777]">
                Avanço na faixa
              </p>
              <p className="mt-1 text-xs font-bold text-[#555]">
                {performance.nivelMaximo
                  ? "Faixa máxima concluída"
                  : `${performance.realizadosNaFaixa} de ${performance.totalNaFaixa} contratos`}
              </p>
            </div>
            <strong className={`text-3xl font-black tracking-[-0.04em] ${visual.highlight}`}>
              {performance.percentual}%
            </strong>
          </div>
          <div className="rounded-2xl border border-white/80 bg-white/85 px-3.5 py-3 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-[0.1em] text-[#777]">
              Próxima conquista
            </p>
            <p className="mt-1.5 text-sm font-black leading-tight text-[#111]">
              {performance.proximaConquista}
            </p>
          </div>
          <div className="rounded-2xl border border-white/80 bg-white/85 px-3.5 py-3 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-[0.1em] text-[#777]">
              Total na folha
            </p>
            <p className={`mt-1 text-lg font-black ${visual.highlight}`}>
              {formatMoney(monthlyGain.total)}
            </p>
            <p className="mt-0.5 text-[10px] text-[#777]">
              {formatMoney(monthlyGain.comissao)} + {formatMoney(monthlyGain.bonus)} bônus
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-white/80 bg-white/70 p-3.5 sm:p-4">
        <div className="mb-2.5 flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.13em] text-[#777]">
              Progresso real da faixa
            </p>
            <p className="mt-1 text-sm font-extrabold text-[#222]">
              {performance.nivelMaximo
                ? "Todos os níveis foram conquistados"
                : `Faixa ${performance.inicioFaixa} → ${performance.metaFaixa} contratos`}
            </p>
          </div>
          <p className="text-xs font-bold text-[#555]">
            {performance.nivelMaximo ? "Meta máxima" : `Faltam ${performance.faltam}`}
          </p>
        </div>
        <div
          className="relative h-3.5 overflow-visible rounded-full bg-[#E7E7E7]"
          role="progressbar"
          aria-label="Progresso dentro da faixa atual"
          aria-valuemin={0}
          aria-valuemax={progressMax}
          aria-valuenow={progressNow}
          aria-valuetext={`${performance.percentual}% — ${performance.situacao}`}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-500 ease-out ${visual.progress}`}
            style={{ width: `${performance.percentual}%` }}
          />
          <span
            className={`absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[5px] bg-white shadow-sm transition-[left] duration-500 ease-out ${visual.dot}`}
            style={{ left: `${Math.max(performance.percentual, 1)}%` }}
            aria-hidden="true"
          />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3" aria-label="Marcos de bônus">
        {MARCOS_BONUS_VENDEDOR.map((milestone) => {
          const reached = contracts >= milestone.contratos;
          const isNext = milestone.contratos === nextMilestone;
          const StateIcon = reached ? Check : isNext ? Target : LockKeyhole;
          return (
            <div
              key={milestone.contratos}
              className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition-colors ${
                reached
                  ? "border-[#A9E7C4] bg-[#F0FFF7]"
                  : isNext
                    ? "border-[#E7CB51] bg-[#FFFBE8]"
                    : "border-[#E2E2E2] bg-white/60"
              }`}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                  reached
                    ? "bg-[#12935A] text-white"
                    : isNext
                      ? "bg-[#FFD91A] text-[#111]"
                      : "bg-[#ECECEC] text-[#777]"
                }`}
              >
                <StateIcon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.08em] text-[#777]">
                  {reached ? "Conquistado" : isNext ? "Próximo marco" : "Marco futuro"}
                </p>
                <p className="mt-0.5 text-xs font-black text-[#222]">
                  {milestone.rotulo} contratos · {formatMoney(milestone.bonus)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
