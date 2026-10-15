import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  FileText,
  Mail,
  MessageCircle,
  QrCode,
  RefreshCw,
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
import { Input } from "@/components/ui/input";
import {
  isPagamentoConcluido,
  paymentLink,
  policyStatusLabel,
  signatureStatusLabel,
  statusPagamentoLabel,
  type CheckoutIntent,
  type NormalizedAsaasPayment,
} from "@/lib/asaas-payment";

type Channel = "email" | "whatsapp";

interface ModalPagamentoAsaasProps {
  open: boolean;
  resultado: NormalizedAsaasPayment | null;
  intent?: CheckoutIntent;
  onAtualizarResultado: (resultado: NormalizedAsaasPayment) => void;
  onFechar: () => void;
  onAtualizarStatus: () => Promise<NormalizedAsaasPayment | void>;
  onReemitir?: () => Promise<void>;
  onReenviar?: (channel: Channel) => Promise<void>;
  onRetryInstallments?: () => Promise<void>;
  onIrParaFaturas?: () => void;
}

function useCopiar() {
  const [copiado, setCopiado] = useState(false);
  const copiar = async (texto: string, mensagem = "Código copiado.") => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
      toast.success(mensagem);
    } catch {
      toast.error("Não foi possível copiar agora.");
    }
  };
  return { copiado, copiar };
}

export function ModalPagamentoAsaas({
  open,
  resultado,
  intent,
  onAtualizarResultado,
  onFechar,
  onAtualizarStatus,
  onReemitir,
  onReenviar,
  onRetryInstallments,
  onIrParaFaturas,
}: ModalPagamentoAsaasProps) {
  const codigoCopiar = useCopiar();
  const linkCopiar = useCopiar();
  const [busy, setBusy] = useState<"refresh" | "reissue" | Channel | null>(null);
  const atualizacaoAutomaticaRef = useRef(false);

  const status = resultado?.paymentStatus || resultado?.status;
  const concluido = isPagamentoConcluido(status);
  const adiado = intent === "pay_later" || resultado?.deferPayment;
  const consolidado = status === "awaiting_consolidation";

  useEffect(() => {
    if (!open || concluido || consolidado || adiado) return;
    const interval = window.setInterval(() => {
      if (atualizacaoAutomaticaRef.current) return;
      atualizacaoAutomaticaRef.current = true;
      void onAtualizarStatus()
        .then((atualizado) => {
          if (atualizado) onAtualizarResultado(atualizado);
        })
        .catch(() => undefined)
        .finally(() => {
          atualizacaoAutomaticaRef.current = false;
        });
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [adiado, concluido, consolidado, onAtualizarResultado, onAtualizarStatus, open]);

  if (!resultado) return null;

  const isPix = resultado.paymentMethod === "pix";
  const link = paymentLink(resultado);
  const codigo = isPix ? resultado.pix?.qrCode : resultado.boleto?.barcode;
  const valor = resultado.amount.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
  const pixImage = resultado.pix?.qrCodeBase64
    ? resultado.pix.qrCodeBase64.startsWith("data:")
      ? resultado.pix.qrCodeBase64
      : `data:image/png;base64,${resultado.pix.qrCodeBase64}`
    : "";

  async function executar(
    action: "refresh" | "reissue" | Channel,
    callback: (() => Promise<NormalizedAsaasPayment | void>) | undefined,
    success: string,
  ) {
    if (!callback) return;
    setBusy(action);
    try {
      const atualizado = await callback();
      if (atualizado) onAtualizarResultado(atualizado);
      toast.success(success);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível concluir a ação agora.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onFechar()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto rounded-2xl">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-yellow-50">
            {isPix ? (
              <QrCode className="h-6 w-6 text-yellow-700" />
            ) : (
              <FileText className="h-6 w-6 text-yellow-700" />
            )}
          </div>
          <DialogTitle className="text-xl font-bold text-neutral-900">
            {consolidado
              ? "Enviado ao faturamento consolidado"
              : adiado
                ? "Cobrança gerada com sucesso"
                : concluido
                  ? "Pagamento identificado"
                  : isPix
                    ? "Pague com Pix"
                    : "Boleto gerado"}
          </DialogTitle>
          <DialogDescription className="text-sm text-neutral-600">
            {consolidado
              ? "A parcela foi registrada no financeiro da imobiliária e será incluída no lote, sem cobrança individual duplicada."
              : adiado
                ? "O processo de contratação continuará normalmente. O pagamento está pendente."
                : isPix
                  ? "Escaneie o QR Code ou copie o código no aplicativo do banco."
                  : "Copie a linha digitável ou abra o boleto para pagar."}
          </DialogDescription>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <StatusItem label="Pagamento" value={statusPagamentoLabel(status)} />
          <StatusItem label="Assinatura" value={signatureStatusLabel(resultado.signatureStatus)} />
          <StatusItem label="Apólice" value={policyStatusLabel(resultado.policyStatus)} />
        </div>

        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
          <div className="flex justify-between gap-3">
            <span>Valor</span>
            <strong>{valor}</strong>
          </div>
          <div className="mt-1 flex justify-between gap-3">
            <span>Vencimento</span>
            <strong>
              {resultado.dueDate
                ? new Date(`${resultado.dueDate}T00:00:00`).toLocaleDateString("pt-BR")
                : "Conforme fatura"}
            </strong>
          </div>
          <div className="mt-1 flex justify-between gap-3">
            <span>Responsável financeiro</span>
            <strong>
              {resultado.recipient?.name ||
                (resultado.recipient?.responsible === "agency" ? "Imobiliária" : "Inquilino")}
            </strong>
          </div>
          {resultado.paymentId && (
            <p className="mt-2 break-all text-[11px] text-neutral-500">
              Cobrança Asaas: {resultado.paymentId}
            </p>
          )}
        </div>

        {isPix && pixImage && !concluido && (
          <img
            src={pixImage}
            alt="QR Code Pix"
            className="mx-auto h-52 w-52 rounded-lg border border-neutral-200 p-2"
          />
        )}

        {codigo && !concluido && (
          <div className="flex w-full items-center gap-2">
            <Input readOnly value={codigo} className="font-mono text-xs" />
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                codigoCopiar.copiar(
                  codigo,
                  isPix ? "Código Pix copiado." : "Linha digitável copiada.",
                )
              }
            >
              {codigoCopiar.copiado ? (
                <Check className="h-4 w-4 text-emerald-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        )}

        {link && (
          <div className="rounded-lg border border-neutral-200 p-3">
            <p className="break-all text-xs text-neutral-600">{link}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => linkCopiar.copiar(link, "Link copiado.")}
              >
                {linkCopiar.copiado ? (
                  <Check className="mr-1 h-4 w-4 text-emerald-600" />
                ) : (
                  <Copy className="mr-1 h-4 w-4" />
                )}
                Copiar link
              </Button>
              <a href={link} target="_blank" rel="noreferrer">
                <Button
                  type="button"
                  size="sm"
                  className="bg-neutral-900 text-white hover:bg-neutral-800"
                >
                  <ExternalLink className="mr-1 h-4 w-4" /> Abrir cobrança
                </Button>
              </a>
            </div>
          </div>
        )}

        {concluido && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center text-sm font-semibold text-emerald-700">
            Pagamento identificado com sucesso.
          </div>
        )}

        {resultado.recipient && (
          <div className="rounded-lg border border-neutral-200 p-3 text-xs text-neutral-600">
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

        {(onReenviar || onReemitir) && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {onReenviar && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() =>
                    void executar(
                      "whatsapp",
                      () => onReenviar("whatsapp"),
                      "Cobrança reenviada por WhatsApp.",
                    )
                  }
                >
                  <MessageCircle className="mr-2 h-4 w-4" /> Reenviar WhatsApp
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() =>
                    void executar(
                      "email",
                      () => onReenviar("email"),
                      "Cobrança reenviada por e-mail.",
                    )
                  }
                >
                  <Mail className="mr-2 h-4 w-4" /> Reenviar e-mail
                </Button>
              </>
            )}
            {onReemitir && !concluido && (
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void executar("reissue", onReemitir, "Segunda via gerada.")}
              >
                <RotateCw className={`mr-2 h-4 w-4 ${busy === "reissue" ? "animate-spin" : ""}`} />
                Gerar segunda via
              </Button>
            )}
          </div>
        )}

        {onRetryInstallments && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
            <p className="font-bold">A cobrança inicial está preservada.</p>
            <p className="mt-1">
              As mensalidades futuras ainda não foram preparadas. Tente novamente sem gerar outra
              cobrança inicial.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 border-amber-300 bg-white"
              disabled={busy !== null}
              onClick={() =>
                void executar("reissue", onRetryInstallments, "Mensalidades futuras preparadas.")
              }
            >
              <RefreshCw className="mr-2 h-4 w-4" /> Tentar mensalidades novamente
            </Button>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void executar("refresh", onAtualizarStatus, "Status atualizado.")}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${busy === "refresh" ? "animate-spin" : ""}`} />
            Atualizar status
          </Button>
          {onIrParaFaturas && (
            <Button type="button" variant="outline" onClick={onIrParaFaturas}>
              Ir para faturas
            </Button>
          )}
          <Button
            type="button"
            className="bg-yellow-400 text-neutral-950 hover:bg-yellow-300"
            onClick={onFechar}
          >
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
