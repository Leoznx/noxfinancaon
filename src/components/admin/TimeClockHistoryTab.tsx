import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, Clock3, Filter, Loader2, RefreshCw, TimerReset, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  createTimeClockPhotoUrl,
  defaultTimeClockRange,
  fetchAdminTimeClockHistory,
  formatPunchTime,
  formatTimeClockMinutes,
  TIME_CLOCK_CLASSIFICATION_LABELS,
  TIME_CLOCK_LABELS,
  type TimeClockDay,
} from "@/lib/time-clock";

type SellerOption = { id: string; full_name: string | null; seller_type: string | null };

export function TimeClockHistoryTab() {
  const defaults = useMemo(defaultTimeClockRange, []);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [employeeId, setEmployeeId] = useState("all");
  const [sellers, setSellers] = useState<SellerOption[]>([]);
  const [rows, setRows] = useState<TimeClockDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [photo, setPhoto] = useState<{ url: string; title: string } | null>(null);
  const [openingPhoto, setOpeningPhoto] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [history, sellersResult] = await Promise.all([
        fetchAdminTimeClockHistory(from, to, employeeId === "all" ? undefined : employeeId),
        (supabase as any).from("internal_users").select("id, full_name, seller_type").eq("role", "vendedor").neq("status", "excluido").order("full_name"),
      ]);
      if (sellersResult.error) throw sellersResult.error;
      setRows(history.rows ?? []);
      setSellers((sellersResult.data as SellerOption[]) ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar o histórico.");
    } finally { setLoading(false); }
  }, [employeeId, from, to]);

  useEffect(() => void load(), [load]);

  const summary = useMemo(() => ({
    employees: new Set(rows.map((row) => row.employee_id)).size,
    completed: rows.filter((row) => row.status === "completo").length,
    delays: rows.reduce((sum, row) => sum + Number(row.late_minutes || 0), 0),
    balance: rows.reduce((sum, row) => sum + Number(row.bank_minutes || 0), 0),
  }), [rows]);

  const openPhoto = async (path: string, title: string) => {
    setOpeningPhoto(path);
    try { setPhoto({ url: await createTimeClockPhotoUrl(path, 300), title }); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível abrir a foto."); }
    finally { setOpeningPhoto(null); }
  };

  return (
    <div className="space-y-4">
      <Card className="border-yellow-300 bg-[linear-gradient(120deg,#171717,#26220d)] text-white shadow-sm">
        <CardContent className="grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-6">
          <div><Badge className="bg-yellow-400 text-neutral-950 hover:bg-yellow-400"><Clock3 className="mr-1 h-3.5 w-3.5" /> Gestão de jornada</Badge><h2 className="mt-3 text-xl font-black">Histórico de ponto da equipe</h2><p className="mt-1 text-sm text-neutral-300">Auditoria individual das marcações, fotos privadas, atrasos e banco de horas.</p></div>
          <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            <Metric label="Vendedores" value={String(summary.employees)} />
            <Metric label="Dias completos" value={String(summary.completed)} />
            <Metric label="Atrasos" value={formatTimeClockMinutes(summary.delays)} danger={summary.delays > 0} />
            <Metric label="Saldo período" value={formatTimeClockMinutes(summary.balance)} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-neutral-200 shadow-sm">
        <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_170px_170px_auto] md:items-end">
          <div className="space-y-1.5"><Label htmlFor="point-seller">Vendedor</Label><Select value={employeeId} onValueChange={setEmployeeId}><SelectTrigger id="point-seller"><SelectValue placeholder="Todos" /></SelectTrigger><SelectContent><SelectItem value="all">Todos os vendedores</SelectItem>{sellers.map((seller) => <SelectItem value={seller.id} key={seller.id}>{seller.full_name || "Sem nome"} · {(seller.seller_type || "sdr").toUpperCase()}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label htmlFor="point-from">De</Label><Input id="point-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="point-to">Até</Label><Input id="point-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></div>
          <Button onClick={() => void load()} disabled={loading} className="bg-neutral-950 text-white hover:bg-neutral-800">{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Filter className="mr-2 h-4 w-4" />} Aplicar filtros</Button>
        </CardContent>
      </Card>

      {error ? <Card className="border-red-200 bg-red-50"><CardContent className="flex items-center gap-3 p-5 text-red-700"><AlertTriangle className="h-5 w-5 shrink-0" /><div className="flex-1"><p className="font-black">Histórico indisponível</p><p className="text-xs">{error}</p></div><Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" /> Tentar novamente</Button></CardContent></Card> : loading ? <div className="h-80 animate-pulse rounded-3xl bg-neutral-100" /> : rows.length === 0 ? <Card className="border-dashed"><CardContent className="flex flex-col items-center py-12 text-center"><Users className="h-8 w-8 text-neutral-300" /><p className="mt-3 font-black">Nenhum registro no período</p><p className="mt-1 text-sm text-neutral-500">Ative o ponto na ficha do vendedor e aguarde a primeira marcação.</p></CardContent></Card> : (
        <Card className="overflow-hidden border-neutral-200 shadow-sm">
          <CardHeader className="border-b border-neutral-100"><CardTitle className="text-base">Detalhamento diário</CardTitle></CardHeader>
          <CardContent className="divide-y divide-neutral-100 p-0">
            {rows.map((day) => (
              <div key={`${day.employee_id}-${day.work_date}`} className="grid gap-4 px-4 py-5 lg:grid-cols-[230px_1fr_150px] lg:items-center lg:px-6">
                <div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-sm font-black">{day.employee_name}</p><Badge variant="outline" className="text-[9px]">{(day.seller_type || "sdr").toUpperCase()}</Badge></div><p className="mt-0.5 truncate text-xs text-neutral-500">{day.employee_email}</p><p className="mt-2 text-xs font-bold capitalize">{formatWorkDate(day.work_date)}</p></div>
                <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                  {(["entrada", "inicio_intervalo", "fim_intervalo", "saida"] as const).map((type) => {
                    const punch = day.punches.find((item) => item.type === type);
                    return <div key={type} className={`rounded-xl border px-3 py-2 ${punch ? classificationStyle(punch.classification) : "border-neutral-200 bg-neutral-50"}`}><p className="text-[9px] font-black uppercase tracking-wide text-neutral-500">{TIME_CLOCK_LABELS[type]}</p><div className="mt-1 flex items-center justify-between gap-2"><strong className="font-mono text-sm">{punch ? formatPunchTime(punch.punched_at) : "—"}</strong>{punch && <button type="button" onClick={() => void openPhoto(punch.photo_path, `${day.employee_name} · ${TIME_CLOCK_LABELS[type]} · ${formatWorkDate(day.work_date)}`)} className="rounded-md p-1 text-neutral-500 hover:bg-white hover:text-yellow-700" aria-label={`Ver foto de ${TIME_CLOCK_LABELS[type]}`}>{openingPhoto === punch.photo_path ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}</button>}</div>{punch && <p className="mt-1 text-[9px] font-bold">{TIME_CLOCK_CLASSIFICATION_LABELS[punch.classification]}{punch.deviation_minutes ? ` · ${Math.abs(punch.deviation_minutes)} min` : ""}</p>}</div>;
                  })}
                </div>
                <div className="grid grid-cols-2 gap-2 text-right lg:block">
                  <div><p className="text-[9px] font-bold uppercase text-neutral-400">Trabalhado</p><p className="text-sm font-black">{formatTimeClockMinutes(day.worked_minutes)?.replace(/^\+/, "")}</p></div>
                  <div className="lg:mt-2"><p className="text-[9px] font-bold uppercase text-neutral-400">Saldo do dia</p><p className={`text-sm font-black ${(day.bank_minutes ?? 0) > 0 ? "text-emerald-700" : (day.bank_minutes ?? 0) < 0 ? "text-red-600" : ""}`}>{formatTimeClockMinutes(day.bank_minutes)}</p></div>
                  <Badge variant="outline" className={`col-span-2 mt-2 justify-center lg:float-right ${day.status === "completo" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : day.status === "sem_registro" ? "border-red-200 bg-red-50 text-red-700" : ""}`}>{day.status === "completo" ? "Completo" : day.status === "em_andamento" ? "Em andamento" : day.status === "sem_registro" ? "Sem registro" : "Pendente"}</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="border-neutral-200 bg-neutral-50"><CardContent className="flex gap-3 p-4 text-xs leading-5 text-neutral-600"><TimerReset className="mt-0.5 h-4 w-4 shrink-0 text-yellow-700" /><p><strong>Critério de cálculo:</strong> até 5 minutos por marcação e até 10 minutos somados no dia são neutralizados. O saldo é informativo e só fecha com quatro registros; compensação e horas extras dependem das regras formais adotadas pela empresa.</p></CardContent></Card>

      <Dialog open={!!photo} onOpenChange={(open) => !open && setPhoto(null)}><DialogContent className="max-w-xl overflow-hidden rounded-3xl p-0"><DialogHeader className="border-b px-6 py-4"><DialogTitle className="text-base">{photo?.title}</DialogTitle></DialogHeader>{photo && <img src={photo.url} alt={photo.title} className="max-h-[70vh] w-full bg-neutral-100 object-contain" />}<div className="flex items-center gap-2 border-t bg-neutral-50 px-6 py-3 text-[11px] text-neutral-500"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Foto privada vinculada à marcação original.</div></DialogContent></Dialog>
    </div>
  );
}

function Metric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) { return <div className="min-w-24 rounded-xl border border-white/10 bg-white/8 px-3 py-2"><p className="text-[9px] font-bold uppercase tracking-wide text-neutral-400">{label}</p><p className={`mt-1 text-sm font-black ${danger ? "text-red-300" : "text-yellow-300"}`}>{value}</p></div>; }
function formatWorkDate(value: string) { return new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }); }
function classificationStyle(value: TimeClockDay["punches"][number]["classification"]) { if (value === "atrasado" || value === "saida_antecipada") return "border-red-200 bg-red-50"; if (value === "adiantado" || value === "hora_extra") return "border-emerald-200 bg-emerald-50"; return "border-neutral-200 bg-white"; }

