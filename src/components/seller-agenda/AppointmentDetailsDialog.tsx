import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Bell, Building2, CalendarDays, Check, Clock3, Edit3, Trash2, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AGENDA_REMINDERS, agendaStatusLabel, agendaTypeLabel, type SellerAppointment } from "@/lib/seller-agenda";

export function AppointmentDetailsDialog({
  item,
  onClose,
  onEdit,
  onComplete,
  onDelete,
}: {
  item: SellerAppointment | null;
  onClose: () => void;
  onEdit: (item: SellerAppointment) => void;
  onComplete: (item: SellerAppointment) => void;
  onDelete: (item: SellerAppointment) => void;
}) {
  if (!item) return null;
  const related = item.client_name || item.lead_name;
  const reminder = AGENDA_REMINDERS.find((option) => option.value === item.reminder_minutes)?.label ?? "Sem lembrete";
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
          {related && (
            <div className="flex items-center gap-2 rounded-xl border border-neutral-200 p-3 font-semibold text-neutral-800">
              {item.client_name ? <Building2 className="h-4 w-4 text-neutral-400" /> : <UserRound className="h-4 w-4 text-neutral-400" />}
              {related}
            </div>
          )}
          {item.notes && <p className="rounded-xl border border-neutral-200 p-3 leading-relaxed text-neutral-600">{item.notes}</p>}
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

