import { useState } from "react";
import { ArrowUpRight, CheckCircle2, Gift, ImageIcon, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  sellerGoalPercentage,
  sellerRewardCriterion,
  sellerRewardCurrent,
} from "@/lib/seller-goals-dashboard";
import type { SellerMonthlyProgress } from "@/lib/seller-progress";
import type { SellerReward } from "@/lib/seller-rewards";

type CommissionIncentivesProps = {
  rewards: SellerReward[];
  progress: SellerMonthlyProgress;
};

export function CommissionIncentives({ rewards, progress }: CommissionIncentivesProps) {
  const contracts = progress.contracts_closed;

  return (
    <div className="space-y-5">
      {rewards.length > 0 ? (
        <Card className="overflow-hidden border-yellow-300 shadow-sm">
          <CardHeader className="border-b border-yellow-100 bg-[linear-gradient(120deg,#fffbe8,#ffffff)]">
            <CardTitle className="flex items-center gap-2 text-base">
              <Gift className="h-5 w-5 text-yellow-600" /> Recompensas do mês
            </CardTitle>
            <p className="text-xs leading-5 text-neutral-500">
              Complete seus desafios individuais e desbloqueie as premiações ativas da NOX.
            </p>
          </CardHeader>
          <CardContent className="grid gap-3 p-4 lg:grid-cols-2 2xl:grid-cols-3">
            {rewards.map((reward) => (
              <RewardCard key={reward.id} reward={reward} progress={progress} />
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card className="overflow-hidden border-neutral-200 shadow-sm">
        <CardHeader className="border-b border-neutral-100 bg-neutral-50/60">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5 text-yellow-500" /> Bonificação por produção
          </CardTitle>
          <p className="text-xs text-neutral-500">
            As faixas são cumulativas e avançam automaticamente com seus contratos do mês.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 md:grid-cols-3">
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
    </div>
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
    <article className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-3 p-3">
        {imageFailed ? (
          <div className="flex h-[92px] items-center justify-center rounded-xl bg-yellow-50 text-yellow-600">
            <ImageIcon className="h-6 w-6" />
          </div>
        ) : (
          <img
            src={reward.image_url}
            alt={reward.title}
            className="h-[92px] w-[92px] rounded-xl bg-neutral-100 object-cover"
            onError={() => setImageFailed(true)}
          />
        )}
        <div className="min-w-0 py-0.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-neutral-950">{reward.title}</p>
              <p className="mt-0.5 text-[10px] font-bold text-yellow-700">
                {sellerRewardCriterion(reward.metric, reward.target)}
              </p>
            </div>
            {remaining === 0 ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
            ) : null}
          </div>
          {reward.description ? (
            <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-neutral-500">
              {reward.description}
            </p>
          ) : null}
        </div>
      </div>
      <div className="border-t border-neutral-100 bg-neutral-50/70 px-3 py-3">
        <div className="flex items-center justify-between text-[10px] font-black">
          <span className={remaining === 0 ? "text-emerald-700" : "text-neutral-600"}>
            {remaining === 0 ? "Recompensa conquistada" : `Faltam ${remaining} para desbloquear`}
          </span>
          <span className="rounded-full border border-yellow-300 bg-yellow-50 px-2 py-0.5 text-yellow-800">
            {current}/{reward.target}
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-200">
          <div className="h-full rounded-full bg-yellow-400" style={{ width: `${percentage}%` }} />
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
      className={`relative overflow-hidden rounded-2xl border p-4 ${
        active
          ? "border-yellow-400 bg-yellow-50 ring-2 ring-yellow-100"
          : "border-neutral-200 bg-white"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-black text-neutral-950">{title}</p>
        {active ? <Badge className="bg-yellow-400 text-[9px] text-black">FAIXA ATUAL</Badge> : null}
      </div>
      <p className="mt-3 text-lg font-black text-yellow-700">{value}</p>
      <p className="mt-0.5 text-xs text-neutral-500">{bonus}</p>
      <ArrowUpRight className="absolute bottom-3 right-3 h-5 w-5 text-yellow-400/50" />
    </div>
  );
}
