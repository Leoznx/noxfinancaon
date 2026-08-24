import type { LucideIcon } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

const VARIANTS = {
  yellow: { iconBg: "#fff7d6", icon: "#d79b00", line: "#f4ad00", fill: "#fff4c2" },
  green: { iconBg: "#ebf8ef", icon: "#2fa84f", line: "#2fa84f", fill: "#ddf5e4" },
  purple: { iconBg: "#f2ecff", icon: "#7c4dff", line: "#7c4dff", fill: "#ece4ff" },
  blue: { iconBg: "#edf3ff", icon: "#4978f5", line: "#4978f5", fill: "#e6edff" },
} as const;

export function SellerKpiCard({
  icon: Icon,
  title,
  value,
  subtitle,
  variant,
  sparkline,
  progress,
}: {
  icon: LucideIcon;
  title: string;
  value: string;
  subtitle: string;
  variant: keyof typeof VARIANTS;
  sparkline?: number[];
  progress?: number | null;
}) {
  const palette = VARIANTS[variant];
  const chartData = (sparkline ?? []).map((item, index) => ({ index, value: item }));

  return (
    <article className="relative min-h-[137px] overflow-hidden rounded-2xl border border-neutral-200 bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.03)] transition duration-150 hover:border-neutral-300 hover:shadow-[0_3px_12px_rgba(0,0,0,0.045)]">
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: palette.iconBg, color: palette.icon }}>
          <Icon className="h-6 w-6" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 pt-0.5">
          <p className="text-[12px] font-semibold leading-tight text-neutral-700">{title}</p>
          <p className="mt-1 truncate text-[23px] font-black leading-none tracking-[-0.03em] text-neutral-950">{value}</p>
          <p className={`mt-2 text-[10px] font-semibold ${subtitle.startsWith("+") ? "text-green-600" : "text-neutral-500"}`}>
            {subtitle}
          </p>
        </div>
      </div>

      {progress !== undefined ? (
        <div className="absolute inset-x-4 bottom-4">
          <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-[#ffc400] transition-[width] duration-500"
              style={{ width: `${Math.min(100, Math.max(0, progress ?? 0))}%` }}
            />
          </div>
        </div>
      ) : chartData.length > 1 ? (
        <div className="pointer-events-none absolute inset-x-2 bottom-0 h-9 opacity-95">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`spark-${variant}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={palette.fill} stopOpacity={0.8} />
                  <stop offset="100%" stopColor={palette.fill} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="value" stroke={palette.line} strokeWidth={1.4} fill={`url(#spark-${variant})`} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </article>
  );
}
