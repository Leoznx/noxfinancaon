import { format, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarPlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppointmentCard } from "@/components/seller-agenda/AppointmentCard";
import type { SellerAppointment } from "@/lib/seller-agenda";

export function AgendaDayPanel({
  date,
  items,
  sdrNames,
  onNew,
  onView,
  onEdit,
  onComplete,
  onDelete,
}: {
  date: Date;
  items: SellerAppointment[];
  sdrNames?: ReadonlyMap<string, string>;
  onNew: () => void;
  onView: (item: SellerAppointment) => void;
  onEdit: (item: SellerAppointment) => void;
  onComplete: (item: SellerAppointment) => void;
  onDelete: (item: SellerAppointment) => void;
}) {
  return (
    <aside className="self-start overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.03)] xl:sticky xl:top-3">
      <header className="border-b border-neutral-100 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-neutral-400">Agenda do dia</p>
            <h2 className="mt-1 text-base font-black capitalize text-neutral-950">
              {isToday(date) ? "Hoje" : format(date, "EEEE", { locale: ptBR })}
            </h2>
            <p className="mt-0.5 text-xs font-medium capitalize text-neutral-500">
              {format(date, "d 'de' MMMM 'de' yyyy", { locale: ptBR })}
            </p>
          </div>
          <span className="grid h-8 min-w-8 place-items-center rounded-full bg-yellow-100 px-2 text-xs font-black text-yellow-800">
            {items.length}
          </span>
        </div>
      </header>

      <div className="max-h-[410px] overflow-y-auto p-3">
        {items.length === 0 ? (
          <div className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-neutral-200 bg-neutral-50/50 px-5 text-center">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-yellow-100 text-yellow-800">
              <CalendarPlus2 className="h-5 w-5" />
            </span>
            <h3 className="mt-3 text-sm font-black text-neutral-950">Nenhum compromisso para este dia</h3>
            <p className="mt-1 max-w-56 text-xs leading-relaxed text-neutral-500">
              Organize um retorno, reunião ou follow-up para manter sua operação em movimento.
            </p>
            <Button type="button" className="mt-3 h-8 bg-yellow-400 text-xs font-extrabold text-black hover:bg-yellow-500" onClick={onNew}>
              <CalendarPlus2 className="mr-1.5 h-4 w-4" /> Novo compromisso
            </Button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {items.map((item) => (
              <AppointmentCard
                key={item.id}
                item={item}
                compact
                sdrNames={sdrNames}
                onView={onView}
                onEdit={onEdit}
                onComplete={onComplete}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
