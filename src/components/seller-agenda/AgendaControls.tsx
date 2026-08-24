import { CalendarDays, List } from "lucide-react";
import { AGENDA_FILTERS, type AgendaFilter, type AgendaViewMode } from "@/lib/seller-agenda";

export function AgendaControls({
  view,
  filter,
  onViewChange,
  onFilterChange,
}: {
  view: AgendaViewMode;
  filter: AgendaFilter;
  onViewChange: (view: AgendaViewMode) => void;
  onFilterChange: (filter: AgendaFilter) => void;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-neutral-200 bg-white p-2 shadow-[0_1px_2px_rgba(0,0,0,0.03)] lg:flex-row lg:items-center lg:justify-between">
      <div className="inline-flex w-fit rounded-xl bg-neutral-100 p-1" aria-label="Modo de visualização">
        <button
          type="button"
          onClick={() => onViewChange("calendario")}
          className={`inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs font-extrabold transition ${
            view === "calendario" ? "bg-neutral-950 text-white shadow-sm" : "text-neutral-500 hover:text-neutral-950"
          }`}
        >
          <CalendarDays className="h-4 w-4" /> Calendário
        </button>
        <button
          type="button"
          onClick={() => onViewChange("lista")}
          className={`inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs font-extrabold transition ${
            view === "lista" ? "bg-neutral-950 text-white shadow-sm" : "text-neutral-500 hover:text-neutral-950"
          }`}
        >
          <List className="h-4 w-4" /> Lista
        </button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1 lg:pb-0" aria-label="Filtros da agenda">
        {AGENDA_FILTERS.map((option) => (
          <button
            type="button"
            key={option.value}
            onClick={() => onFilterChange(option.value)}
            className={`h-7 shrink-0 rounded-full border px-3 text-[11px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 ${
              filter === option.value
                ? "border-neutral-950 bg-neutral-950 text-white"
                : "border-neutral-200 bg-white text-neutral-600 hover:border-yellow-300 hover:bg-yellow-50"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </section>
  );
}
