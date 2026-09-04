import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Camera,
  Check,
  Clock3,
  History,
  Image as ImageIcon,
  Loader2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  TimerReset,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  createTimeClockPhotoUrl,
  defaultTimeClockRange,
  fetchMyTimeClockDashboard,
  formatPunchTime,
  formatTimeClockMinutes,
  registerTimeClockPunch,
  TIME_CLOCK_CLASSIFICATION_LABELS,
  TIME_CLOCK_LABELS,
  type TimeClockClassification,
  type TimeClockDashboard,
  type TimeClockDay,
  type TimeClockPunchType,
} from "@/lib/time-clock";

export const Route = createFileRoute("/vendedor/ponto")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin"]}>
      <TimeClockPage />
    </ProtectedRoute>
  ),
});

const PUNCH_TYPES: TimeClockPunchType[] = ["entrada", "inicio_intervalo", "fim_intervalo", "saida"];
const DATE_FORMAT = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" });

function TimeClockPage() {
  const range = useMemo(defaultTimeClockRange, []);
  const [dashboard, setDashboard] = useState<TimeClockDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(new Date());
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      setDashboard(await fetchMyTimeClockDashboard(range.from, range.to));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar o ponto.");
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => void load(), [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const selectPhoto = (file?: File) => {
    if (preview) URL.revokeObjectURL(preview);
    setPhoto(file ?? null);
    setPreview(file ? URL.createObjectURL(file) : "");
  };

  const openPunch = () => {
    if (!dashboard?.next_punch_type) return;
    selectPhoto();
    setDialogOpen(true);
  };

  const submit = async () => {
    if (!dashboard?.next_punch_type || !photo) return;
    setSubmitting(true);
    try {
      const result = await registerTimeClockPunch(dashboard.next_punch_type, photo);
      toast.success(result.message);
      if (result.emailWarning) toast.warning(result.emailWarning);
      setDialogOpen(false);
      selectPhoto();
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível registrar o ponto.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DashboardLayout>
      <main className="space-y-5 pb-8 text-neutral-950">
        <section className="relative overflow-hidden rounded-[26px] border border-yellow-300 bg-[radial-gradient(circle_at_90%_12%,rgba(250,204,21,.3),transparent_26%),linear-gradient(120deg,#171717_0%,#202020_58%,#2c270f_100%)] p-5 text-white shadow-lg sm:p-7">
          <div className="absolute -right-14 -top-16 h-52 w-52 rounded-full border border-yellow-400/25" />
          <div className="absolute -right-4 -top-4 h-36 w-36 rounded-full border border-yellow-400/20" />
          <div className="relative grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <Badge className="border-yellow-400/40 bg-yellow-400/15 text-yellow-300 hover:bg-yellow-400/15">
                <Clock3 className="mr-1.5 h-3.5 w-3.5" /> Jornada NOX
              </Badge>
              <h1 className="mt-3 text-2xl font-black sm:text-3xl">Registrar ponto</h1>
              <p className="mt-1 max-w-xl text-sm text-neutral-300">
                Entrada, intervalo e saída com horário oficial do servidor e confirmação por foto.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/8 px-5 py-4 text-left backdrop-blur sm:min-w-56 sm:text-right">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-yellow-300">Horário de Brasília</p>
              <p className="mt-1 font-mono text-4xl font-black tracking-tight">
                {now.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </p>
              <p className="mt-1 text-xs capitalize text-neutral-300">
                {DATE_FORMAT.format(new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })))}
              </p>
            </div>
          </div>
        </section>

        {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={load} /> : dashboard ? (
          <>
            {!dashboard.enabled ? <DisabledState /> : (
              <div className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
                <Card className="overflow-hidden border-neutral-200 shadow-sm">
                  <CardHeader className="border-b border-neutral-100 bg-neutral-50/70">
                    <CardTitle className="flex items-center justify-between gap-3 text-base">
                      <span className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-yellow-600" /> Marcações de hoje</span>
                      <Badge variant={dashboard.today.status === "completo" ? "default" : "outline"}>
                        {dashboard.today.punches.length}/4 concluídas
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 sm:p-6">
                    <div className="grid gap-3 sm:grid-cols-4">
                      {PUNCH_TYPES.map((type, index) => {
                        const punch = dashboard.today.punches.find((item) => item.type === type);
                        const active = dashboard.next_punch_type === type;
                        return <PunchStep key={type} type={type} index={index} punch={punch} active={active} />;
                      })}
                    </div>
                    <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-yellow-200 bg-yellow-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-black">
                          {dashboard.next_punch_type ? `Próxima marcação: ${TIME_CLOCK_LABELS[dashboard.next_punch_type]}` : "Jornada registrada por completo"}
                        </p>
                        <p className="mt-0.5 text-xs text-neutral-600">
                          {dashboard.next_punch_type ? "Tire uma foto agora; imagens da galeria não são necessárias." : "Seu saldo diário já foi apurado e aparece no histórico."}
                        </p>
                      </div>
                      <Button onClick={openPunch} disabled={!dashboard.next_punch_type} className="h-11 rounded-xl bg-neutral-950 font-black text-white hover:bg-neutral-800">
                        {dashboard.next_punch_type ? <><Camera className="mr-2 h-4 w-4" /> Registrar com foto</> : <><Check className="mr-2 h-4 w-4" /> Concluído</>}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                  <SummaryCard icon={TimerReset} title="Banco de horas" value={formatTimeClockMinutes(dashboard.bank_balance_minutes)} description="Saldo acumulado dos dias completos" emphasized />
                  <Card className="border-neutral-200 shadow-sm">
                    <CardContent className="p-5">
                      <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-600" /><div><p className="text-sm font-black">Jornada configurada</p><p className="mt-1 text-xs leading-5 text-neutral-600">Seg–qui: 08h–12h e 13h–18h<br />Sex: 08h–12h e 13h–17h30</p></div></div>
                      <div className="mt-4 border-t border-neutral-100 pt-4 text-[11px] leading-4 text-neutral-500">
                        Tolerância: até 5 min por marcação e 10 min no dia. O saldo só fecha após as quatro marcações.
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            <HistorySection days={dashboard.history} onRefresh={load} />
          </>
        ) : null}
      </main>

      <Dialog open={dialogOpen} onOpenChange={(open) => !submitting && setDialogOpen(open)}>
        <DialogContent className="max-w-md overflow-hidden rounded-[24px] p-0">
          <DialogHeader className="border-b border-neutral-100 bg-yellow-50 px-6 py-5 text-left">
            <DialogTitle className="flex items-center gap-2"><Camera className="h-5 w-5 text-yellow-700" /> Confirmar {dashboard?.next_punch_type ? TIME_CLOCK_LABELS[dashboard.next_punch_type].toLowerCase() : "marcação"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 py-5">
            <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="user" className="hidden" onChange={(event) => selectPhoto(event.target.files?.[0])} />
            {preview ? (
              <button type="button" onClick={() => inputRef.current?.click()} className="group relative block aspect-[4/3] w-full overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-100">
                <img src={preview} alt="Prévia da foto do registro de ponto" className="h-full w-full object-cover" />
                <span className="absolute inset-x-3 bottom-3 rounded-xl bg-black/70 px-3 py-2 text-xs font-bold text-white backdrop-blur">Toque para refazer a foto</span>
              </button>
            ) : (
              <button type="button" onClick={() => inputRef.current?.click()} className="flex aspect-[4/3] w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-yellow-300 bg-yellow-50 text-center transition hover:bg-yellow-100">
                <span className="rounded-2xl bg-yellow-400 p-3"><Camera className="h-6 w-6 text-neutral-950" /></span>
                <strong className="mt-3 text-sm">Abrir câmera</strong>
                <span className="mt-1 max-w-64 text-xs text-neutral-500">A foto é obrigatória e deve mostrar você no momento da marcação.</span>
              </button>
            )}
            <div className="flex gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-[11px] leading-4 text-neutral-600">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-neutral-800" />
              <p>A imagem é privada, acessível somente por você e administradores autorizados. Não fazemos reconhecimento facial.</p>
            </div>
          </div>
          <DialogFooter className="border-t border-neutral-100 bg-neutral-50 px-6 py-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>Cancelar</Button>
            <Button onClick={submit} disabled={!photo || submitting} className="bg-neutral-950 text-white hover:bg-neutral-800">
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />} Confirmar ponto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

function PunchStep({ type, index, punch, active }: { type: TimeClockPunchType; index: number; punch?: TimeClockDay["punches"][number]; active: boolean }) {
  return (
    <div className={`relative rounded-2xl border p-3.5 ${punch ? "border-emerald-200 bg-emerald-50" : active ? "border-yellow-400 bg-yellow-50 ring-2 ring-yellow-100" : "border-neutral-200 bg-neutral-50"}`}>
      <div className="flex items-center justify-between"><span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-black ${punch ? "bg-emerald-600 text-white" : active ? "bg-yellow-400 text-neutral-950" : "bg-neutral-200 text-neutral-500"}`}>{punch ? <Check className="h-4 w-4" /> : index + 1}</span>{active && <span className="text-[9px] font-black uppercase tracking-wider text-yellow-700">Agora</span>}</div>
      <p className="mt-3 text-xs font-black leading-4">{TIME_CLOCK_LABELS[type]}</p>
      <p className="mt-1 font-mono text-lg font-black">{punch ? formatPunchTime(punch.punched_at) : "--:--"}</p>
      {punch && <p className="mt-1 text-[9px] font-bold text-neutral-500">{TIME_CLOCK_CLASSIFICATION_LABELS[punch.classification]}</p>}
    </div>
  );
}

function HistorySection({ days, onRefresh }: { days: TimeClockDay[]; onRefresh: () => Promise<void> }) {
  return (
    <Card className="overflow-hidden border-neutral-200 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-neutral-100">
        <div><CardTitle className="flex items-center gap-2 text-base"><History className="h-5 w-5 text-yellow-600" /> Meu histórico</CardTitle><p className="mt-1 text-xs text-neutral-500">Dias úteis do mês, com detalhes e saldo individual.</p></div>
        <Button variant="outline" size="icon" className="rounded-xl" onClick={() => void onRefresh()} aria-label="Atualizar histórico"><RefreshCw className="h-4 w-4" /></Button>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-neutral-100">
          {days.map((day) => <HistoryDay key={day.work_date} day={day} />)}
        </div>
      </CardContent>
    </Card>
  );
}

function HistoryDay({ day }: { day: TimeClockDay }) {
  const [opening, setOpening] = useState<string | null>(null);
  const openPhoto = async (path: string) => {
    setOpening(path);
    try {
      window.open(await createTimeClockPhotoUrl(path), "_blank", "noopener,noreferrer");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível abrir a foto.");
    } finally { setOpening(null); }
  };
  const date = new Date(`${day.work_date}T12:00:00`);
  return (
    <div className="grid gap-3 px-4 py-4 sm:grid-cols-[170px_1fr_auto] sm:items-center sm:px-6">
      <div><p className="text-sm font-black capitalize">{date.toLocaleDateString("pt-BR", { weekday: "long" })}</p><p className="text-xs text-neutral-500">{date.toLocaleDateString("pt-BR")}</p></div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {PUNCH_TYPES.map((type) => { const punch = day.punches.find((item) => item.type === type); return <div key={type} className="rounded-xl bg-neutral-50 px-3 py-2"><p className="text-[9px] font-bold uppercase tracking-wide text-neutral-400">{TIME_CLOCK_LABELS[type]}</p><div className="mt-1 flex items-center gap-2"><strong className="font-mono text-xs">{punch ? formatPunchTime(punch.punched_at) : "—"}</strong>{punch && <button onClick={() => void openPhoto(punch.photo_path)} className="text-neutral-400 hover:text-yellow-600" aria-label={`Abrir foto de ${TIME_CLOCK_LABELS[type]}`}>{opening === punch.photo_path ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImageIcon className="h-3 w-3" />}</button>}</div></div>; })}
      </div>
      <div className="flex items-center justify-between gap-4 sm:min-w-32 sm:flex-col sm:items-end sm:justify-center">
        <StatusBadge status={day.status} />
        <div className="text-right"><p className={`text-sm font-black ${(day.bank_minutes ?? 0) > 0 ? "text-emerald-700" : (day.bank_minutes ?? 0) < 0 ? "text-red-600" : "text-neutral-700"}`}>{formatTimeClockMinutes(day.bank_minutes)}</p><p className="text-[9px] uppercase text-neutral-400">saldo do dia</p></div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: TimeClockDay["status"] }) {
  const copy = status === "completo" ? "Completo" : status === "em_andamento" ? "Em andamento" : status === "sem_registro" ? "Sem registro" : "Pendente";
  return <Badge variant="outline" className={status === "completo" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : status === "sem_registro" ? "border-red-200 bg-red-50 text-red-700" : "border-neutral-200 bg-neutral-50 text-neutral-600"}>{copy}</Badge>;
}

function SummaryCard({ icon: Icon, title, value, description, emphasized = false }: { icon: typeof Clock3; title: string; value: string; description: string; emphasized?: boolean }) {
  return <Card className={emphasized ? "border-yellow-300 bg-yellow-50 shadow-sm" : "border-neutral-200 shadow-sm"}><CardContent className="flex items-center gap-4 p-5"><span className="rounded-2xl bg-yellow-400 p-3"><Icon className="h-5 w-5" /></span><div><p className="text-xs font-bold text-neutral-500">{title}</p><p className="mt-0.5 text-2xl font-black">{value}</p><p className="text-[10px] text-neutral-500">{description}</p></div></CardContent></Card>;
}

function DisabledState() {
  return <Card className="border-dashed border-yellow-300 bg-yellow-50/60"><CardContent className="flex flex-col items-center px-6 py-12 text-center"><span className="rounded-3xl bg-yellow-400 p-4"><LockKeyhole className="h-7 w-7" /></span><h2 className="mt-4 text-xl font-black">Controle de ponto desativado</h2><p className="mt-2 max-w-lg text-sm leading-6 text-neutral-600">Seu histórico permanece disponível, mas novas marcações dependem da ativação pelo administrador na ficha do vendedor.</p></CardContent></Card>;
}

function LoadingState() { return <div className="grid gap-4 md:grid-cols-3"><div className="h-64 animate-pulse rounded-3xl bg-neutral-100 md:col-span-2" /><div className="h-64 animate-pulse rounded-3xl bg-neutral-100" /></div>; }
function ErrorState({ message, onRetry }: { message: string; onRetry: () => Promise<void> }) { return <Card className="border-red-200 bg-red-50"><CardContent className="flex flex-col items-center px-6 py-10 text-center"><AlertTriangle className="h-7 w-7 text-red-600" /><p className="mt-3 font-black">Não foi possível abrir o controle de ponto</p><p className="mt-1 text-sm text-red-700">{message}</p><Button className="mt-4" variant="outline" onClick={() => void onRetry()}><RefreshCw className="mr-2 h-4 w-4" /> Tentar novamente</Button></CardContent></Card>; }
