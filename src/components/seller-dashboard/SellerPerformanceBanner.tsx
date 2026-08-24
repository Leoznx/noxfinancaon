import { CircleDollarSign, Target, TrendingUp, Trophy } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type BannerIndicator = {
  icon: LucideIcon;
  value: string;
  lines: [string, string];
};

export function SellerPerformanceBanner({
  contractsGrowth,
  commissionsGrowth,
  rankingPosition,
  goalPercentage,
}: {
  contractsGrowth: number | null;
  commissionsGrowth: number | null;
  rankingPosition: number | null;
  goalPercentage: number | null;
}) {
  const indicators: BannerIndicator[] = [
    {
      icon: TrendingUp,
      value: formatGrowth(contractsGrowth),
      lines: ["vs mês anterior", "contratos fechados"],
    },
    {
      icon: CircleDollarSign,
      value: formatGrowth(commissionsGrowth),
      lines: ["vs mês anterior", "comissões"],
    },
    {
      icon: Trophy,
      value: rankingPosition ? `${rankingPosition}º` : "—",
      lines: ["sua posição", "no ranking"],
    },
    {
      icon: Target,
      value: goalPercentage === null ? "—" : `${Math.round(goalPercentage)}%`,
      lines: ["da meta mensal", "atingida"],
    },
  ];

  return (
    <section className="relative min-h-[150px] overflow-hidden rounded-2xl border border-neutral-200 bg-[linear-gradient(100deg,#fff7d6_0%,#ffffff_48%,#fffcef_100%)] px-5 py-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)] sm:px-7 lg:px-6 xl:px-7">
      <div className="pointer-events-none absolute -left-16 -top-28 h-72 w-72 rounded-full bg-yellow-300/15 blur-2xl" />
      <div className="relative grid min-h-[108px] items-center gap-6 xl:grid-cols-[minmax(340px,0.88fr)_minmax(0,1.35fr)] xl:gap-5">
        <div className="flex min-w-0 items-center gap-5">
          <div className="relative hidden h-[112px] w-[112px] shrink-0 items-center justify-center sm:flex">
            <span className="absolute inset-0 rounded-full border border-yellow-300/35 bg-yellow-200/15" />
            <span className="absolute inset-[11px] rounded-full border border-yellow-300/50 bg-yellow-300/15" />
            <span className="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 bg-yellow-400" />
            <span className="absolute -right-1 top-4 h-1.5 w-1.5 rounded-full bg-yellow-300" />
            <div className="relative flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[#ffc800] shadow-[0_8px_22px_rgba(255,196,0,0.45)] ring-8 ring-yellow-300/20">
              <img src="/brand/simbolo-nox.svg" alt="Símbolo NOX" className="h-10 w-10" />
            </div>
          </div>

          <div className="min-w-0">
            <h2 className="text-[25px] font-semibold leading-[1.04] tracking-[-0.035em] text-neutral-950 xl:text-[29px]">
              Quanto mais<br />
              <span className="font-bold text-[#f6b900]">contratos,</span><br />
              maior sua comissão.
            </h2>
            <p className="mt-3 text-[13px] font-medium text-neutral-600">
              Foque em conectar, a NOX cuida do resto.
            </p>
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4 lg:gap-x-3 xl:gap-x-6">
          {indicators.map((indicator) => (
            <div key={indicator.lines.join("-")} className="flex min-w-0 items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-yellow-300/70 bg-yellow-100/70 text-[#eead00]">
                <indicator.icon className="h-5 w-5" strokeWidth={1.9} />
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="truncate text-xl font-black leading-none text-neutral-950">{indicator.value}</p>
                <p className="mt-2 text-[10px] font-medium leading-[1.45] text-neutral-500 xl:text-[11px]">
                  {indicator.lines[0]}<br />{indicator.lines[1]}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function formatGrowth(value: number | null) {
  if (value === null) return "—";
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}
