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
import {
  CalendarCheck2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  RefreshCw,
  Users2,
} from "lucide-react";
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
type Sdr = Closer;
type Appointment = {
  id: string;
  seller_id: string | null;
  sdr_id: string | null;
  assigned_closer_id: string | null;
  scheduled_at: string;
  created_at: string;
  status: string;
  type: string;
  title: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  duration_minutes: number | null;
};
type LinkSendEvent = {
  id: string;
  seller_id: string;
  source_sdr_id: string | null;
  profile_role: string;
  channel: string;
  created_at: string;
};
type SignupAttribution = {
  id: string;
  seller_id: string;
  profile_role: string;
  registered_email: string;
  created_at: string;
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
  const [sdrs, setSdrs] = useState<Sdr[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [sdrMeetings, setSdrMeetings] = useState<Appointment[]>([]);
  const [linkSendEvents, setLinkSendEvents] = useState<LinkSendEvent[]>([]);
  const [signupAttributions, setSignupAttributions] = useState<SignupAttribution[]>([]);
  const [selected, setSelected] = useState("all");
  const [selectedSdrId, setSelectedSdrId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const from = startOfMonth(anchor);
    const to = addMonths(from, 1);
    const [
      closerResult,
      sdrResult,
      appointmentResult,
      sdrMeetingResult,
      linkSendResult,
      attributionResult,
    ] = await Promise.all([
      (supabase.from("internal_users" as any) as any)
        .select("id, full_name, email")
        .eq("role", "vendedor")
        .eq("seller_type", "closer")
        .eq("status", "ativo")
        .order("full_name"),
      (supabase.from("internal_users" as any) as any)
        .select("id, full_name, email")
        .eq("role", "vendedor")
        .eq("seller_type", "sdr")
        .eq("status", "ativo")
        .order("full_name"),
      (supabase.from("seller_appointments" as any) as any)
        .select(
          "id, seller_id, sdr_id, assigned_closer_id, scheduled_at, created_at, status, type, title, contact_name, contact_phone, duration_minutes",
        )
        .gte("scheduled_at", from.toISOString())
        .lt("scheduled_at", to.toISOString())
        .order("scheduled_at"),
      (supabase.from("seller_appointments" as any) as any)
        .select(
          "id, seller_id, sdr_id, assigned_closer_id, scheduled_at, created_at, status, type, title, contact_name, contact_phone, duration_minutes",
        )
        .eq("type", "reuniao")
        .neq("status", "cancelado")
        .not("sdr_id", "is", null)
        .gte("created_at", from.toISOString())
        .lt("created_at", to.toISOString())
        .order("created_at", { ascending: false }),
      (supabase.from("seller_signup_link_send_events" as any) as any)
        .select("id, seller_id, source_sdr_id, profile_role, channel, created_at")
        .gte("created_at", from.toISOString())
        .lt("created_at", to.toISOString())
        .order("created_at", { ascending: false }),
      (supabase.from("seller_signup_attributions" as any) as any)
        .select("id, seller_id, profile_role, registered_email, created_at")
        .eq("seller_type", "sdr")
        .gte("created_at", from.toISOString())
        .lt("created_at", to.toISOString())
        .order("created_at", { ascending: false }),
    ]);
    setClosers((closerResult.data as Closer[] | null) ?? []);
    setSdrs((sdrResult.data as Sdr[] | null) ?? []);
    setAppointments((appointmentResult.data as Appointment[] | null) ?? []);
    setSdrMeetings((sdrMeetingResult.data as Appointment[] | null) ?? []);
    setLinkSendEvents((linkSendResult.data as LinkSendEvent[] | null) ?? []);
    setSignupAttributions((attributionResult.data as SignupAttribution[] | null) ?? []);
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_signup_link_send_events" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_signup_attributions" },
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
  const sdrPerformance = useMemo(
    () =>
      sdrs.map((sdr) => ({
        sdr,
        meetings: sdrMeetings.filter((item) => item.sdr_id === sdr.id),
        sends: linkSendEvents.filter(
          (event) => event.seller_id === sdr.id || event.source_sdr_id === sdr.id,
        ),
        registrations: signupAttributions.filter((item) => item.seller_id === sdr.id),
      })),
    [linkSendEvents, sdrMeetings, sdrs, signupAttributions],
  );
  const selectedSdr = sdrPerformance.find((item) => item.sdr.id === selectedSdrId) ?? null;
  const selectedDayRows = selectedDay
    ? filtered.filter((item) => isSameDay(new Date(item.scheduled_at), selectedDay))
    : [];

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
              <SelectTrigger className="w-full sm:w-64">
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
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarCheck2 className="h-5 w-5 text-yellow-600" /> Desempenho dos SDRs
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Reuniões marcadas, links enviados e cadastros concluídos no mês selecionado.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric title="Reuniões marcadas" value={sdrMeetings.length} subtitle="pelos SDRs" />
              <Metric
                title="Links enviados"
                value={
                  linkSendEvents.filter((event) =>
                    sdrs.some(
                      (sdr) => event.seller_id === sdr.id || event.source_sdr_id === sdr.id,
                    ),
                  ).length
                }
                subtitle="ações registradas"
              />
              <Metric title="Cadastros" value={signupAttributions.length} subtitle="concluídos" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {sdrPerformance.map((item) => (
                <button
                  key={item.sdr.id}
                  type="button"
                  onClick={() =>
                    setSelectedSdrId((current) => (current === item.sdr.id ? null : item.sdr.id))
                  }
                  className={`rounded-xl border p-4 text-left transition ${selectedSdrId === item.sdr.id ? "border-yellow-400 bg-yellow-50" : "border-neutral-200 hover:border-yellow-300"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="truncate text-sm">
                      {item.sdr.full_name || item.sdr.email || "SDR"}
                    </strong>
                    <Badge variant="outline">SDR</Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <SdrCount label="Reuniões" value={item.meetings.length} />
                    <SdrCount label="Links" value={item.sends.length} />
                    <SdrCount label="Cadastros" value={item.registrations.length} />
                  </div>
                </button>
              ))}
              {sdrPerformance.length === 0 && (
                <p className="col-span-full py-6 text-center text-sm text-muted-foreground">
                  Nenhum SDR ativo encontrado.
                </p>
              )}
            </div>

            {selectedSdr && (
              <div className="rounded-2xl border border-yellow-300 bg-yellow-50/50 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-yellow-700">
                      Detalhamento individual
                    </p>
                    <h3 className="mt-1 text-lg font-black">
                      {selectedSdr.sdr.full_name || selectedSdr.sdr.email || "SDR"}
                    </h3>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setSelectedSdrId(null)}>
                    Fechar detalhes
                  </Button>
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-3">
                  <SdrDetailColumn
                    title="Reuniões marcadas"
                    empty="Nenhuma reunião marcada neste mês."
                    rows={selectedSdr.meetings.map((meeting) => ({
                      id: meeting.id,
                      title: meeting.contact_name || meeting.title || "Reunião",
                      detail: `${format(new Date(meeting.scheduled_at), "dd/MM 'às' HH:mm")} · ${closers.find((closer) => closer.id === ownerId(meeting))?.full_name || "Closer"}`,
                    }))}
                  />
                  <SdrDetailColumn
                    title="Links enviados"
                    empty="Nenhum envio registrado neste mês."
                    rows={selectedSdr.sends.map((event) => ({
                      id: event.id,
                      title: `${roleLabel(event.profile_role)} · ${channelLabel(event.channel)}`,
                      detail: format(new Date(event.created_at), "dd/MM/yyyy 'às' HH:mm"),
                    }))}
                  />
                  <SdrDetailColumn
                    title="Cadastros concluídos"
                    empty="Nenhum cadastro concluído neste mês."
                    rows={selectedSdr.registrations.map((registration) => ({
                      id: registration.id,
                      title: roleLabel(registration.profile_role),
                      detail: `${registration.registered_email} · ${format(new Date(registration.created_at), "dd/MM 'às' HH:mm")}`,
                    }))}
                  />
                </div>
              </div>
            )}
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
            <div className="md:hidden">
              <div className="grid grid-cols-7 text-center text-[9px] font-black uppercase text-neutral-400">
                {["S", "T", "Q", "Q", "S", "S", "D"].map((label, index) => (
                  <div key={`${label}-${index}`} className="py-2">
                    {label}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {days.map((day, index) => {
                  const rows = day
                    ? filtered.filter((item) => isSameDay(new Date(item.scheduled_at), day))
                    : [];
                  const active = Boolean(day && selectedDay && isSameDay(day, selectedDay));
                  return day ? (
                    <button
                      key={day.toISOString()}
                      type="button"
                      onClick={() => setSelectedDay(day)}
                      className={`relative flex min-h-14 flex-col items-center justify-center rounded-xl border text-xs font-black ${active ? "border-yellow-500 bg-yellow-100" : isSameDay(day, now) ? "border-yellow-300 bg-yellow-50" : "border-neutral-200 bg-white"}`}
                    >
                      {day.getDate()}
                      {rows.length > 0 && (
                        <span className="mt-1 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[8px] text-white">
                          {rows.length}
                        </span>
                      )}
                    </button>
                  ) : (
                    <span key={`blank-${index}`} className="min-h-14" />
                  );
                })}
              </div>
              <div className="mt-4 rounded-xl bg-neutral-50 p-3">
                <p className="text-xs font-black uppercase tracking-wider text-neutral-500">
                  {selectedDay
                    ? format(selectedDay, "dd 'de' MMMM", { locale: ptBR })
                    : "Toque em um dia para ver as reuniões"}
                </p>
                {selectedDay && selectedDayRows.length === 0 && (
                  <p className="mt-2 text-sm text-neutral-500">Nenhuma reunião neste dia.</p>
                )}
                <div className="mt-2 space-y-2">
                  {selectedDayRows.map((item) => {
                    const closer = closers.find((value) => value.id === ownerId(item));
                    return (
                      <div
                        key={item.id}
                        className="rounded-lg border border-emerald-200 bg-white p-3"
                      >
                        <p className="text-sm font-black">
                          {format(new Date(item.scheduled_at), "HH:mm")} ·{" "}
                          {item.contact_name || item.title || "Reunião"}
                        </p>
                        <p className="mt-1 text-xs text-neutral-500">
                          {closer?.full_name || "Closer"} · {item.contact_phone || "Sem telefone"}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="hidden grid-cols-7 border-l border-t text-center text-[10px] font-black uppercase text-neutral-400 md:grid">
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

function SdrCount({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-lg bg-neutral-50 px-2 py-2">
      <b className="block text-xl text-neutral-950">{value}</b>
      <small className="text-[9px] font-bold uppercase text-neutral-500">{label}</small>
    </span>
  );
}

function SdrDetailColumn({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: { id: string; title: string; detail: string }[];
}) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-3">
      <h4 className="text-sm font-black">{title}</h4>
      <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
        {rows.slice(0, 20).map((row) => (
          <div key={row.id} className="rounded-lg bg-neutral-50 p-2.5">
            <p className="text-xs font-bold text-neutral-900">{row.title}</p>
            <p className="mt-1 break-words text-[10px] text-neutral-500">{row.detail}</p>
          </div>
        ))}
        {rows.length === 0 && <p className="py-4 text-xs text-neutral-500">{empty}</p>}
        {rows.length > 20 && (
          <p className="text-center text-[10px] font-bold text-neutral-500">
            +{rows.length - 20} registros neste mês
          </p>
        )}
      </div>
    </section>
  );
}

function roleLabel(role: string) {
  if (role === "proprietario") return "Proprietário";
  if (role === "imobiliaria") return "Imobiliária";
  return "Corretor";
}

function channelLabel(channel: string) {
  if (channel === "whatsapp") return "WhatsApp";
  if (channel === "share") return "Compartilhamento";
  return "Cópia do link";
}
