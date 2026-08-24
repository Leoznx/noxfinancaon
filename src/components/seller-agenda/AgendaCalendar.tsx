import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { agendaTypeKey, type SellerAppointment } from "@/lib/seller-agenda";

const EVENT_STYLE: Record<string, string> = {
  reuniao: "border-red-100 bg-red-50 text-red-700",
  follow_up: "border-blue-100 bg-blue-50 text-blue-700",
  visita: "border-amber-100 bg-amber-50 text-amber-800",
  call: "border-violet-100 bg-violet-50 text-violet-700",
  retorno: "border-emerald-100 bg-emerald-50 text-emerald-700",
  outro: "border-neutral-200 bg-neutral-100 text-neutral-700",
};

function dayKey(date: Date | string) {
  return format(typeof date === "string" ? new Date(date) : date, "yyyy-MM-dd");
}

export function AgendaCalendar({
  month,
  selectedDate,
  items,
  onMonthChange,
  onDateSelect,
  onEventOpen,
}: {
  month: Date;
  selectedDate: Date;
  items: SellerAppointment[];
  onMonthChange: (month: Date) => void;
  onDateSelect: (date: Date) => void;
  onEventOpen: (item: SellerAppointment) => void;
}) {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
  const end = endOfWeek(endOfMonth(month), { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start, end });
  const byDay = new Map<string, SellerAppointment[]>();

  for (const item of items) {
    const key = dayKey(item.scheduled_at);
    byDay.set(key, [...(byDay.get(key) ?? []), item]);
  }

  const goToday = () => {
    const today = new Date();
    onMonthChange(startOfMonth(today));
    onDateSelect(today);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-4 py-2.5">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-neutral-400">Calendário mensal</p>
          <h2 className="text-base font-black capitalize text-neutral-950">
            {format(month, "MMMM 'de' yyyy", { locale: ptBR })}
          </h2>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-8 w-8"
            aria-label="Mês anterior"
            onClick={() => onMonthChange(subMonths(month, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" className="h-8 px-3 text-xs font-bold" onClick={goToday}>
            Hoje
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-8 w-8"
            aria-label="Próximo mês"
            onClick={() => onMonthChange(addMonths(month, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-7 border-b border-neutral-100 bg-neutral-50/70">
        {["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"].map((weekday) => (
          <div key={weekday} className="py-1.5 text-center text-[9px] font-black tracking-[0.12em] text-neutral-400 sm:text-[10px]">
            {weekday}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day, index) => {
          const dayItems = byDay.get(dayKey(day)) ?? [];
          const selected = isSameDay(day, selectedDate);
          const today = isToday(day);
          return (
            <div
              key={day.toISOString()}
              className={`group relative min-h-[68px] border-b border-r border-neutral-100 p-1.5 text-left transition duration-200 sm:min-h-[80px] ${
                index % 7 === 6 ? "border-r-0" : ""
              } ${selected ? "bg-yellow-50 ring-1 ring-inset ring-yellow-400" : "hover:bg-neutral-50"} ${
                !isSameMonth(day, month) ? "bg-neutral-50/60 text-neutral-300" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => onDateSelect(day)}
                aria-label={`${format(day, "d 'de' MMMM", { locale: ptBR })}, ${dayItems.length} compromisso(s)`}
                className="absolute inset-0 z-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-yellow-400"
              />
              <div className="pointer-events-none relative z-[1]">
                <span
                  className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-extrabold ${
                    today ? "bg-yellow-400 text-neutral-950" : !isSameMonth(day, month) ? "text-neutral-300" : "text-neutral-600"
                  }`}
                >
                  {format(day, "d")}
                </span>
                <span className="mt-1 hidden space-y-0.5 sm:block">
                  {dayItems.slice(0, 2).map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => {
                        onDateSelect(day);
                        onEventOpen(item);
                      }}
                      className={`pointer-events-auto block w-full truncate rounded border px-1 py-0.5 text-left text-[8px] font-bold leading-none transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 ${EVENT_STYLE[agendaTypeKey(item.type)]}`}
                    >
                      {format(new Date(item.scheduled_at), "HH:mm")} {item.title}
                    </button>
                  ))}
                  {dayItems.length > 2 && (
                    <span className="block px-1 text-[8px] font-extrabold leading-none text-neutral-400">+{dayItems.length - 2} outros</span>
                  )}
                </span>
                {dayItems.length > 0 && (
                  <span className="mt-2 flex flex-wrap gap-0.5 sm:hidden">
                    {dayItems.slice(0, 4).map((item) => (
                      <span key={item.id} className={`h-1.5 w-1.5 rounded-full ${EVENT_STYLE[agendaTypeKey(item.type)].split(" ")[1]}`} />
                    ))}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
