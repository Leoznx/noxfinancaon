import { useMemo, useState } from "react";
import { Check, Copy, Link2, LoaderCircle, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildAppointmentWhatsAppUrl,
  getSharedMeetingMetadata,
  registrationWhatsAppMessage,
  type SellerAppointment,
} from "@/lib/seller-agenda";
import {
  buildSellerSignupUrl,
  fetchMeetingSignupLinks,
  recordMeetingSignupLinkSend,
  type SellerSignupLink,
  type SellerSignupRole,
} from "@/lib/seller-signup-links";

const ROLE_LABELS: Record<SellerSignupRole, string> = {
  proprietario: "proprietário",
  imobiliaria: "imobiliária",
  corretor: "corretor",
};

function initialRole(item: SellerAppointment): SellerSignupRole {
  const clientType = getSharedMeetingMetadata(item.notes).clientType?.toLocaleLowerCase("pt-BR") ?? "";
  if (clientType.includes("imobili")) return "imobiliaria";
  if (clientType.includes("propriet")) return "proprietario";
  return "corretor";
}

export function MeetingSignupLinks({ item }: { item: SellerAppointment }) {
  const [links, setLinks] = useState<SellerSignupLink[]>([]);
  const [role, setRole] = useState<SellerSignupRole>(() => initialRole(item));
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const selected = useMemo(() => links.find((link) => link.profileRole === role) ?? null, [links, role]);
  const url = selected ? buildSellerSignupUrl(selected.profileRole, selected.token, item.id) : "";
  const message = selected ? registrationWhatsAppMessage(item, ROLE_LABELS[selected.profileRole], url) : "";
  const whatsappUrl = selected ? buildAppointmentWhatsAppUrl(item.contact_phone, message) : "";

  async function prepare() {
    setLoading(true);
    try {
      const generated = await fetchMeetingSignupLinks(item.id);
      setLinks(generated);
      if (!generated.some((link) => link.profileRole === role) && generated[0]) {
        setRole(generated[0].profileRole);
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível gerar o link desta reunião.");
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!url || !selected) return;
    await navigator.clipboard.writeText(url);
    try {
      await recordMeetingSignupLinkSend(item.id, selected.token, selected.profileRole, "copy");
    } catch {
      toast.warning("O link foi copiado, mas o vínculo com a reunião não pôde ser registrado.");
      return;
    }
    setCopied(true);
    toast.success("Link de cadastro copiado.");
    window.setTimeout(() => setCopied(false), 1800);
  }

  function registerWhatsAppSend() {
    if (!selected) return;
    void recordMeetingSignupLinkSend(item.id, selected.token, selected.profileRole, "whatsapp")
      .catch(() => toast.warning("O WhatsApp abriu, mas o vínculo com a reunião não pôde ser registrado."));
  }

  if (links.length === 0) {
    return (
      <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-3">
        <p className="text-xs font-bold text-neutral-700">
          Gere o cadastro pela própria reunião. Se ela veio de um SDR, o vínculo, o ranking e as
          comissões futuras serão atribuídos automaticamente aos dois responsáveis.
        </p>
        <Button type="button" size="sm" className="mt-3 bg-yellow-400 font-black text-black hover:bg-yellow-500" onClick={() => void prepare()} disabled={loading}>
          {loading ? <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" /> : <Link2 className="mr-1.5 h-4 w-4" />}
          Preparar link de cadastro
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-yellow-300 bg-yellow-50 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-neutral-600">Cadastro escolhido</label>
          <Select value={role} onValueChange={(value) => setRole(value as SellerSignupRole)}>
            <SelectTrigger className="h-10 bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(ROLE_LABELS) as SellerSignupRole[]).map((itemRole) => (
                <SelectItem key={itemRole} value={itemRole}>{ROLE_LABELS[itemRole]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
            {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />} Copiar
          </Button>
          <Button type="button" size="sm" className="bg-[#25D366] font-black text-white hover:bg-[#20bd5a]" asChild>
            <a href={whatsappUrl} target="_blank" rel="noreferrer" onClick={registerWhatsAppSend}><MessageCircle className="mr-1.5 h-4 w-4" /> WhatsApp</a>
          </Button>
        </div>
      </div>
      <p className="break-all rounded-lg bg-white px-3 py-2 font-mono text-[10px] text-neutral-500">{url}</p>
      <p className="text-[11px] font-semibold text-neutral-600">
        {selected?.sourceSdrName
          ? `Crédito automático para este Closer e para o SDR ${selected.sourceSdrName}.`
          : "Crédito automático para este Closer."}
      </p>
    </div>
  );
}
