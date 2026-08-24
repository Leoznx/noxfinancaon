import { useMemo } from "react";
import { BarChart3, CalendarDays, Info, MoreVertical } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SellerDashboardMonth } from "@/lib/seller-dashboard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ChartRange = "3" | "6" | "12" | "year";

export function ContractsChart({
  history,
  range,
  onRangeChange,
}: {
  history: SellerDashboardMonth[];
  range: ChartRange;
  onRangeChange: (range: ChartRange) => void;
}) {
  const visibleHistory = useMemo(() => {
    if (range === "year") {
      const currentYear = new Date().getFullYear();
      return history.filter((item) => item.year === currentYear);
    }
    return history.slice(-Number(range));
  }, [history, range]);
  const hasContracts = visibleHistory.some((item) => item.contracts > 0);

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col rounded-2xl border border-neutral-200 bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.03)] sm:p-5 xl:p-3">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[17px] font-bold text-neutral-950">Contratos fechados</h2>
            <Info
              className="h-4 w-4 text-neutral-400"
              aria-label="Contratos fechados por período"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] font-medium text-neutral-500">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ffc400]" />
              Contratos (qtd)
            </span>
            <span className="flex items-center gap-2">
              <span className="h-0.5 w-5 bg-neutral-950" />
              Acumulado (qtd)
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Select value={range} onValueChange={(value) => onRangeChange(value as ChartRange)}>
            <SelectTrigger className="h-9 w-[156px] rounded-lg border-neutral-200 bg-white text-[11px] font-semibold shadow-none">
              <CalendarDays className="mr-1 h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">Últimos 3 meses</SelectItem>
              <SelectItem value="6">Últimos 6 meses</SelectItem>
              <SelectItem value="12">Últimos 12 meses</SelectItem>
              <SelectItem value="year">Ano atual</SelectItem>
            </SelectContent>
          </Select>
          <button
            type="button"
            aria-label="Mais opções do gráfico"
            title="Mais opções do gráfico"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 text-neutral-700 transition hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="h-[205px] min-w-0 xl:h-auto xl:min-h-[128px] xl:flex-1">
        {!hasContracts ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-yellow-50 text-yellow-600">
              <BarChart3 className="h-5 w-5" />
            </span>
            <p className="text-sm font-semibold text-neutral-700">
              Nenhum contrato fechado neste período.
            </p>
            <p className="mt-1 text-xs text-neutral-400">
              O histórico será atualizado automaticamente.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={visibleHistory}
              margin={{ top: 28, right: 4, bottom: 0, left: -20 }}
            >
              <CartesianGrid vertical={false} stroke="#ededed" strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fill: "#6b7280", fontSize: 10 }}
                dy={8}
              />
              <YAxis
                yAxisId="contracts"
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "#6b7280", fontSize: 10 }}
              />
              <YAxis
                yAxisId="accumulated"
                orientation="right"
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "#6b7280", fontSize: 10 }}
              />
              <Tooltip
                cursor={{ fill: "#fff8d6", opacity: 0.65 }}
                contentStyle={{
                  borderRadius: 10,
                  border: "1px solid #e8e8e8",
                  boxShadow: "0 8px 30px rgba(0,0,0,.08)",
                  fontSize: 12,
                }}
                formatter={(value, name) => [
                  Number(value),
                  name === "contracts" ? "Contratos fechados" : "Acumulado",
                ]}
                labelFormatter={(label) => `Mês: ${label}`}
              />
              <Bar
                yAxisId="contracts"
                dataKey="contracts"
                fill="#ffc400"
                radius={[4, 4, 0, 0]}
                maxBarSize={22}
              >
                <LabelList
                  dataKey="contracts"
                  position="top"
                  formatter={formatPositiveLabel}
                  fill="#383838"
                  fontSize={9}
                  fontWeight={700}
                  offset={6}
                />
              </Bar>
              <Line
                yAxisId="accumulated"
                type="linear"
                dataKey="accumulated"
                stroke="#111111"
                strokeWidth={1.7}
                dot={{ r: 2.6, fill: "#111111", strokeWidth: 0 }}
                activeDot={{ r: 4 }}
              >
                <LabelList
                  dataKey="accumulated"
                  position="top"
                  formatter={formatPositiveLabel}
                  fill="#111111"
                  fontSize={8.5}
                  fontWeight={600}
                  offset={20}
                />
              </Line>
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

function formatPositiveLabel(value: number | string) {
  const numericValue = Number(value);
  return numericValue > 0 ? numericValue : "";
}
