import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  History,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  TimerReset,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  buildTimeClockCalendar,
  createTimeClockPhotoUrl,
  fetchMyTimeClockHistory,
  formatPunchTime,
  formatTimeClockMinutes,
  summarizeTimeClockDays,
  timeClockCalendarRange,
  timeClockWeekRange,
  TIME_CLOCK_LABELS,
  type TimeClockDay,
  type TimeClockHistoryView,
} from "@/lib/time-clock";

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MONTH_LABEL = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });

export function SellerTimeClockHistory({ initialDays }: { initialDays: TimeClockDay[] }) {
  const today = useMemo(saoPauloDate, []);
  const currentMonth = today.slice(0, 7);
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<TimeClockHistoryView>("day");
  const [cursor, setCursor] = useState(() => monthFromDate(today));
  const [selectedDate, setSelectedDate] = useState(today);
  const [days, setDays] = useState(initialDays);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const cursorKey = `${cursor.year}-${String(cursor.month).padStart(2, "0")}`;
  const calendar = useMemo(
    () => buildTimeClockCalendar(cursor.year, cursor.month),
    [cursor.month, cursor.year],
  );
  const dayByDate = useMemo(
    () => new Map(days.map((day) => [day.work_date, day])),
    [days],
  );
  const selectedDay = dayByDate.get(selectedDate);
  const periodDays = useMemo(() => {
    if (view === "day") return selectedDay ? [selectedDay] : [];
    if (view === "month") return days.filter((day) => day.work_date.startsWith(cursorKey));
    const range = timeClockWeekRange(selectedDate);
    return days.filter((day) => day.work_date >= range.from && day.work_date <= range.to);
  }, [cursorKey, days, selectedDate, selectedDay, view]);

  useEffect(() => {
    if (cursorKey === currentMonth) setDays(initialDays);
  }, [currentMonth, cursorKey, initialDays]);

  async function loadMonth(nextCursor = cursor) {
    setLoading(true);
    setError("");
    try {
      const range = timeClockCalendarRange(nextCursor.year, nextCursor.month);
      const nextDays = await fetchMyTimeClockHistory(range.from, range.to);
      const nextCursorKey = `${nextCursor.year}-${String(nextCursor.month).padStart(2, "0")}`;
      setDays(nextDays);
      setSelectedDate(
        nextDays.find((day) => day.work_date.startsWith(nextCursorKey))?.work_date ??
          timeClockMonthRangeFallback(nextCursor.year, nextCursor.month, today),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar o histórico.");
    } finally {
      setLoading(false);
    }
  }

  function changeMonth(offset: number) {
    const date = new Date(Date.UTC(cursor.year, cursor.month - 1 + offset, 1));
    const nextCursor = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
    setCursor(nextCursor);
    void loadMonth(nextCursor);
  }

  function selectDay(date: string) {
    setSelectedDate(date);
    if (view !== "day") setView("day");
  }

  function toggleHistory() {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded) void loadMonth(cursor);
  }

  return (
    <Card className="overflow-hidden border-neutral-200 shadow-sm">
      <button
        type="button"
        onClick={toggleHistory}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition hover:bg-neutral-50 sm:px-6"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-yellow-100 text-yellow-700">
            <History className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <strong className="block text-base font-black text-neutral-950">Histórico de ponto</strong>
            <span className="block text-xs text-neutral-500">
              Calendário diário e resumos semanal e mensal
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs font-bold text-neutral-600">
          {expanded ? "Ocultar" : "Abrir histórico"}
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>

      {expanded ? (
        <CardContent className="border-t border-neutral-100 p-3 sm:p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center justify-between gap-2 sm:justify-start">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 rounded-xl"
                onClick={() => changeMonth(-1)}
                aria-label="Mês anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <p className="min-w-44 text-center text-sm font-black capitalize text-neutral-900">
                {MONTH_LABEL.format(new Date(cursor.year, cursor.month - 1, 1, 12))}
              </p>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 rounded-xl"
                onClick={() => changeMonth(1)}
                disabled={cursorKey >= currentMonth}
                aria-label="Próximo mês"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-xl text-xs"
              onClick={() => void loadMonth()}
              disabled={loading}
            >
              <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Atualizar período
            </Button>
          </div>

          {error ? (
            <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
              {error}
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.08fr)_minmax(340px,.92fr)]">
            <div className="relative overflow-hidden rounded-2xl border border-neutral-200 bg-white">
              <div className="grid grid-cols-7 border-b border-neutral-100 bg-neutral-50 px-2 py-2">
                {WEEKDAYS.map((weekday) => (
                  <span key={weekday} className="text-center text-[9px] font-black uppercase tracking-wide text-neutral-400">
                    {weekday}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7 p-2">
                {calendar.map((calendarDay) => {
                  const day = dayByDate.get(calendarDay.date);
                  const selected = calendarDay.date === selectedDate;
                  const future = calendarDay.date > today;
                  return (
                    <button
                      type="button"
                      key={calendarDay.date}
                      onClick={() => selectDay(calendarDay.date)}
                      disabled={!calendarDay.inMonth || future}
                      className={`group relative m-0.5 min-h-14 rounded-xl border p-1.5 text-left transition sm:min-h-[68px] ${
                        selected
                          ? "border-neutral-950 bg-neutral-950 text-white shadow-sm"
                          : calendarDay.inMonth && !future
                            ? "border-transparent bg-neutral-50 text-neutral-800 hover:border-yellow-300 hover:bg-yellow-50"
                            : "border-transparent bg-transparent text-neutral-300"
                      }`}
                    >
                      <span className="text-[11px] font-black">{calendarDay.dayNumber}</span>
                      {calendarDay.inMonth && !future ? (
                        <span className="mt-1 flex items-center gap-1">
                          <span className={`h-1.5 w-1.5 rounded-full ${statusDot(day?.status, calendarDay.weekend)}`} />
                          <span className={`hidden text-[8px] font-bold sm:inline ${selected ? "text-neutral-300" : "text-neutral-400"}`}>
                            {calendarDay.weekend
                              ? "Folga"
                              : day?.punches.length
                                ? `${day.punches.length}/4`
                                : "Sem ponto"}
                          </span>
                        </span>
                      ) : null}
                      {day?.bank_minutes != null ? (
                        <span className={`absolute bottom-1.5 right-1.5 hidden text-[8px] font-black sm:block ${selected ? "text-yellow-300" : day.bank_minutes < 0 ? "text-red-500" : "text-emerald-600"}`}>
                          {formatTimeClockMinutes(day.bank_minutes)}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {loading ? (
                <div className="absolute inset-0 hidden items-center justify-center bg-white/70 lg:flex">
                  <Loader2 className="h-6 w-6 animate-spin text-yellow-600" />
                </div>
              ) : null}
            </div>

            <div className="min-w-0 rounded-2xl border border-neutral-200 bg-neutral-50/60 p-3 sm:p-4">
              <div className="mb-4 grid grid-cols-3 rounded-xl border border-neutral-200 bg-white p-1" role="tablist" aria-label="Período do histórico">
                {(["day", "week", "month"] as TimeClockHistoryView[]).map((option) => (
                  <button
                    type="button"
                    key={option}
                    role="tab"
                    aria-selected={view === option}
                    onClick={() => setView(option)}
                    className={`rounded-lg px-2 py-2 text-[10px] font-black transition ${view === option ? "bg-neutral-950 text-white" : "text-neutral-500 hover:bg-neutral-50"}`}
                  >
                    {option === "day" ? "Dia" : option === "week" ? "Semana" : "Mês"}
                  </button>
                ))}
              </div>

              {loading ? (
                <div className="flex min-h-64 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-yellow-600" />
                </div>
              ) : view === "day" ? (
                <DayDetails day={selectedDay} date={selectedDate} />
              ) : (
                <PeriodSummary days={periodDays} view={view} selectedDate={selectedDate} onSelectDay={selectDay} />
              )}
            </div>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}

function DayDetails({ day, date }: { day?: TimeClockDay; date: string }) {
  const [opening, setOpening] = useState<string | null>(null);
  const selected = new Date(`${date}T12:00:00`);

  async function openPhoto(path: string) {
    setOpening(path);
    try {
      window.open(await createTimeClockPhotoUrl(path), "_blank", "noopener,noreferrer");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível abrir a foto.");
    } finally {
      setOpening(null);
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-neutral-400">Detalhes do dia</p>
          <h3 className="mt-1 text-base font-black capitalize text-neutral-950">
            {selected.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
          </h3>
        </div>
        {day ? <StatusBadge status={day.status} /> : null}
      </div>

      {!day ? (
        <div className="mt-4 flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-neutral-200 bg-white px-5 text-center">
          <CalendarDays className="h-6 w-6 text-neutral-300" />
          <p className="mt-2 text-sm font-black text-neutral-700">Sem jornada neste dia</p>
          <p className="mt-1 text-xs text-neutral-500">Selecione um dia útil para consultar as marcações.</p>
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <MiniMetric label="Trabalhado" value={formatWorked(day.worked_minutes)} />
            <MiniMetric label="Previsto" value={formatWorked(day.scheduled_minutes)} />
            <MiniMetric label="Saldo" value={formatTimeClockMinutes(day.bank_minutes)} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {Object.keys(TIME_CLOCK_LABELS).map((value) => {
              const type = value as keyof typeof TIME_CLOCK_LABELS;
              const punch = day.punches.find((item) => item.type === type);
              return (
                <button
                  type="button"
                  key={type}
                  disabled={!punch}
                  onClick={() => punch && void openPhoto(punch.photo_path)}
                  className="rounded-xl border border-neutral-200 bg-white p-2.5 text-left disabled:cursor-default"
                >
                  <span className="block text-[8px] font-black uppercase tracking-wide text-neutral-400">
                    {TIME_CLOCK_LABELS[type]}
                  </span>
                  <span className="mt-1 flex items-center justify-between gap-2">
                    <strong className="font-mono text-xs text-neutral-900">
                      {punch ? formatPunchTime(punch.punched_at) : "—"}
                    </strong>
                    {punch ? opening === punch.photo_path ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5 text-neutral-400" /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function PeriodSummary({
  days,
  view,
  selectedDate,
  onSelectDay,
}: {
  days: TimeClockDay[];
  view: Exclude<TimeClockHistoryView, "day">;
  selectedDate: string;
  onSelectDay: (date: string) => void;
}) {
  const summary = summarizeTimeClockDays(days);
  const week = timeClockWeekRange(selectedDate);
  const title = view === "week"
    ? `${shortDate(week.from)} a ${shortDate(week.to)}`
    : new Date(`${selectedDate.slice(0, 7)}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-neutral-400">
        Resumo {view === "week" ? "semanal" : "mensal"}
      </p>
      <h3 className="mt-1 text-base font-black capitalize text-neutral-950">{title}</h3>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <MiniMetric icon={Clock3} label="Trabalhado" value={formatWorked(summary.workedMinutes)} />
        <MiniMetric icon={TimerReset} label="Saldo" value={formatTimeClockMinutes(summary.bankMinutes)} />
        <MiniMetric label="Atrasos" value={formatWorked(summary.lateMinutes)} />
        <MiniMetric label="Dias completos" value={`${summary.completedDays}/${summary.totalDays}`} />
      </div>
      <div className="mt-3 max-h-56 space-y-1.5 overflow-y-auto pr-1">
        {days.length ? days.map((day) => (
          <button
            type="button"
            key={day.work_date}
            onClick={() => onSelectDay(day.work_date)}
            className="flex w-full items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-left transition hover:border-yellow-300"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-xs font-black">
              {Number(day.work_date.slice(-2))}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-black capitalize text-neutral-800">
                {new Date(`${day.work_date}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long" })}
              </span>
              <span className="block text-[9px] text-neutral-400">{day.punches.length}/4 marcações</span>
            </span>
            <strong className={`text-[11px] ${balanceColor(day.bank_minutes)}`}>
              {formatTimeClockMinutes(day.bank_minutes)}
            </strong>
          </button>
        )) : (
          <p className="rounded-xl border border-dashed border-neutral-200 bg-white px-4 py-8 text-center text-xs text-neutral-500">
            Nenhum dia útil neste período.
          </p>
        )}
      </div>
    </div>
  );
}

function MiniMetric({
  icon: Icon,
  label,
  value,
}: {
  icon?: typeof Clock3;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-2.5">
      <p className="flex items-center gap-1 text-[8px] font-black uppercase tracking-wide text-neutral-400">
        {Icon ? <Icon className="h-3 w-3" /> : null}{label}
      </p>
      <p className="mt-1 text-sm font-black text-neutral-900">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: TimeClockDay["status"] }) {
  const copy = status === "completo" ? "Completo" : status === "em_andamento" ? "Em andamento" : status === "sem_registro" ? "Sem registro" : "Pendente";
  return <Badge variant="outline" className={status === "completo" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : status === "sem_registro" ? "border-red-200 bg-red-50 text-red-700" : "border-neutral-200 bg-neutral-50 text-neutral-600"}>{copy}</Badge>;
}

function saoPauloDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function monthFromDate(date: string) {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

function statusDot(status?: TimeClockDay["status"], weekend = false) {
  if (weekend) return "bg-neutral-300";
  if (status === "completo") return "bg-emerald-500";
  if (status === "em_andamento") return "bg-yellow-500";
  if (status === "sem_registro") return "bg-red-400";
  return "bg-neutral-300";
}

function balanceColor(value: number | null) {
  if ((value ?? 0) > 0) return "text-emerald-700";
  if ((value ?? 0) < 0) return "text-red-600";
  return "text-neutral-600";
}

function shortDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function formatWorked(value: number | null | undefined) {
  return formatTimeClockMinutes(value).replace(/^\+/, "");
}

function timeClockMonthRangeFallback(year: number, month: number, today: string) {
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  if (monthKey === today.slice(0, 7)) return today;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${monthKey}-${String(lastDay).padStart(2, "0")}`;
}
