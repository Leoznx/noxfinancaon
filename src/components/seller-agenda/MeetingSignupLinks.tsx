import { useState } from "react";
import { Check, Copy, Link2, LoaderCircle, MessageCircle, UsersRound } from "lucide-react";
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
  getAppointmentContact,
  registrationWhatsAppMessage,
  type SellerAppointment,
} from "@/lib/seller-agenda";
import {
  buildMeetingSignupSelectorUrl,
  fetchMeetingSourceSdrOptions,
  fetchMeetingSignupLinks,
  recordMeetingSignupSelectorSend,
  type SellerSignupLink,
  type SignupLinkSdr,
} from "@/lib/seller-signup-links";

export function MeetingSignupLinks({ item }: { item: SellerAppointment }) {
  const [links, setLinks] = useState<SellerSignupLink[]>([]);
  const [sdrs, setSdrs] = useState<SignupLinkSdr[]>([]);
  const [selectedSdrId, setSelectedSdrId] = useState("");
  const [closerOnlyConfirmed, setCloserOnlyConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmingOrigin, setConfirmingOrigin] = useState(false);
  const [copied, setCopied] = useState(false);
  const contact = getAppointmentContact(item);
  const url = links.length ? buildMeetingSignupSelectorUrl(links, item.id) : "";
  const message = url ? registrationWhatsAppMessage(item, "seu perfil", url) : "";
  const whatsappUrl =
    url && contact.phone ? buildAppointmentWhatsAppUrl(contact.phone, message) : "";
  const sourceSdrName = links.find((link) => link.sourceSdrName)?.sourceSdrName ?? null;
  const originConfirmed = Boolean(sourceSdrName) || closerOnlyConfirmed;

  async function prepare() {
    setLoading(true);
    try {
      const generated = await fetchMeetingSignupLinks(item.id);
      setLinks(generated);
      setSelectedSdrId("");
      setCloserOnlyConfirmed(false);
      setSdrs(
        generated.some((link) => link.sourceSdrId)
          ? []
          : await fetchMeetingSourceSdrOptions(item.id),
      );
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Não foi possível gerar o link desta reunião.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function confirmSdrOrigin() {
    if (!selectedSdrId) return;
    setConfirmingOrigin(true);
    try {
      const generated = await fetchMeetingSignupLinks(item.id, selectedSdrId);
      setLinks(generated);
      setCloserOnlyConfirmed(false);
      toast.success("Vendedor de origem vinculado à reunião.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível vincular o Vendedor.");
    } finally {
      setConfirmingOrigin(false);
    }
  }

  async function copy() {
    if (!url || !originConfirmed) return;
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
    if (!url || !originConfirmed) return;
    void recordMeetingSignupSelectorSend(item.id, links, "whatsapp").catch(() =>
      toast.warning("O WhatsApp abriu, mas o vínculo com a reunião não pôde ser registrado."),
    );
  }

  if (links.length === 0) {
    return (
      <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-3">
        <p className="text-xs font-bold text-neutral-700">
          Gere o cadastro pela própria reunião. O sistema identifica o Vendedor de origem e atribui
          vínculo, ranking e comissões futuras aos dois responsáveis.
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
        {originConfirmed && (
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
              {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}{" "}
              Copiar
            </Button>
            {whatsappUrl ? (
              <Button
                type="button"
                size="sm"
                className="bg-[#25D366] font-black text-white hover:bg-[#20bd5a]"
                asChild
              >
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={registerWhatsAppSend}
                >
                  <MessageCircle className="mr-1.5 h-4 w-4" /> WhatsApp
                </a>
              </Button>
            ) : (
              <Button type="button" size="sm" variant="outline" disabled>
                Telefone não informado
              </Button>
            )}
          </div>
        )}
      </div>

      {!originConfirmed ? (
        <div className="rounded-xl border border-amber-300 bg-white p-3">
          <div className="flex items-start gap-2">
            <UsersRound className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <div>
              <p className="text-xs font-black text-neutral-800">
                A origem não pôde ser identificada automaticamente
              </p>
              <p className="mt-1 text-[11px] font-semibold text-neutral-600">
                Se outro Vendedor marcou esta reunião, selecione-o para que o cadastro conte para os
                dois. Caso contrário, confirme que a captação foi somente do Closer.
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Select value={selectedSdrId} onValueChange={setSelectedSdrId}>
              <SelectTrigger className="h-9 flex-1 bg-white text-xs font-bold">
                <SelectValue placeholder="Selecione o Vendedor de origem" />
              </SelectTrigger>
              <SelectContent>
                {sdrs.map((sdr) => (
                  <SelectItem key={sdr.id} value={sdr.id}>
                    {sdr.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              onClick={() => void confirmSdrOrigin()}
              disabled={!selectedSdrId || confirmingOrigin}
              className="bg-yellow-400 font-black text-black hover:bg-yellow-500"
            >
              {confirmingOrigin && <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" />}
              Vincular Vendedor
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setCloserOnlyConfirmed(true)}
            >
              Somente Closer
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="break-all rounded-lg bg-white px-3 py-2 font-mono text-[10px] text-neutral-500">
            {url}
          </p>
          <p className="text-[11px] font-semibold text-neutral-600">
            {sourceSdrName
              ? `Link permanente: os cadastros profissionais contam para este Closer e para o Vendedor ${sourceSdrName}.`
              : "Link permanente: cadastro confirmado somente para o Closer."}
          </p>
        </>
      )}
    </div>
  );
}
