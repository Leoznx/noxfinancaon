import { useState } from "react";
import {
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  Mail,
  MessageCircle,
  RefreshCw,
  ReceiptText,
  RotateCw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  cardRegistrationStatusLabel,
  isPagamentoConcluido,
  statusPagamentoLabel,
  subscriptionStatusLabel,
  type NormalizedAsaasSubscription,
} from "@/lib/asaas-payment";

type Channel = "email" | "whatsapp";

interface ModalAssinaturaAsaasProps {
  open: boolean;
  resultado: NormalizedAsaasSubscription | null;
  onFechar: () => void;
  onAtualizar: () => Promise<void>;
  onReenviar: (channel: Channel) => Promise<void>;
  onReemitirInicial: () => Promise<void>;
  onReemitirCheckout: () => Promise<void>;
  onRetomarCartaoDireto: () => void;
  onIrParaFaturas: () => void;
}

export function ModalAssinaturaAsaas({
  open,
  resultado,
  onFechar,
  onAtualizar,
  onReenviar,
  onReemitirInicial,
  onReemitirCheckout,
  onRetomarCartaoDireto,
  onIrParaFaturas,
}: ModalAssinaturaAsaasProps) {
  const [copiado, setCopiado] = useState(false);
  const [busy, setBusy] = useState<
    "refresh" | "reissue_initial" | "reissue_checkout" | Channel | null
  >(null);

  if (!resultado) return null;

  const recurringLinkExpired =
    resultado.mode === "checkout" &&
    (resultado.checkoutStatus === "cancelled" || resultado.checkoutStatus === "expired");
  const link = recurringLinkExpired ? null : resultado.checkoutUrl;
  const initialLinkExpired =
    resultado.mode === "checkout" &&
    (resultado.initialCheckoutStatus === "cancelled" || resultado.initialCheckoutStatus === "expired");
  const precisaRetomarCartaoDireto =
    resultado.mode === "direct" &&
    !resultado.subscriptionId &&
    isPagamentoConcluido(resultado.paymentStatus);
  const brl = (value: number) =>
    Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  async function copiarLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
      toast.success("Link copiado.");
    } catch {
      toast.error("Não foi possível copiar o link agora.");
    }
  }

  async function atualizar() {
    setBusy("refresh");
    try {
      await onAtualizar();
      toast.success("Status da assinatura atualizado.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível atualizar a assinatura agora.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function reenviar(channel: Channel) {
    setBusy(channel);
    try {
      await onReenviar(channel);
      toast.success(channel === "email" ? "E-mail reenviado." : "WhatsApp reenviado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível reenviar o link agora.");
    } finally {
      setBusy(null);
    }
  }

  async function reemitirInicial() {
    setBusy("reissue_initial");
    try {
      await onReemitirInicial();
      toast.success("Novo link da cobrança inicial gerado e enviado.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível gerar um novo link inicial agora.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function reemitirCheckout() {
    setBusy("reissue_checkout");
    try {
      await onReemitirCheckout();
      toast.success("Novo link de cadastro recorrente gerado e enviado.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível gerar um novo link de cadastro agora.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onFechar()}>
      <DialogContent className="max-w-lg rounded-2xl">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-yellow-50">
            <CreditCard className="h-6 w-6 text-yellow-700" />
          </div>
          <DialogTitle className="text-xl font-bold text-neutral-900">
            {resultado.mode === "checkout"
              ? cardRegistrationStatusLabel(resultado.cardRegistrationStatus)
              : "Cartão enviado para processamento"}
          </DialogTitle>
          <DialogDescription className="text-sm text-neutral-600">
            A assinatura mensal só será considerada ativa depois da confirmação do Asaas.
          </DialogDescription>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <StatusItem label="Cadastro do cartão" value={cardRegistrationStatusLabel(resultado.cardRegistrationStatus)} />
          <StatusItem label="Assinatura" value={subscriptionStatusLabel(resultado.status)} />
          <StatusItem label="Pagamento" value={statusPagamentoLabel(resultado.paymentStatus)} />
        </div>

        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
          <div className="flex justify-between gap-3">
            <span>Valor inicial</span>
            <strong>{brl(resultado.initialAmount)}</strong>
          </div>
          <div className="mt-1 flex justify-between gap-3">
            <span>Mensalidade recorrente</span>
            <strong>{brl(resultado.monthlyAmount)}</strong>
          </div>
          {resultado.nextDueDate && (
            <div className="mt-1 flex justify-between gap-3">
              <span>Próximo vencimento</span>
              <strong>
                {new Date(`${resultado.nextDueDate}T00:00:00`).toLocaleDateString("pt-BR")}
              </strong>
            </div>
          )}
          {resultado.subscriptionId && (
            <p className="mt-2 break-all text-[11px] text-neutral-500">
              Assinatura Asaas: {resultado.subscriptionId}
            </p>
          )}
        </div>

        {resultado.mode === "checkout" && link && (
          <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-yellow-900">
              Link seguro para o inquilino
            </p>
            <p className="mt-1 break-all text-xs text-neutral-700">{link}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={copiarLink}>
                {copiado ? <Check className="mr-1 h-4 w-4 text-emerald-600" /> : <Copy className="mr-1 h-4 w-4" />}
                Copiar link
              </Button>
              <a href={link} target="_blank" rel="noreferrer">
                <Button type="button" size="sm" className="bg-neutral-900 text-white hover:bg-neutral-800">
                  <ExternalLink className="mr-1 h-4 w-4" /> Abrir link
                </Button>
              </a>
            </div>
          </div>
        )}

        {recurringLinkExpired && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            <p className="font-bold">Link de cadastro recorrente indisponível</p>
            <p className="mt-1">
              O link foi {resultado.checkoutStatus === "expired" ? "expirado" : "cancelado"}.
              Gere um novo link antes de reenviá-lo ao inquilino.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 bg-white"
              disabled={busy !== null}
              onClick={() => void reemitirCheckout()}
            >
              <RotateCw className={`mr-1 h-4 w-4 ${busy === "reissue_checkout" ? "animate-spin" : ""}`} />
              Gerar novo link de cadastro
            </Button>
          </div>
        )}

        {precisaRetomarCartaoDireto && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
            <p className="font-bold">Pagamento inicial confirmado</p>
            <p className="mt-1">
              A recorrência mensal ainda precisa da autorização do cartão. Por segurança, os
              dados não foram armazenados; informe-os novamente para concluir a assinatura.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 bg-white"
              onClick={onRetomarCartaoDireto}
            >
              <CreditCard className="mr-1 h-4 w-4" /> Informar cartão novamente
            </Button>
          </div>
        )}

        {resultado.split.required && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
            <p className="font-bold">Pagamento inicial separado</p>
            <p className="mt-1">
              {resultado.split.reason ||
                "O cadastro recorrente não confirma automaticamente o valor inicial da contratação."}
            </p>
            {resultado.split.initialPaymentUrl && (
              <a
                href={resultado.split.initialPaymentUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center font-bold underline"
              >
                <ReceiptText className="mr-1 h-3.5 w-3.5" /> Abrir cobrança inicial
              </a>
            )}
            {initialLinkExpired && (
              <div className="mt-3 rounded-md border border-red-200 bg-white p-2">
                <p className="font-semibold text-red-700">
                  O link inicial foi {resultado.initialCheckoutStatus === "expired" ? "expirado" : "cancelado"}.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  disabled={busy !== null}
                  onClick={() => void reemitirInicial()}
                >
                  <RotateCw className={`mr-1 h-4 w-4 ${busy === "reissue_initial" ? "animate-spin" : ""}`} />
                  Gerar novo link inicial
                </Button>
              </div>
            )}
          </div>
        )}

        {resultado.recipient && (
          <div className="rounded-lg border border-neutral-200 p-3 text-xs text-neutral-600">
            <p className="font-semibold text-neutral-900">
              Responsável: {resultado.recipient.name || "Inquilino"}
            </p>
            {resultado.recipient.emailMasked && <p>E-mail: {resultado.recipient.emailMasked}</p>}
            {resultado.recipient.phoneMasked && <p>WhatsApp: {resultado.recipient.phoneMasked}</p>}
            {resultado.notifications?.email && (
              <p>E-mail — {notificationLabel(resultado.notifications.email.status)}</p>
            )}
            {resultado.notifications?.whatsapp && (
              <p>WhatsApp — {notificationLabel(resultado.notifications.whatsapp.status)}</p>
            )}
          </div>
        )}

        {!initialLinkExpired && !recurringLinkExpired && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void reenviar("whatsapp")}
          >
            <MessageCircle className="mr-2 h-4 w-4" />
            Reenviar WhatsApp
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void reenviar("email")}
          >
            <Mail className="mr-2 h-4 w-4" />
            Reenviar e-mail
          </Button>
        </div>}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void atualizar()}>
            <RefreshCw className={`mr-2 h-4 w-4 ${busy === "refresh" ? "animate-spin" : ""}`} />
            Atualizar status
          </Button>
          <Button type="button" variant="outline" onClick={onIrParaFaturas}>
            Ir para faturas
          </Button>
          <Button type="button" className="bg-yellow-400 text-neutral-950 hover:bg-yellow-300" onClick={onFechar}>
            Concluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-2.5 text-center">
      <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-xs font-semibold text-neutral-900">{value}</p>
    </div>
  );
}

function notificationLabel(status: string) {
  if (status === "sent") return "enviado";
  if (status === "queued") return "na fila";
  if (status === "failed") return "falhou; pode reenviar";
  return "não enviado";
}
