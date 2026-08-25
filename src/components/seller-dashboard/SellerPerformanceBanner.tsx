import { Target, Trophy } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type BannerIndicator = {
  icon: LucideIcon;
  value: string;
  lines: [string, string];
};

export function SellerPerformanceBanner({
  rankingPosition,
  goalPercentage,
}: {
  rankingPosition: number | null;
  goalPercentage: number | null;
}) {
  const indicators: BannerIndicator[] = [
    {
      icon: Trophy,
      value: rankingPosition ? `${rankingPosition}º` : "0º",
      lines: ["sua posição", "no ranking"],
    },
    {
      icon: Target,
      value: goalPercentage === null ? "0%" : `${Math.round(goalPercentage)}%`,
      lines: ["da meta mensal", "atingida"],
    },
  ];

  return (
    <section className="relative min-h-[150px] overflow-hidden rounded-2xl border border-neutral-200 bg-[linear-gradient(100deg,#fff7d6_0%,#ffffff_48%,#fffcef_100%)] px-5 py-4 shadow-[0_1px_4px_rgba(0,0,0,0.03)] sm:px-7 lg:px-6 xl:h-full xl:min-h-0 xl:px-5 xl:py-2.5">
      <div className="relative grid min-h-[108px] items-center gap-5 xl:h-full xl:min-h-0 xl:grid-cols-[minmax(280px,0.85fr)_minmax(430px,1.4fr)_minmax(310px,0.72fr)] xl:gap-2">
        <img
          src="/dashboard/seller-performance-art.png"
          alt="Arte NOX Fiança com casa, escudo e chave"
          className="mx-auto h-auto max-h-[142px] w-full max-w-[620px] min-w-0 object-contain object-center xl:max-h-[118px] xl:max-w-[470px] xl:object-left"
        />

        <p
          className="mx-auto w-full max-w-[760px] px-3 text-center text-2xl font-black uppercase leading-[1.05] tracking-[0.035em] text-neutral-950 sm:text-[28px] xl:max-w-none xl:whitespace-nowrap xl:px-2 xl:text-[clamp(28px,2vw,36px)]"
          style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
        >
          A proteção que{" "}
          <span className="underline decoration-yellow-400 decoration-[3px] underline-offset-[7px]">
            não
          </span>{" "}
          dorme
        </p>

        <div className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-4 xl:gap-x-5">
          {indicators.map((indicator) => (
            <div key={indicator.lines.join("-")} className="flex min-w-0 items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-yellow-300/70 bg-yellow-100/70 text-[#eead00]">
                <indicator.icon className="h-5 w-5" strokeWidth={1.9} />
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="truncate text-xl font-black leading-none text-neutral-950">
                  {indicator.value}
                </p>
                <p className="mt-2 text-[10px] font-medium leading-[1.45] text-neutral-500 xl:text-[11px]">
                  {indicator.lines[0]}
                  <br />
                  {indicator.lines[1]}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
