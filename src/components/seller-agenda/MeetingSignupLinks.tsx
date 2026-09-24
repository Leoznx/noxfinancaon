import { useState } from "react";
import { Check, Copy, Link2, LoaderCircle, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  buildAppointmentWhatsAppUrl,
  getAppointmentContact,
  registrationWhatsAppMessage,
  type SellerAppointment,
} from "@/lib/seller-agenda";
import {
  buildMeetingSignupSelectorUrl,
  fetchMeetingSignupLinks,
  recordMeetingSignupSelectorSend,
  type SellerSignupLink,
} from "@/lib/seller-signup-links";

export function MeetingSignupLinks({ item }: { item: SellerAppointment }) {
  const [links, setLinks] = useState<SellerSignupLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const contact = getAppointmentContact(item);
  const url = links.length ? buildMeetingSignupSelectorUrl(links, item.id) : "";
  const message = url ? registrationWhatsAppMessage(item, "seu perfil", url) : "";
  const whatsappUrl = url && contact.phone ? buildAppointmentWhatsAppUrl(contact.phone, message) : "";
  const sourceSdrName = links.find((link) => link.sourceSdrName)?.sourceSdrName ?? null;

  async function prepare() {
    setLoading(true);
    try {
      const generated = await fetchMeetingSignupLinks(item.id);
      setLinks(generated);
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Não foi possível gerar o link desta reunião.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    try {
      await recordMeetingSignupSelectorSend(item.id, links, "copy");
    } catch {
      toast.warning("O link foi copiado, mas o vínculo com a reunião não pôde ser registrado.");
      return;
    }
    setCopied(true);
    toast.success("Link de cadastro copiado.");
    window.setTimeout(() => setCopied(false), 1800);
  }

  function registerWhatsAppSend() {
    if (!url) return;
    void recordMeetingSignupSelectorSend(item.id, links, "whatsapp").catch(() =>
      toast.warning("O WhatsApp abriu, mas o vínculo com a reunião não pôde ser registrado."),
    );
  }

  if (links.length === 0) {
    return (
      <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-3">
        <p className="text-xs font-bold text-neutral-700">
          Gere o cadastro pela própria reunião. Se ela veio de um SDR, o vínculo, o ranking e as
          comissões futuras serão atribuídos automaticamente aos dois responsáveis.
        </p>
        <Button
          type="button"
          size="sm"
          className="mt-3 bg-yellow-400 font-black text-black hover:bg-yellow-500"
          onClick={() => void prepare()}
          disabled={loading}
        >
          {loading ? (
            <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Link2 className="mr-1.5 h-4 w-4" />
          )}
          Preparar link de cadastro
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-yellow-300 bg-yellow-50 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex-1">
          <p className="text-xs font-black text-neutral-700">
            A pessoa escolherá o tipo de usuário ao abrir o link.
          </p>
          <p className="mt-1 text-[11px] font-semibold text-neutral-500">
            Corretor, imobiliária, inquilino ou proprietário.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
            {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}{" "}
            Copiar
          </Button>
          {whatsappUrl ? <Button
            type="button"
            size="sm"
            className="bg-[#25D366] font-black text-white hover:bg-[#20bd5a]"
            asChild
          >
            <a href={whatsappUrl} target="_blank" rel="noreferrer" onClick={registerWhatsAppSend}>
              <MessageCircle className="mr-1.5 h-4 w-4" /> WhatsApp
            </a>
          </Button> : <Button type="button" size="sm" variant="outline" disabled>Telefone não informado</Button>}
        </div>
      </div>
      <p className="break-all rounded-lg bg-white px-3 py-2 font-mono text-[10px] text-neutral-500">
        {url}
      </p>
      <p className="text-[11px] font-semibold text-neutral-600">
        {sourceSdrName
          ? `Link permanente: os cadastros profissionais contam para este Closer e para o SDR ${sourceSdrName}.`
          : "Link permanente: cada cadastro conta somente para este Closer."}
      </p>
    </div>
  );
}
