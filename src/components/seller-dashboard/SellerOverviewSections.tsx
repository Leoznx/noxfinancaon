import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CalendarDays,
  CheckSquare2,
  FileCheck2,
  Info,
  Presentation,
  UserPlus,
} from "lucide-react";
import type {
  SellerDashboardActivity,
  SellerDashboardAppointment,
  SellerDashboardRanking,
} from "@/lib/seller-dashboard";

const PIPELINE_COLORS: Record<string, string> = {
  novo: "#4978f5",
  contato: "#ffc400",
  proposta: "#ff8a00",
  negociacao: "#7c4dff",
  fechamento: "#2fa84f",
};

type SellerRoute =
  "/vendedor/pipeline" | "/vendedor/leads" | "/vendedor/agenda" | "/vendedor/ranking";

export function PipelineSummary({
  stages,
}: {
  stages: Array<{ key: string; label: string; count: number }>;
}) {
  const total = stages.reduce((sum, stage) => sum + stage.count, 0);

  return (
    <DashboardSection
      title="Atendimento"
      info="Distribuição dos seus leads por etapa"
      footer="Ver atendimentos"
      href="/vendedor/pipeline"
    >
      <div className="space-y-3">
        {stages.map((stage) => {
          const percentage = total > 0 ? Math.round((stage.count / total) * 100) : 0;
          const color = PIPELINE_COLORS[stage.key] ?? "#6b7280";
          return (
            <div
              key={stage.key}
              className="grid grid-cols-[minmax(0,1fr)_28px_34px_64px] items-center gap-2 text-[11px]"
            >
              <span className="flex min-w-0 items-center gap-2 font-medium text-neutral-700">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="truncate">{stage.label}</span>
              </span>
              <b className="text-right text-neutral-900">{stage.count}</b>
              <span className="text-right text-neutral-500">{percentage}%</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${percentage}%`, backgroundColor: color }}
                />
              </span>
            </div>
          );
        })}
        {total === 0 && <EmptyMessage>Nenhum lead pendente.</EmptyMessage>}
      </div>
    </DashboardSection>
  );
}

export function RecentActivities({ activities }: { activities: SellerDashboardActivity[] }) {
  return (
    <DashboardSection
      title="Últimas atividades"
      footer="Ver todas atividades"
      href="/vendedor/leads"
    >
      {activities.length === 0 ? (
        <EmptyMessage>Nenhuma atividade recente.</EmptyMessage>
      ) : (
        <div className="divide-y divide-neutral-100">
          {activities.map((activity) => {
            const presentation = ACTIVITY_PRESENTATION[activity.type] ?? ACTIVITY_PRESENTATION.lead;
            const Icon = presentation.icon;
            return (
              <div
                key={activity.id}
                className="flex items-center gap-3 py-2 first:pt-0 last:pb-0 xl:gap-2 xl:py-1"
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg xl:h-7 xl:w-7 ${presentation.className}`}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.8} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-bold text-neutral-900">
                    {activity.title}
                  </p>
                  <p className="truncate text-[10px] text-neutral-500">{activity.subtitle}</p>
                </div>
                <time
                  className="shrink-0 text-[9px] text-neutral-400"
                  dateTime={activity.occurredAt}
                >
                  {relativeTime(activity.occurredAt)}
                </time>
              </div>
            );
          })}
        </div>
      )}
    </DashboardSection>
  );
}

const ACTIVITY_PRESENTATION = {
  contract: { icon: FileCheck2, className: "bg-yellow-50 text-yellow-600" },
  lead: { icon: UserPlus, className: "bg-green-50 text-green-600" },
  appointment: { icon: CalendarDays, className: "bg-purple-50 text-purple-600" },
  proposal: { icon: Presentation, className: "bg-blue-50 text-blue-600" },
};

export function TodayAgenda({ appointments }: { appointments: SellerDashboardAppointment[] }) {
  return (
    <DashboardSection title="Agenda de hoje" footer="Ver agenda completa" href="/vendedor/agenda">
      {appointments.length === 0 ? (
        <EmptyMessage>Nenhum compromisso para hoje.</EmptyMessage>
      ) : (
        <div className="divide-y divide-neutral-100">
          {appointments.slice(0, 3).map((appointment) => {
            const badge = appointmentBadge(appointment.type);
            return (
              <div
                key={appointment.id}
                className="flex items-center gap-2 py-2.5 first:pt-0 last:pb-0 xl:py-1"
              >
                <time
                  className="flex h-9 w-11 shrink-0 items-center justify-center rounded-lg border border-yellow-200 bg-yellow-50 text-[11px] font-bold text-neutral-900 xl:h-8 xl:w-10"
                  dateTime={appointment.scheduledAt}
                >
                  {new Date(appointment.scheduledAt).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-bold text-neutral-900">
                    {appointment.title}
                  </p>
                  <p className="truncate text-[10px] text-neutral-500">
                    {appointment.leadName || "Compromisso comercial"}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2 py-1 text-[8px] font-semibold ${badge.className}`}
                >
                  {badge.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </DashboardSection>
  );
}

export function SellerRanking({ ranking }: { ranking: SellerDashboardRanking[] }) {
  return (
    <DashboardSection
      title="Ranking"
      info="Posição calculada pelos cadastros realizados no mês"
      footer="Ver ranking completo"
      href="/vendedor/ranking"
    >
      {ranking.length === 0 ? (
        <EmptyMessage>Sem dados de ranking ainda.</EmptyMessage>
      ) : (
        <div className="space-y-1 xl:space-y-0.5">
          {ranking.map((seller) => (
            <div
              key={seller.sellerId}
              className={`flex items-center gap-2 rounded-lg border px-2 py-2 xl:px-1.5 xl:py-0.5 ${seller.isCurrent ? "border-yellow-200 bg-yellow-50" : "border-transparent"}`}
            >
              <span
                className={`flex w-5 shrink-0 items-center justify-center text-[10px] font-bold ${seller.position <= 3 ? "text-yellow-600" : "text-neutral-500"}`}
              >
                {seller.position === 1
                  ? "🥇"
                  : seller.position === 2
                    ? "2"
                    : seller.position === 3
                      ? "🥉"
                      : seller.position}
              </span>
              <Avatar name={seller.name} url={seller.avatarUrl} />
              <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-neutral-800">
                {seller.isCurrent ? "Você" : seller.name}
              </span>
              <span className="shrink-0 text-[10px] font-bold text-neutral-950">
                {seller.registrations} cadastros
              </span>
            </div>
          ))}
        </div>
      )}
    </DashboardSection>
  );
}

function DashboardSection({
  title,
  info,
  footer,
  href,
  children,
}: {
  title: string;
  info?: string;
  footer: string;
  href: SellerRoute;
  children: React.ReactNode;
}) {
  return (
    <section className="flex h-full min-h-[230px] min-w-0 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.03)] sm:min-h-[260px] xl:min-h-0 xl:p-3">
      <div className="mb-4 flex items-center gap-2 xl:mb-1.5">
        <h2 className="text-sm font-bold text-neutral-950">{title}</h2>
        {info && <Info className="h-3.5 w-3.5 text-neutral-400" aria-label={info} />}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
      <Link
        to={href}
        className="mt-4 flex min-h-10 items-center justify-center gap-3 rounded-lg border border-neutral-200 bg-white text-xs font-semibold text-neutral-700 transition hover:border-yellow-300 hover:bg-yellow-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 xl:mt-1.5 xl:min-h-7"
      >
        {footer}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </section>
  );
}

function EmptyMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[128px] flex-col items-center justify-center rounded-xl border border-dashed border-neutral-200 bg-neutral-50/60 px-4 text-center xl:h-full xl:min-h-0">
      <CheckSquare2 className="mb-2 h-5 w-5 text-neutral-300" />
      <p className="text-[11px] font-medium text-neutral-500">{children}</p>
    </div>
  );
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  const initials =
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "V";
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-900 text-[8px] font-bold text-white xl:h-6 xl:w-6">
      {url ? <img src={url} alt={name} className="h-full w-full object-cover" /> : initials}
    </span>
  );
}

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "agora";
  if (seconds < 3600) return `há ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `há ${Math.floor(seconds / 3600)}h`;
  if (seconds < 172800) return "há 1 dia";
  return new Date(value).toLocaleDateString("pt-BR");
}

function appointmentBadge(type: string) {
  if (type === "apresentacao" || type === "proposta_enviada") {
    return { label: "Proposta", className: "border-purple-200 bg-purple-50 text-purple-700" };
  }
  if (type === "follow_up" || type === "retorno") {
    return { label: "Follow-up", className: "border-yellow-200 bg-yellow-50 text-yellow-700" };
  }
  return { label: "Reunião", className: "border-neutral-200 bg-neutral-50 text-neutral-600" };
}
