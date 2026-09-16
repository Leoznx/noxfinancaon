import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isWithinInterval,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, RefreshCw, Users2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

type Closer = { id: string; full_name: string | null; email: string | null };
type Appointment = {
  id: string;
  seller_id: string | null;
  assigned_closer_id: string | null;
  scheduled_at: string;
  status: string;
  type: string;
  title: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  duration_minutes: number | null;
};

export const Route = createFileRoute("/admin/agenda-closers")({
  component: () => (
    <ProtectedRoute roles={["admin", "admin_master", "analista"]} moduleKey="equipe_nox">
      <CloserAgendaPage />
    </ProtectedRoute>
  ),
});

function ownerId(item: Appointment) {
  return item.assigned_closer_id || item.seller_id || "";
}
function activeMeeting(item: Appointment) {
  return item.type === "reuniao" && item.status !== "cancelado";
}

function CloserAgendaPage() {
  const [anchor, setAnchor] = useState(startOfMonth(new Date()));
  const [closers, setClosers] = useState<Closer[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selected, setSelected] = useState("all");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const from = startOfMonth(anchor);
    const to = addMonths(from, 1);
    const [closerResult, appointmentResult] = await Promise.all([
      (supabase.from("internal_users" as any) as any)
        .select("id, full_name, email")
        .eq("role", "vendedor")
        .eq("seller_type", "closer")
        .eq("status", "ativo")
        .order("full_name"),
      (supabase.from("seller_appointments" as any) as any)
        .select(
          "id, seller_id, assigned_closer_id, scheduled_at, status, type, title, contact_name, contact_phone, duration_minutes",
        )
        .gte("scheduled_at", from.toISOString())
        .lt("scheduled_at", to.toISOString())
        .order("scheduled_at"),
    ]);
    setClosers((closerResult.data as Closer[] | null) ?? []);
    setAppointments((appointmentResult.data as Appointment[] | null) ?? []);
    setLoading(false);
  }, [anchor]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const channel = supabase
      .channel("admin-closer-agenda-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_appointments" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "internal_users" },
        () => void load(),
      )
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [load]);

  const filtered = useMemo(
    () =>
      appointments.filter(
        (item) => activeMeeting(item) && (selected === "all" || ownerId(item) === selected),
      ),
    [appointments, selected],
  );
  const now = new Date();
  const period = (() => {
    const day = filtered.filter((item) => isSameDay(new Date(item.scheduled_at), now)).length;
    const weekRange = {
      start: startOfWeek(now, { weekStartsOn: 1 }),
      end: endOfWeek(now, { weekStartsOn: 1 }),
    };
    const week = filtered.filter((item) =>
      isWithinInterval(new Date(item.scheduled_at), weekRange),
    ).length;
    return { day, week, month: filtered.length };
  })();
  const first = startOfMonth(anchor);
  const leading = (first.getDay() + 6) % 7;
  const days = Array.from({ length: leading + endOfMonth(anchor).getDate() }, (_, index) =>
    index < leading ? null : new Date(anchor.getFullYear(), anchor.getMonth(), index - leading + 1),
  );

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-neutral-950 p-5 text-white">
          <div>
            <Badge className="bg-yellow-400 text-neutral-950">
              <CalendarDays className="mr-1 h-3.5 w-3.5" /> Controle de escala
            </Badge>
            <h1 className="mt-3 text-2xl font-black">Agenda geral dos Closers</h1>
            <p className="mt-1 text-sm text-neutral-300">
              Visão em tempo real das reuniões e da capacidade da equipe.
            </p>
          </div>
          <Button
            variant="outline"
            className="border-neutral-700 bg-neutral-900 text-white hover:bg-neutral-800"
            onClick={() => void load()}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        </section>
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric title="Hoje" value={period.day} subtitle="reuniões" />
          <Metric title="Esta semana" value={period.week} subtitle="reuniões" />
          <Metric title="Este mês" value={period.month} subtitle="reuniões" />
        </div>
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Escala por Closer</CardTitle>
              <p className="text-sm text-muted-foreground">
                Clique em um profissional para filtrar calendário e resumo.
              </p>
            </div>
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Closers</SelectItem>
                {closers.map((closer) => (
                  <SelectItem key={closer.id} value={closer.id}>
                    {closer.full_name || closer.email || "Closer"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {closers.map((closer) => {
                const rows = appointments.filter(
                  (item) => activeMeeting(item) && ownerId(item) === closer.id,
                );
                const today = rows.filter((item) =>
                  isSameDay(new Date(item.scheduled_at), now),
                ).length;
                return (
                  <button
                    key={closer.id}
                    type="button"
                    onClick={() => setSelected(closer.id)}
                    className={`rounded-xl border p-4 text-left transition ${selected === closer.id ? "border-yellow-400 bg-yellow-50" : "border-neutral-200 hover:border-yellow-300"}`}
                  >
                    <div className="flex items-center justify-between">
                      <strong className="truncate text-sm">{closer.full_name || "Closer"}</strong>
                      <Badge variant="outline">Closer</Badge>
                    </div>
                    <div className="mt-3 flex gap-4 text-xs text-neutral-500">
                      <span>
                        <b className="text-lg text-neutral-950">{today}</b> hoje
                      </span>
                      <span>
                        <b className="text-lg text-neutral-950">{rows.length}</b> mês
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="capitalize">
              {format(anchor, "MMMM 'de' yyyy", { locale: ptBR })}
            </CardTitle>
            <div className="flex gap-2">
              <Button
                size="icon"
                variant="outline"
                onClick={() => setAnchor((date) => addMonths(date, -1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                onClick={() => setAnchor((date) => addMonths(date, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 border-l border-t text-center text-[10px] font-black uppercase text-neutral-400">
              {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((label) => (
                <div key={label} className="border-b border-r p-2">
                  {label}
                </div>
              ))}
              {days.map((day, index) => {
                const rows = day
                  ? filtered.filter((item) => isSameDay(new Date(item.scheduled_at), day))
                  : [];
                return (
                  <div
                    key={index}
                    className={`min-h-28 border-b border-r p-2 text-left ${day && isSameDay(day, now) ? "bg-yellow-50" : "bg-white"}`}
                  >
                    {day && (
                      <>
                        <strong className="text-xs">{day.getDate()}</strong>
                        <div className="mt-1 space-y-1">
                          {rows.slice(0, 4).map((item) => {
                            const closer = closers.find((value) => value.id === ownerId(item));
                            return (
                              <div
                                key={item.id}
                                className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[9px] leading-3 text-emerald-900"
                              >
                                <b>{format(new Date(item.scheduled_at), "HH:mm")}</b>{" "}
                                {item.contact_name || item.title || "Reunião"}
                                <span className="block truncate text-emerald-700">
                                  {closer?.full_name || "Closer"}
                                </span>
                              </div>
                            );
                          })}
                          {rows.length > 4 && (
                            <span className="text-[9px] text-neutral-500">
                              +{rows.length - 4} reuniões
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock3 className="h-5 w-5 text-yellow-600" /> Próximas reuniões do mês
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {filtered
              .filter((item) => new Date(item.scheduled_at) >= startOfDay(now))
              .slice(0, 12)
              .map((item) => {
                const closer = closers.find((value) => value.id === ownerId(item));
                return (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <p className="font-bold">{item.contact_name || item.title || "Reunião"}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(item.scheduled_at), "dd/MM/yyyy 'às' HH:mm")} ·{" "}
                        {item.contact_phone || "Telefone não informado"}
                      </p>
                    </div>
                    <Badge variant="outline">{closer?.full_name || "Closer"}</Badge>
                  </div>
                );
              })}
            {filtered.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nenhuma reunião neste período.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function Metric({ title, value, subtitle }: { title: string; value: number; subtitle: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-yellow-100">
          <Users2 className="h-5 w-5 text-yellow-700" />
        </span>
        <div>
          <p className="text-xs font-bold uppercase text-neutral-400">{title}</p>
          <p className="text-2xl font-black">
            {value} <span className="text-xs font-semibold text-neutral-500">{subtitle}</span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
