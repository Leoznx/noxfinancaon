import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Activity, Bell, Building2, CalendarClock, CalendarDays, Check, CheckCircle2, Clock3, Edit3, MessageCircle, MessageSquareText, Phone, Search, Trash2, UserRound } from "lucide-react";
import { MeetingSignupLinks } from "@/components/seller-agenda/MeetingSignupLinks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AGENDA_REMINDERS, agendaStatusLabel, agendaTypeLabel, appointmentWhatsAppMessage, buildAppointmentWhatsAppUrl, canRescheduleSellerMeeting, getAppointmentContact, getSharedMeetingMetadata, getVisibleAppointmentNotes, isPersonalSellerReminder, type SellerAppointment } from "@/lib/seller-agenda";
import { formatBrazilianPhoneInput, normalizeBrazilianPhone } from "@/lib/seller-clients";

const JOURNEY_COPY = {
  registration_pending: {
    label: "Cadastro ainda não concluído",
    detail: "O link foi enviado pela reunião. A jornada começa assim que o cliente concluir o cadastro.",
    className: "border-neutral-200 bg-neutral-50 text-neutral-700",
    icon: Activity,
  },
  no_consultations: {
    label: "Sem consultas feitas",
    detail: "O cliente já está vinculado, mas ainda não iniciou uma simulação de crédito.",
    className: "border-amber-200 bg-amber-50 text-amber-900",
    icon: Search,
  },
  consultation_in_progress: {
    label: "Fazendo consulta, mas sem fechamento",
    detail: "Já existe consulta de crédito, porém nenhum contrato foi fechado até agora.",
    className: "border-blue-200 bg-blue-50 text-blue-900",
    icon: Activity,
  },
  contract_closed: {
    label: "Contrato fechado",
    detail: "A jornada deste cliente já gerou contrato na NOX Fiança.",
    className: "border-emerald-200 bg-emerald-50 text-emerald-900",
    icon: CheckCircle2,
  },
} as const;

export function AppointmentDetailsDialog({
  item,
  sdrNames,
  onClose,
  onEdit,
  onReschedule,
  onComplete,
  onDelete,
  canEdit = true,
  canManageCloserMeeting = false,
  canComplete = true,
}: {
  item: SellerAppointment | null;
  sdrNames?: ReadonlyMap<string, string>;
  onClose: () => void;
  onEdit: (item: SellerAppointment) => void;
  onReschedule: (item: SellerAppointment) => void;
  onComplete: (item: SellerAppointment) => void;
  onDelete: (item: SellerAppointment) => void;
  canEdit?: boolean;
  canManageCloserMeeting?: boolean;
  canComplete?: boolean;
}) {
  if (!item) return null;
  const contact = getAppointmentContact(item);
  const contactPhoneDigits = contact.phone ? normalizeBrazilianPhone(contact.phone) : "";
  const contactPhoneDisplay = contact.phone ? formatBrazilianPhoneInput(contact.phone) : null;
  const showContact = !isPersonalSellerReminder(item) && item.source !== "admin";
  const reminder = AGENDA_REMINDERS.find((option) => option.value === item.reminder_minutes)?.label ?? "Sem lembrete";
  const metadata = getSharedMeetingMetadata(item.notes);
  const visibleNotes = getVisibleAppointmentNotes(item);
  const sdrName = metadata.sdrName
    ? sdrNames?.get(metadata.sdrName) ?? metadata.sdrName.trim().split(/\s+/)[0]
    : null;
  const followUpWhatsAppUrl = item.source === "meeting_follow_up" && contact.phone
    ? buildAppointmentWhatsAppUrl(contact.phone, appointmentWhatsAppMessage(item))
    : null;
  const journey = item.source === "meeting_follow_up" && item.journey
    ? JOURNEY_COPY[item.journey.status]
    : null;
  const JourneyIcon = journey?.icon;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="mb-2 flex flex-wrap gap-2">
            <Badge className="bg-neutral-950 text-white">{agendaTypeLabel(item.type)}</Badge>
            <Badge variant="outline">{agendaStatusLabel(item.status)}</Badge>
          </div>
          <DialogTitle className="text-xl font-black">{item.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2 text-sm">
          <div className="grid gap-3 rounded-xl bg-neutral-50 p-4 sm:grid-cols-2">
            <p className="flex items-center gap-2 font-semibold text-neutral-700"><CalendarDays className="h-4 w-4 text-yellow-700" /> {format(new Date(item.scheduled_at), "dd/MM/yyyy")}</p>
            <p className="flex items-center gap-2 font-semibold text-neutral-700"><Clock3 className="h-4 w-4 text-yellow-700" /> {format(new Date(item.scheduled_at), "HH:mm")}</p>
            <p className="flex items-center gap-2 font-semibold capitalize text-neutral-700 sm:col-span-2"><CalendarDays className="h-4 w-4 text-yellow-700" /> {format(new Date(item.scheduled_at), "EEEE, d 'de' MMMM", { locale: ptBR })}</p>
            <p className="flex items-center gap-2 font-semibold text-neutral-700 sm:col-span-2"><Bell className="h-4 w-4 text-yellow-700" /> {reminder}</p>
          </div>
          {showContact && (
            <div className="rounded-xl border border-neutral-200 p-3">
              <p className="mb-3 text-[10px] font-black uppercase tracking-[0.14em] text-neutral-400">Dados da pessoa</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex items-center gap-2.5 text-neutral-800">
                  {item.client_name && !item.contact_name ? <Building2 className="h-4 w-4 shrink-0 text-neutral-400" /> : <UserRound className="h-4 w-4 shrink-0 text-neutral-400" />}
                  <div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-wider text-neutral-400">Nome</p><p className="truncate font-bold">{contact.name ?? "Não informado"}</p></div>
                </div>
                {contactPhoneDisplay ? <a className="flex items-center gap-2.5 rounded-lg text-neutral-800 transition hover:text-neutral-950" href={`tel:+55${contactPhoneDigits}`} aria-label={`Ligar para ${contactPhoneDisplay}`}>
                  <Phone className="h-4 w-4 shrink-0 text-neutral-400" />
                  <div><p className="text-[10px] font-black uppercase tracking-wider text-neutral-400">Telefone</p><p className="font-bold">{contactPhoneDisplay}</p></div>
                </a> : <div className="flex items-center gap-2.5 text-neutral-500"><Phone className="h-4 w-4 shrink-0 text-neutral-300" /><div><p className="text-[10px] font-black uppercase tracking-wider text-neutral-400">Telefone</p><p className="font-semibold">Não informado</p></div></div>}
                {contact.email && <div className="min-w-0 sm:col-span-2"><p className="text-[10px] font-black uppercase tracking-wider text-neutral-400">E-mail</p><p className="truncate font-semibold text-neutral-700">{contact.email}</p></div>}
              </div>
            </div>
          )}
          {item.type === "reuniao" && (metadata.clientType || sdrName) && <div className="grid gap-2 rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-xs font-semibold text-neutral-700 sm:grid-cols-2">{metadata.clientType && <p><span className="text-neutral-500">Perfil:</span> {metadata.clientType}</p>}{sdrName && <p><span className="text-neutral-500">SDR:</span> {sdrName}</p>}</div>}
          {journey && JourneyIcon && (
            <div className={`rounded-xl border p-3 ${journey.className}`}>
              <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide">
                <JourneyIcon className="h-4 w-4" /> Jornada do cliente
              </p>
              <p className="mt-2 font-black">{journey.label}</p>
              <p className="mt-1 text-xs leading-relaxed opacity-80">{journey.detail}</p>
              {item.journey && item.journey.consultationCount > 0 && (
                <p className="mt-2 text-[11px] font-bold">
                  {item.journey.consultationCount} consulta(s) · {item.journey.contractCount} contrato(s)
                </p>
              )}
            </div>
          )}
          {item.source === "meeting_follow_up" && item.status !== "concluido" && (
            <div className="rounded-xl border border-yellow-300 bg-yellow-50 p-3 text-xs font-bold text-yellow-900">
              Conclusão obrigatória: este follow-up automático não pode ser editado, cancelado ou excluído.
            </div>
          )}
          {item.source === "admin" && item.status !== "cancelado" && (
            <div className="rounded-xl border border-yellow-300 bg-yellow-50 p-3 text-xs font-bold text-yellow-900">
              Reunião definida pela administração. O horário e a pauta são somente leitura e não podem ser reagendados ou excluídos.
            </div>
          )}
          {visibleNotes && <p className="rounded-xl border border-neutral-200 p-3 leading-relaxed text-neutral-600">{visibleNotes}</p>}
          {item.meeting_feedback && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-emerald-800"><MessageSquareText className="h-3.5 w-3.5" /> Feedback da reunião</p><p className="mt-1 whitespace-pre-wrap leading-relaxed text-neutral-700">{item.meeting_feedback}</p></div>}
          {item.type === "reuniao" && item.status === "concluido" && item.completed_at && (
            <div className="grid gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-neutral-800 sm:grid-cols-2">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-emerald-800">Encerramento real</p>
                <p className="mt-1 font-bold">{format(new Date(item.completed_at), "dd/MM/yyyy 'às' HH:mm")}</p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-emerald-800">Duração realizada</p>
                <p className="mt-1 font-bold">{formatMeetingDuration(item.actual_duration_minutes)}</p>
              </div>
            </div>
          )}
          {canManageCloserMeeting && item.type === "reuniao" && <MeetingSignupLinks item={item} />}
          {followUpWhatsAppUrl && <Button type="button" className="w-full bg-[#25D366] font-black text-white hover:bg-[#20bd5a]" asChild><a href={followUpWhatsAppUrl} target="_blank" rel="noreferrer"><MessageCircle className="mr-1.5 h-4 w-4" /> Abrir mensagem pronta no WhatsApp</a></Button>}
        </div>
        <DialogFooter className="flex-wrap">
          {!["meeting_follow_up", "admin"].includes(item.source) && <Button variant="ghost" className="mr-auto text-red-600 hover:bg-red-50" onClick={() => onDelete(item)}><Trash2 className="mr-1.5 h-4 w-4" /> Excluir</Button>}
          {!["meeting_follow_up", "admin"].includes(item.source) && canEdit && <Button variant="outline" onClick={() => onEdit(item)}><Edit3 className="mr-1.5 h-4 w-4" /> {item.type === "reuniao" ? "Editar dados" : "Editar"}</Button>}
          {canRescheduleSellerMeeting(item) && <Button variant="outline" className="border-yellow-300 bg-yellow-50 text-yellow-900 hover:bg-yellow-100" onClick={() => onReschedule(item)}><CalendarClock className="mr-1.5 h-4 w-4" /> Reagendar</Button>}
          {!["concluido", "cancelado"].includes(item.status) && canComplete && (
            <Button className="bg-neutral-950 text-white hover:bg-neutral-800" onClick={() => onComplete(item)}><Check className="mr-1.5 h-4 w-4" /> Concluir</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatMeetingDuration(minutes: number | null) {
  if (!minutes || minutes < 1) return "Não informada";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${minutes} min`;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}min`;
}
