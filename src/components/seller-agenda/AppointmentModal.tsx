import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Check, ChevronsUpDown, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  AGENDA_REMINDERS,
  AGENDA_STATUSES,
  AGENDA_TYPES,
  agendaTypeKey,
  type AgendaClientOption,
  type AgendaLeadOption,
  type AppointmentDraft,
  type SellerAppointment,
} from "@/lib/seller-agenda";

type FormState = {
  title: string;
  type: string;
  status: string;
  priority: string;
  date: string;
  time: string;
  reminder: string;
  notes: string;
  leadId: string | null;
  partnershipId: string | null;
};

function initialForm(initial: SellerAppointment | null, defaultDate: Date): FormState {
  const date = initial ? new Date(initial.scheduled_at) : defaultDate;
  if (!initial) date.setHours(9, 0, 0, 0);
  return {
    title: initial?.title ?? "",
    type: initial ? agendaTypeKey(initial.type) : "reuniao",
    status: initial?.status === "concluido" || initial?.status === "cancelado" ? initial.status : "agendado",
    priority: initial?.priority ?? "normal",
    date: format(date, "yyyy-MM-dd"),
    time: format(date, "HH:mm"),
    reminder: initial?.reminder_minutes?.toString() ?? "none",
    notes: initial?.notes ?? "",
    leadId: initial?.lead_id ?? null,
    partnershipId: initial?.partnership_id ?? null,
  };
}

function SearchPicker({
  label,
  placeholder,
  emptyLabel,
  options,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  emptyLabel: string;
  options: Array<{ value: string; label: string; description?: string }>;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-10 w-full justify-between px-3 font-medium"
          >
            <span className="truncate text-left">{selected?.label ?? placeholder}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-neutral-400" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command>
            <CommandInput placeholder={`Pesquisar ${label.toLocaleLowerCase("pt-BR")}...`} />
            <CommandList>
              <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value={emptyLabel}
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                  {emptyLabel}
                </CommandItem>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={`${option.label} ${option.description ?? ""}`}
                    onSelect={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("h-4 w-4", value === option.value ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{option.label}</span>
                      {option.description && <span className="block truncate text-xs text-neutral-400">{option.description}</span>}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function AppointmentModal({
  open,
  initial,
  defaultDate,
  leads,
  clients,
  onOpenChange,
  onSave,
  onDelete,
}: {
  open: boolean;
  initial: SellerAppointment | null;
  defaultDate: Date;
  leads: AgendaLeadOption[];
  clients: AgendaClientOption[];
  onOpenChange: (open: boolean) => void;
  onSave: (draft: AppointmentDraft) => Promise<void>;
  onDelete?: (item: SellerAppointment) => void;
}) {
  const [form, setForm] = useState<FormState>(() => initialForm(initial, defaultDate));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setForm(initialForm(initial, defaultDate));
      setError("");
    }
  }, [open, initial, defaultDate]);

  const clientOptions = useMemo(
    () =>
      clients.map((client) => ({
        value: client.id,
        label: client.name,
        description: [client.email, client.city].filter(Boolean).join(" · "),
      })),
    [clients],
  );
  const leadOptions = useMemo(
    () =>
      leads.map((lead) => ({
        value: lead.id,
        label: lead.full_name,
        description: [lead.email, lead.phone].filter(Boolean).join(" · "),
      })),
    [leads],
  );

  async function submit() {
    if (!form.title.trim()) {
      setError("Informe o título do compromisso.");
      return;
    }
    if (!form.date || !form.time) {
      setError("Informe a data e o horário.");
      return;
    }
    const scheduledAt = new Date(`${form.date}T${form.time}:00`);
    if (Number.isNaN(scheduledAt.getTime())) {
      setError("A data ou o horário informado é inválido.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await onSave({
        id: initial?.id,
        title: form.title,
        type: form.type,
        status: form.status,
        priority: form.priority,
        scheduled_at: scheduledAt.toISOString(),
        reminder_minutes: form.reminder === "none" ? null : Number(form.reminder),
        notes: form.notes || null,
        lead_id: form.leadId,
        partnership_id: form.partnershipId,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar o compromisso.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto p-0">
        <DialogHeader className="border-b border-neutral-100 px-5 py-4 sm:px-6">
          <DialogTitle className="text-xl font-black">{initial ? "Editar compromisso" : "Novo compromisso"}</DialogTitle>
          <p className="text-sm text-neutral-500">Organize o próximo contato com informações claras e lembrete automático.</p>
        </DialogHeader>

        <div className="grid gap-4 px-5 py-5 sm:grid-cols-2 sm:px-6">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="agenda-title">Título *</Label>
            <Input
              id="agenda-title"
              autoFocus
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="Ex.: Apresentação da proposta"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Tipo *</Label>
            <Select value={form.type} onValueChange={(type) => setForm((current) => ({ ...current, type }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {AGENDA_TYPES.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(status) => setForm((current) => ({ ...current, status }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {AGENDA_STATUSES.map((status) => <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agenda-date">Data *</Label>
            <Input id="agenda-date" type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agenda-time">Horário *</Label>
            <Input id="agenda-time" type="time" value={form.time} onChange={(event) => setForm((current) => ({ ...current, time: event.target.value }))} />
          </div>

          <SearchPicker
            label="Cliente parceiro"
            placeholder="Pesquisar cliente"
            emptyLabel="Sem cliente vinculado"
            options={clientOptions}
            value={form.partnershipId}
            onChange={(partnershipId) => setForm((current) => ({ ...current, partnershipId }))}
          />
          <SearchPicker
            label="Lead"
            placeholder="Pesquisar lead"
            emptyLabel="Sem lead vinculado"
            options={leadOptions}
            value={form.leadId}
            onChange={(leadId) => setForm((current) => ({ ...current, leadId }))}
          />

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Lembrete</Label>
            <Select value={form.reminder} onValueChange={(reminder) => setForm((current) => ({ ...current, reminder }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {AGENDA_REMINDERS.map((reminder) => (
                  <SelectItem key={reminder.value ?? "none"} value={reminder.value?.toString() ?? "none"}>{reminder.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="agenda-notes">Observações</Label>
            <Textarea
              id="agenda-notes"
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              placeholder="Contexto, endereço, link da chamada ou próximo passo..."
              className="min-h-24 resize-y"
            />
          </div>

          {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700 sm:col-span-2">{error}</p>}
        </div>

        <DialogFooter className="border-t border-neutral-100 px-5 py-4 sm:justify-between sm:px-6">
          <div>
            {initial && onDelete && (
              <Button type="button" variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => onDelete(initial)}>
                <Trash2 className="mr-1.5 h-4 w-4" /> Excluir
              </Button>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
            <Button type="button" className="bg-yellow-400 font-extrabold text-black hover:bg-yellow-500" onClick={submit} disabled={saving}>
              {saving ? "Salvando..." : "Salvar compromisso"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

