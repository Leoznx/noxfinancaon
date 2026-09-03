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
    <article className="relative h-full min-h-[148px] overflow-hidden rounded-2xl border border-neutral-200 bg-white p-3 shadow-[0_1px_4px_rgba(0,0,0,0.03)] transition duration-150 hover:border-neutral-300 hover:shadow-[0_3px_12px_rgba(0,0,0,0.045)] sm:min-h-[137px] sm:p-4 xl:min-h-0 xl:p-3">
      <div className="flex items-start gap-2 sm:gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:h-12 sm:w-12"
          style={{ backgroundColor: palette.iconBg, color: palette.icon }}
        >
          <Icon className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 pt-0.5">
          <p className="text-[13px] font-semibold leading-tight text-neutral-700">{title}</p>
          <p className="mt-1 truncate text-[clamp(17px,4.8vw,23px)] font-black leading-none tracking-[-0.03em] text-neutral-950 sm:text-[23px]">
            {value}
          </p>
          <p
            className={`mt-2 line-clamp-2 text-[11px] font-semibold leading-snug sm:text-xs ${subtitle.startsWith("+") ? "text-green-600" : "text-neutral-500"}`}
          >
            {subtitle}
          </p>
        </div>
      </div>

      {progress !== undefined ? (
        <div className="absolute inset-x-3 bottom-3 sm:inset-x-4 sm:bottom-4 xl:inset-x-3 xl:bottom-3">
          <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-[#ffc400] transition-[width] duration-500"
              style={{ width: `${Math.min(100, Math.max(0, progress ?? 0))}%` }}
            />
          </div>
        </div>
      ) : chartData.length > 1 ? (
        <div className="pointer-events-none absolute inset-x-2 bottom-0 h-9 opacity-95 xl:h-7">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`spark-${variant}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={palette.fill} stopOpacity={0.8} />
                  <stop offset="100%" stopColor={palette.fill} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="value"
                stroke={palette.line}
                strokeWidth={1.4}
                fill={`url(#spark-${variant})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </article>
  );
}
