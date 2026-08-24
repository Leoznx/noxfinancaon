import { CircleCheck, CircleDollarSign, LockKeyhole, ShieldCheck, type LucideIcon } from "lucide-react";
import { formatMoney } from "@/lib/vendedor-portal";

type CommissionStatsGridProps = {
  summary: { comissao: number; bonus: number; retido: number; liberado: number };
};

const STATS: Array<{
  key: keyof CommissionStatsGridProps["summary"];
  label: string;
  icon: LucideIcon;
}> = [
  { key: "comissao", label: "Comissão", icon: CircleDollarSign },
  { key: "bonus", label: "Bônus", icon: ShieldCheck },
  { key: "retido", label: "Retido", icon: LockKeyhole },
  { key: "liberado", label: "Liberado", icon: CircleCheck },
];

export function CommissionStatsGrid({ summary }: CommissionStatsGridProps) {
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Resumo financeiro">
      {STATS.map(({ key, label, icon: Icon }) => (
        <div
          key={key}
          className="flex min-h-[98px] items-center gap-4 rounded-2xl border border-[#E9E9E9] bg-white px-5 py-4 shadow-[0_5px_18px_rgba(0,0,0,0.05)] transition-transform duration-200 hover:-translate-y-px"
        >
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#FFF5C7]">
            <Icon className="h-7 w-7 text-[#181818]" strokeWidth={1.8} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-[#666]">{label}</p>
            <p className="truncate text-[23px] font-black leading-tight tracking-[-0.025em] text-[#090909]">
              {formatMoney(summary[key])}
            </p>
          </div>
        </div>
      ))}
    </section>
  );
}
