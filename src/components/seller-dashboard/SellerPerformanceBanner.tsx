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
    <section className="relative min-h-[150px] overflow-hidden rounded-2xl border border-neutral-200 bg-[linear-gradient(100deg,#fff7d6_0%,#ffffff_48%,#fffcef_100%)] px-5 py-4 shadow-[0_1px_4px_rgba(0,0,0,0.03)] sm:px-7 lg:px-6 xl:px-7 xl:py-2.5">
      <div className="relative grid min-h-[108px] items-center gap-5 xl:grid-cols-[minmax(330px,0.82fr)_minmax(0,1.28fr)] xl:gap-4">
        <div className="flex min-w-0 items-center justify-center overflow-hidden xl:justify-start">
          <img
            src="/dashboard/seller-performance-art.png"
            alt="Arte NOX Fiança com casa, escudo e chave"
            className="h-auto max-h-[132px] w-full max-w-[540px] object-contain object-center xl:object-left"
          />
        </div>

        <div className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-4 lg:grid-cols-4 lg:gap-x-3 xl:gap-x-5">
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
