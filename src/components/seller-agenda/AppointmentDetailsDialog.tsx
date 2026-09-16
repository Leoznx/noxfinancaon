import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Bell, Building2, CalendarDays, Check, Clock3, Edit3, Phone, Trash2, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AGENDA_REMINDERS, agendaStatusLabel, agendaTypeLabel, getAppointmentContact, getSharedMeetingMetadata, getVisibleAppointmentNotes, type SellerAppointment } from "@/lib/seller-agenda";
import { formatBrazilianPhoneInput, normalizeBrazilianPhone } from "@/lib/seller-clients";

export function AppointmentDetailsDialog({
  item,
  sdrNames,
  onClose,
  onEdit,
  onComplete,
  onDelete,
}: {
  item: SellerAppointment | null;
  sdrNames?: ReadonlyMap<string, string>;
  onClose: () => void;
  onEdit: (item: SellerAppointment) => void;
  onComplete: (item: SellerAppointment) => void;
  onDelete: (item: SellerAppointment) => void;
}) {
  if (!item) return null;
  const contact = getAppointmentContact(item);
  const contactPhoneDigits = contact.phone ? normalizeBrazilianPhone(contact.phone) : "";
  const contactPhoneDisplay = contact.phone ? formatBrazilianPhoneInput(contact.phone) : null;
  const reminder = AGENDA_REMINDERS.find((option) => option.value === item.reminder_minutes)?.label ?? "Sem lembrete";
  const metadata = getSharedMeetingMetadata(item.notes);
  const visibleNotes = getVisibleAppointmentNotes(item);
  const sdrName = metadata.sdrName
    ? sdrNames?.get(metadata.sdrName) ?? metadata.sdrName.trim().split(/\s+/)[0]
    : null;
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
          {(contact.name || contactPhoneDisplay) && (
            <div className="grid gap-2 rounded-xl border border-neutral-200 p-3 sm:grid-cols-2">
              {contact.name && (
                <div className="flex items-center gap-2.5 text-neutral-800">
                  {item.client_name && !item.contact_name ? <Building2 className="h-4 w-4 shrink-0 text-neutral-400" /> : <UserRound className="h-4 w-4 shrink-0 text-neutral-400" />}
                  <div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-wider text-neutral-400">Cliente</p><p className="truncate font-bold">{contact.name}</p></div>
                </div>
              )}
              {contactPhoneDisplay && (
                <a className="flex items-center gap-2.5 rounded-lg text-neutral-800 transition hover:text-neutral-950" href={`tel:+55${contactPhoneDigits}`} aria-label={`Ligar para ${contactPhoneDisplay}`}>
                  <Phone className="h-4 w-4 shrink-0 text-neutral-400" />
                  <div><p className="text-[10px] font-black uppercase tracking-wider text-neutral-400">Telefone</p><p className="font-bold">{contactPhoneDisplay}</p></div>
                </a>
              )}
            </div>
          )}
          {item.source === "sdr_handoff" && (metadata.clientType || sdrName) && <div className="grid gap-2 rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-xs font-semibold text-neutral-700 sm:grid-cols-2">{metadata.clientType && <p><span className="text-neutral-500">Tipo:</span> {metadata.clientType}</p>}{sdrName && <p><span className="text-neutral-500">SDR:</span> {sdrName}</p>}</div>}
          {visibleNotes && <p className="rounded-xl border border-neutral-200 p-3 leading-relaxed text-neutral-600">{visibleNotes}</p>}
        </div>
        <DialogFooter className="flex-wrap">
          <Button variant="ghost" className="mr-auto text-red-600 hover:bg-red-50" onClick={() => onDelete(item)}><Trash2 className="mr-1.5 h-4 w-4" /> Excluir</Button>
          <Button variant="outline" onClick={() => onEdit(item)}><Edit3 className="mr-1.5 h-4 w-4" /> Editar</Button>
          {!["concluido", "cancelado"].includes(item.status) && (
            <Button className="bg-neutral-950 text-white hover:bg-neutral-800" onClick={() => onComplete(item)}><Check className="mr-1.5 h-4 w-4" /> Concluir</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
