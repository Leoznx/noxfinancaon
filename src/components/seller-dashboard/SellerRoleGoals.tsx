import { CalendarCheck2, CalendarClock, Target, UserPlus } from "lucide-react";
import type { SellerGoalProgress } from "@/lib/seller-progress";

type SellerType = "sdr" | "closer";

type GoalItem = {
  label: string;
  period: string;
  current: number;
  target: number | null;
  icon: typeof Target;
  accent: string;
  iconClass: string;
};

export function SellerRoleGoals({
  progress,
  sellerType,
}: {
  progress: SellerGoalProgress;
  sellerType: SellerType;
}) {
  const role = progress.seller_type || sellerType;
  const goals = role === "closer" ? closerGoals(progress) : sdrGoals(progress);
  const configured = goals.filter((goal) => goal.target != null);
  const overall = configured.length
    ? Math.round(
        configured.reduce((total, goal) => total + percentage(goal.current, goal.target), 0) /
          configured.length,
      )
    : 0;
  const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(
    new Date(progress.year, progress.month - 1, 1),
  );

  return (
    <section className="seller-role-goals overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_8px_30px_rgba(0,0,0,0.035)]">
      <div className="seller-role-goals__header flex flex-col gap-3 border-b border-neutral-100 bg-[radial-gradient(circle_at_92%_10%,rgba(250,204,21,0.2),transparent_30%),linear-gradient(105deg,#fff_0%,#fffdf4_100%)] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-yellow-300 bg-yellow-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-yellow-800">
              Metas de {monthName}
            </span>
            <span className="rounded-full bg-neutral-950 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-white">
              {role.toUpperCase()}
            </span>
          </div>
          <h2 className="seller-role-goals__title mt-2 text-lg font-black tracking-[-0.025em] text-neutral-950 sm:text-xl">
            {role === "closer"
              ? "Reuniões confirmadas e cadastros"
              : "Reuniões agendadas e cadastros"}
          </h2>
          <p className="seller-role-goals__description mt-0.5 text-xs font-medium text-neutral-500">
            {role === "closer"
              ? "Meta compartilhada pelos Closers; o progresso abaixo é somente o seu."
              : "Meta compartilhada pelos SDRs; o progresso abaixo é somente o seu."}
          </p>
        </div>
        <div className="seller-role-goals__overall flex shrink-0 items-center gap-3 rounded-xl border border-yellow-200 bg-white/90 px-3 py-2 shadow-sm">
          <span className="seller-role-goals__overall-icon flex h-9 w-9 items-center justify-center rounded-lg bg-yellow-100 text-yellow-700">
            <Target className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-400">
              Progresso geral
            </p>
            <p className="text-xl font-black leading-none text-neutral-950">
              {configured.length ? `${overall}%` : "—"}
            </p>
          </div>
        </div>
      </div>

      <div className="seller-role-goals__grid grid gap-2.5 p-3 sm:grid-cols-3 sm:p-4 xl:grid-cols-6">
        {goals.map((goal) => (
          <GoalCard key={`${goal.label}-${goal.period}`} goal={goal} />
        ))}
      </div>
    </section>
  );
}

function GoalCard({ goal }: { goal: GoalItem }) {
  const Icon = goal.icon;
  const value = percentage(goal.current, goal.target);
  const remaining = goal.target == null ? null : Math.max(0, goal.target - goal.current);

  return (
    <article className="seller-role-goal-card min-w-0 rounded-xl border border-neutral-200 bg-neutral-50/70 p-3">
      <div className="seller-role-goal-card__top flex items-start gap-2.5">
        <span
          className={`seller-role-goal-card__icon flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${goal.iconClass}`}
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-black uppercase tracking-[0.14em] text-neutral-400">
            {goal.period}
          </p>
          <h3 className="seller-role-goal-card__label text-xs font-black leading-tight text-neutral-900">
            {goal.label}
          </h3>
        </div>
        <strong className="text-sm font-black text-neutral-950">
          {goal.current}
          <span className="font-bold text-neutral-400">/{goal.target ?? "—"}</span>
        </strong>
      </div>
      <div className="seller-role-goal-card__track mt-3 h-2 overflow-hidden rounded-full bg-neutral-200">
        <span
          className={`block h-full rounded-full transition-[width] ${goal.accent}`}
          style={{ width: `${goal.target == null ? 0 : value}%` }}
        />
      </div>
      <p className="seller-role-goal-card__status mt-2 text-[10px] font-semibold text-neutral-500">
        {goal.target == null
          ? "Meta ainda não definida"
          : remaining === 0
            ? "Meta alcançada"
            : `Faltam ${remaining} para concluir`}
      </p>
    </article>
  );
}

function sdrGoals(progress: SellerGoalProgress): GoalItem[] {
  return [...meetingGoals(progress, "sdr"), ...registrationGoals(progress)];
}

function closerGoals(progress: SellerGoalProgress): GoalItem[] {
  return [...meetingGoals(progress, "closer"), ...registrationGoals(progress)];
}

function registrationGoals(progress: SellerGoalProgress): GoalItem[] {
  return [
    {
      label: "Cadastros realizados",
      period: "Hoje",
      current: progress.clients_registered_daily,
      target: progress.target_clients_daily,
      icon: UserPlus,
      accent: "bg-yellow-400",
      iconClass: "bg-yellow-100 text-yellow-700",
    },
    {
      label: "Cadastros realizados",
      period: "Esta semana",
      current: progress.clients_registered_weekly,
      target: progress.target_clients_weekly,
      icon: Target,
      accent: "bg-blue-500",
      iconClass: "bg-blue-50 text-blue-600",
    },
    {
      label: "Cadastros realizados",
      period: "No mês",
      current: progress.clients_registered_monthly,
      target: progress.target_clients_monthly,
      icon: UserPlus,
      accent: "bg-violet-500",
      iconClass: "bg-violet-50 text-violet-600",
    },
  ];
}

function meetingGoals(progress: SellerGoalProgress, role: SellerType): GoalItem[] {
  const closer = role === "closer";
  const label = closer ? "Reuniões confirmadas" : "Reuniões agendadas";
  const Icon = closer ? CalendarCheck2 : CalendarClock;
  return [
    {
      label,
      period: "Hoje",
      current: closer ? progress.meetings_completed_daily : progress.meetings_scheduled_daily,
      target: closer
        ? progress.target_meetings_completed_daily
        : progress.target_meetings_scheduled_daily,
      icon: Icon,
      accent: "bg-yellow-400",
      iconClass: "bg-yellow-100 text-yellow-700",
    },
    {
      label,
      period: "Esta semana",
      current: closer ? progress.meetings_completed_weekly : progress.meetings_scheduled_weekly,
      target: closer
        ? progress.target_meetings_completed_weekly
        : progress.target_meetings_scheduled_weekly,
      icon: Icon,
      accent: "bg-blue-500",
      iconClass: "bg-blue-50 text-blue-600",
    },
    {
      label,
      period: "No mês",
      current: closer ? progress.meetings_completed_monthly : progress.meetings_scheduled_monthly,
      target: closer
        ? progress.target_meetings_completed_monthly
        : progress.target_meetings_scheduled_monthly,
      icon: Icon,
      accent: "bg-violet-500",
      iconClass: "bg-violet-50 text-violet-600",
    },
  ];
}

function percentage(current: number, target: number | null) {
  if (target == null) return 0;
  if (target <= 0) return 100;
  return Math.min(100, Math.max(0, Math.round((current / target) * 100)));
}
