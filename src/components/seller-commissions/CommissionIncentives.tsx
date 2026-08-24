import { useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  CheckCircle2,
  Gift,
  ImageIcon,
  Sparkles,
  WalletCards,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  sellerGoalPercentage,
  sellerRewardCriterion,
  sellerRewardCurrent,
} from "@/lib/seller-goals-dashboard";
import {
  filterCommissionHistory,
  getCommissionContractNumber,
  getCommissionCustomerName,
  getCommissionEntryAmount,
  type SellerCommissionRow,
} from "@/lib/seller-commissions-view";
import type { SellerMonthlyProgress } from "@/lib/seller-progress";
import type { SellerReward } from "@/lib/seller-rewards";
import { formatMoney } from "@/lib/vendedor-portal";

type CommissionIncentivesProps = {
  rewards: SellerReward[];
  progress: SellerMonthlyProgress;
  rows: SellerCommissionRow[];
};

export function CommissionIncentives({ rewards, progress, rows }: CommissionIncentivesProps) {
  const contracts = progress.contracts_closed;
  const entries = useMemo(() => filterCommissionHistory(rows, "paid", "current"), [rows]);
  const entriesTotal = useMemo(
    () => entries.reduce((total, row) => total + getCommissionEntryAmount(row), 0),
    [entries],
  );

  return (
    <section
      className="grid items-stretch gap-4 xl:grid-cols-3"
      aria-label="Recompensas, bonificações e entradas do mês"
    >
      <Card className="flex h-full min-h-[390px] flex-col overflow-hidden border-emerald-200 shadow-[0_5px_20px_rgba(0,0,0,0.045)]">
        <CardHeader className="min-h-[112px] border-b border-emerald-100 bg-[linear-gradient(135deg,#f0fdf4,#ffffff)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base text-neutral-950">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
                  <WalletCards className="h-[18px] w-[18px]" />
                </span>
                Entradas
              </CardTitle>
              <p className="mt-2 text-xs leading-5 text-neutral-500">
                Comissões efetivamente liberadas ou pagas neste mês.
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[10px] font-black text-emerald-700">
              {entries.length}
            </span>
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col p-4">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-3.5 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700">
              Total recebido no mês
            </p>
            <p className="mt-1 text-2xl font-black tracking-[-0.03em] text-neutral-950">
              {formatMoney(entriesTotal)}
            </p>
          </div>
          {entries.length > 0 ? (
            <div className="mt-3 max-h-[430px] space-y-2.5 overflow-y-auto pr-1">
              {entries.map((row) => (
                <CommissionEntry key={row.id} row={row} />
              ))}
            </div>
          ) : (
            <EmptyColumn
              icon={ArrowDownToLine}
              title="Nenhuma entrada neste mês"
              description="Quando uma comissão for liberada ou paga, ela aparecerá aqui automaticamente."
              tone="emerald"
            />
          )}
        </CardContent>
      </Card>

      <Card className="flex h-full min-h-[390px] flex-col overflow-hidden border-yellow-200 shadow-[0_5px_20px_rgba(0,0,0,0.045)]">
        <CardHeader className="min-h-[112px] border-b border-yellow-100 bg-[linear-gradient(135deg,#fffbea,#ffffff)] p-4">
          <CardTitle className="flex items-center gap-2 text-base text-neutral-950">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-yellow-100 text-yellow-700">
              <Sparkles className="h-[18px] w-[18px]" />
            </span>
            Bonificação por produção
          </CardTitle>
          <p className="mt-2 text-xs leading-5 text-neutral-500">
            Faixas cumulativas que avançam com seus contratos do mês.
          </p>
        </CardHeader>
        <CardContent className="flex-1 space-y-3 p-4">
          <Tier
            title="1º ao 15º contrato"
            value="R$ 35 cada"
            bonus="No 15º: + R$ 400"
            active={contracts <= 15}
          />
          <Tier
            title="16º ao 25º contrato"
            value="R$ 55 cada"
            bonus="No 30º: + R$ 600"
            active={contracts >= 16 && contracts <= 25}
          />
          <Tier
            title="A partir do 26º"
            value="R$ 75 cada"
            bonus="Acima de 45: + R$ 1.200"
            active={contracts >= 26}
          />
        </CardContent>
      </Card>

      <Card className="flex h-full min-h-[390px] flex-col overflow-hidden border-violet-200 shadow-[0_5px_20px_rgba(0,0,0,0.045)]">
        <CardHeader className="min-h-[112px] border-b border-violet-100 bg-[linear-gradient(135deg,#f7f5ff,#ffffff)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base text-neutral-950">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-100 text-violet-700">
                  <Gift className="h-[18px] w-[18px]" />
                </span>
                Recompensas do mês
              </CardTitle>
              <p className="mt-2 text-xs leading-5 text-neutral-500">
                Desafios individuais e premiações ativas da NOX.
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-violet-200 bg-white px-2.5 py-1 text-[10px] font-black text-violet-700">
              {rewards.length}
            </span>
          </div>
        </CardHeader>
        <CardContent className="flex-1 p-4">
          {rewards.length > 0 ? (
            <div className="max-h-[535px] space-y-3 overflow-y-auto pr-1">
              {rewards.map((reward) => (
                <RewardCard key={reward.id} reward={reward} progress={progress} />
              ))}
            </div>
          ) : (
            <EmptyColumn
              icon={Gift}
              title="Nenhuma recompensa ativa"
              description="As próximas recompensas cadastradas para este mês aparecerão aqui."
              tone="violet"
            />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function CommissionEntry({ row }: { row: SellerCommissionRow }) {
  const receivedAt = new Date(row.released_at || row.created_at);
  return (
    <article className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 transition hover:border-emerald-200 hover:bg-emerald-50/30">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700">
        <ArrowDownToLine className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-black text-neutral-950">
          {getCommissionCustomerName(row)}
        </p>
        <p className="mt-0.5 truncate text-[10px] font-medium text-neutral-500">
          Contrato {getCommissionContractNumber(row)} · {receivedAt.toLocaleDateString("pt-BR")}
        </p>
      </div>
      <p className="shrink-0 text-sm font-black text-emerald-700">
        + {formatMoney(getCommissionEntryAmount(row))}
      </p>
    </article>
  );
}

function RewardCard({
  reward,
  progress,
}: {
  reward: SellerReward;
  progress: SellerMonthlyProgress;
}) {
  const current = sellerRewardCurrent(progress, reward.metric);
  const percentage = sellerGoalPercentage(current, reward.target);
  const remaining = Math.max(0, reward.target - current);
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <article className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 p-3">
        {imageFailed ? (
          <div className="flex h-16 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
            <ImageIcon className="h-5 w-5" />
          </div>
        ) : (
          <img
            src={reward.image_url}
            alt={reward.title}
            className="h-16 w-16 rounded-lg bg-neutral-100 object-cover"
            onError={() => setImageFailed(true)}
          />
        )}
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-neutral-950">{reward.title}</p>
              <p className="mt-0.5 text-[10px] font-bold leading-4 text-violet-700">
                {sellerRewardCriterion(reward.metric, reward.target)}
              </p>
            </div>
            {remaining === 0 ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
            ) : null}
          </div>
          {reward.description ? (
            <p className="mt-1 line-clamp-1 text-[10px] leading-4 text-neutral-500">
              {reward.description}
            </p>
          ) : null}
        </div>
      </div>
      <div className="border-t border-neutral-100 bg-neutral-50/70 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2 text-[10px] font-black">
          <span className={remaining === 0 ? "text-emerald-700" : "text-neutral-600"}>
            {remaining === 0 ? "Conquistada" : `Faltam ${remaining}`}
          </span>
          <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-violet-800">
            {current}/{reward.target}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-200">
          <div className="h-full rounded-full bg-violet-500" style={{ width: `${percentage}%` }} />
        </div>
      </div>
    </article>
  );
}

function Tier({
  title,
  value,
  bonus,
  active,
}: {
  title: string;
  value: string;
  bonus: string;
  active: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl border p-3.5 ${active ? "border-yellow-400 bg-yellow-50 ring-2 ring-yellow-100" : "border-neutral-200 bg-white"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-black text-neutral-950">{title}</p>
          <p className="mt-2 text-lg font-black text-yellow-700">{value}</p>
          <p className="mt-0.5 text-xs text-neutral-500">{bonus}</p>
        </div>
        {active ? (
          <Badge className="shrink-0 bg-yellow-400 px-2 text-[8px] text-black">FAIXA ATUAL</Badge>
        ) : null}
      </div>
      <ArrowUpRight className="absolute bottom-3 right-3 h-4 w-4 text-yellow-500/45" />
    </div>
  );
}

function EmptyColumn({
  icon: Icon,
  title,
  description,
  tone,
}: {
  icon: typeof Gift;
  title: string;
  description: string;
  tone: "emerald" | "violet";
}) {
  const colors =
    tone === "emerald" ? "bg-emerald-50 text-emerald-700" : "bg-violet-50 text-violet-700";
  return (
    <div className="flex min-h-[210px] flex-1 flex-col items-center justify-center px-5 text-center">
      <span className={`grid h-12 w-12 place-items-center rounded-2xl ${colors}`}>
        <Icon className="h-5 w-5" />
      </span>
      <p className="mt-3 text-sm font-black text-neutral-950">{title}</p>
      <p className="mt-1 max-w-64 text-xs leading-5 text-neutral-500">{description}</p>
    </div>
  );
}
