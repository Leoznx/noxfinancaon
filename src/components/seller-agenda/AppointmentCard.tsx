import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Building2, Check, Clock3, Edit3, Eye, Trash2, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  agendaStatusLabel,
  agendaTypeKey,
  agendaTypeLabel,
  type SellerAppointment,
} from "@/lib/seller-agenda";

const TYPE_STYLE: Record<string, string> = {
  reuniao: "border-sky-200 bg-sky-100 text-sky-800",
  follow_up: "border-violet-200 bg-violet-100 text-violet-800",
  visita: "border-lime-200 bg-lime-100 text-lime-800",
  call: "border-cyan-200 bg-cyan-100 text-cyan-800",
  retorno: "border-emerald-200 bg-emerald-100 text-emerald-800",
  outro: "border-slate-200 bg-slate-100 text-slate-700",
};

const STATUS_STYLE: Record<string, string> = {
  concluido: "border-emerald-100 bg-emerald-50 text-emerald-700",
  cancelado: "border-neutral-200 bg-neutral-100 text-neutral-500",
};

export function AppointmentCard({
  item,
  compact = false,
  onView,
  onEdit,
  onComplete,
  onDelete,
}: {
  item: SellerAppointment;
  compact?: boolean;
  onView: (item: SellerAppointment) => void;
  onEdit: (item: SellerAppointment) => void;
  onComplete: (item: SellerAppointment) => void;
  onDelete: (item: SellerAppointment) => void;
}) {
  const finished = ["concluido", "cancelado"].includes(item.status);
  const relatedName = item.client_name || item.lead_name;

  return (
    <article
      className={`group rounded-xl border border-neutral-200 bg-white transition duration-200 hover:border-yellow-300 hover:shadow-sm ${
        compact ? "p-3" : "p-4"
      } ${item.status === "cancelado" ? "opacity-65" : ""}`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-[46px] rounded-lg bg-neutral-950 px-2 py-2 text-center text-white">
          <Clock3 className="mx-auto mb-0.5 h-3.5 w-3.5 text-yellow-400" />
          <span className="text-xs font-black">{format(new Date(item.scheduled_at), "HH:mm")}</span>
        </div>
        <button type="button" onClick={() => onView(item)} className="min-w-0 flex-1 text-left focus-visible:outline-none">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={`px-2 py-0.5 font-sans text-[10px] font-semibold tracking-normal ${TYPE_STYLE[agendaTypeKey(item.type)]}`}>
              {agendaTypeLabel(item.type)}
            </Badge>
            <Badge
              variant="outline"
              className={`px-2 py-0 text-[9px] font-extrabold ${
                STATUS_STYLE[item.status] ?? "border-yellow-100 bg-yellow-50 text-yellow-800"
              }`}
            >
              {agendaStatusLabel(item.status)}
            </Badge>
          </div>
          <h3 className={`mt-1.5 truncate font-extrabold text-neutral-950 ${compact ? "text-sm" : "text-base"}`}>{item.title}</h3>
          {relatedName && (
            <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] font-medium text-neutral-500">
              {item.client_name ? <Building2 className="h-3 w-3" /> : <UserRound className="h-3 w-3" />}
              {relatedName}
            </p>
          )}
          {!compact && item.notes && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-neutral-500">{item.notes}</p>}
          {!compact && (
            <p className="mt-2 text-[10px] font-semibold capitalize text-neutral-400">
              {format(new Date(item.scheduled_at), "EEEE, d 'de' MMMM", { locale: ptBR })}
            </p>
          )}
        </button>
      </div>

      <div className="mt-3 flex items-center justify-end gap-1 border-t border-neutral-100 pt-2.5">
        <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[10px]" onClick={() => onView(item)}>
          <Eye className="h-3.5 w-3.5" /> Detalhes
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[10px]" onClick={() => onEdit(item)}>
          <Edit3 className="h-3.5 w-3.5" /> Editar
        </Button>
        {!finished && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-[10px] text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
            onClick={() => onComplete(item)}
          >
            <Check className="h-3.5 w-3.5" /> Concluir
          </Button>
        )}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-neutral-400 hover:bg-red-50 hover:text-red-600"
          aria-label={`Excluir ${item.title}`}
          onClick={() => onDelete(item)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </article>
  );
}
