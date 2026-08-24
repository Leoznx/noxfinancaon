import { CalendarCheck2, CalendarDays, Clock3, PhoneForwarded } from "lucide-react";
import type { AgendaSummary } from "@/lib/seller-agenda";

type SummaryAction = "today" | "week" | "followups" | "meetings";

const CARDS = [
  {
    key: "today" as const,
    label: "Hoje",
    description: "compromissos no dia",
    icon: CalendarCheck2,
    value: (summary: AgendaSummary) => summary.today,
    tone: "bg-amber-50 text-amber-700",
  },
  {
    key: "week" as const,
    label: "Esta semana",
    description: "na semana atual",
    icon: CalendarDays,
    value: (summary: AgendaSummary) => summary.thisWeek,
    tone: "bg-blue-50 text-blue-700",
  },
  {
    key: "followups" as const,
    label: "Follow-ups pendentes",
    description: "aguardando contato",
    icon: PhoneForwarded,
    value: (summary: AgendaSummary) => summary.pendingFollowups,
    tone: "bg-violet-50 text-violet-700",
  },
  {
    key: "meetings" as const,
    label: "Reuniões agendadas",
    description: "no mês atual",
    icon: Clock3,
    value: (summary: AgendaSummary) => summary.scheduledMeetings,
    tone: "bg-emerald-50 text-emerald-700",
  },
];

export function AgendaSummaryCards({
  summary,
  loading,
  onSelect,
}: {
  summary: AgendaSummary;
  loading: boolean;
  onSelect: (action: SummaryAction) => void;
}) {
  return (
    <section className="grid grid-cols-2 gap-2.5 xl:grid-cols-4" aria-label="Resumo da agenda">
      {CARDS.map(({ key, label, description, icon: Icon, value, tone }) => (
        <button
          key={key}
          type="button"
          onClick={() => onSelect(key)}
          className="group flex min-h-24 items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-3 text-left shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition duration-200 hover:-translate-y-0.5 hover:border-yellow-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 sm:p-4"
        >
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone}`}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[11px] font-extrabold uppercase tracking-[0.08em] text-neutral-500">
              {label}
            </span>
            {loading ? (
              <span className="mt-1 block h-7 w-10 animate-pulse rounded bg-neutral-100" />
            ) : (
              <span className="block text-2xl font-black leading-tight text-neutral-950">{value(summary)}</span>
            )}
            <span className="hidden truncate text-[11px] font-medium text-neutral-400 sm:block">{description}</span>
          </span>
        </button>
      ))}
    </section>
  );
}

