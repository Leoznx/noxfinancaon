import { useEffect, useState } from "react";
import { Loader2, Save, UserRoundPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  getMeetingClientProfile,
  MEETING_CLIENT_PROFILES,
  updateSellerMeetingContact,
  type MeetingClientProfile,
  type SellerAppointment,
} from "@/lib/seller-agenda";
import { formatBrazilianPhoneInput, isValidBrazilianPhone } from "@/lib/seller-clients";

export function MeetingContactEditDialog({
  item,
  onClose,
  onSaved,
}: {
  item: SellerAppointment | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [profile, setProfile] = useState<MeetingClientProfile>("autonomo");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!item) return;
    setName(item.contact_name?.trim() || "");
    setPhone(formatBrazilianPhoneInput(item.contact_phone || ""));
    setProfile(getMeetingClientProfile(item));
    setSaving(false);
    setError("");
  }, [item]);

  async function submit() {
    if (!item || saving) return;
    if (name.trim().length < 2) {
      setError("Informe o nome do cliente ou da imobiliária.");
      return;
    }
    if (!isValidBrazilianPhone(phone)) {
      setError("Informe um telefone válido com DDD.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await updateSellerMeetingContact({
        appointmentId: item.id,
        contactName: name,
        contactPhone: phone,
        contactProfile: profile,
        expectedUpdatedAt: item.updated_at,
      });
      onClose();
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível atualizar os dados da reunião.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-black"><UserRoundPen className="h-5 w-5 text-yellow-700" /> Editar dados da reunião</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-xs font-semibold leading-relaxed text-yellow-900">
            Esta edição altera somente nome, telefone e perfil. Data, horário, Closer e status permanecem iguais.
          </p>
          <label className="block space-y-1.5 text-sm font-bold text-neutral-800">
            <span>Nome do cliente ou imobiliária</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={160} placeholder="Nome completo" autoFocus />
          </label>
          <label className="block space-y-1.5 text-sm font-bold text-neutral-800">
            <span>Telefone com DDD</span>
            <Input value={phone} onChange={(event) => setPhone(formatBrazilianPhoneInput(event.target.value))} inputMode="tel" placeholder="(47) 99999-9999" />
          </label>
          <fieldset>
            <legend className="mb-2 text-sm font-bold text-neutral-800">Perfil profissional</legend>
            <div className="grid grid-cols-3 gap-2">
              {MEETING_CLIENT_PROFILES.map((option) => (
                <button key={option.value} type="button" onClick={() => setProfile(option.value)} className={`rounded-xl border px-2 py-3 text-xs font-extrabold transition ${profile === option.value ? "border-neutral-950 bg-neutral-950 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-yellow-400"}`}>
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>
          {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button type="button" className="bg-yellow-400 font-black text-black hover:bg-yellow-500" onClick={() => void submit()} disabled={saving}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />} Salvar dados
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
