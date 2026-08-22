import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Check, Clock, Copy, FileText, QrCode, RefreshCw } from "lucide-react";
import {
  isPagamentoConcluido,
  statusPagamentoLabel,
  type NormalizedAsaasPayment,
} from "@/lib/asaas-payment";
import { toast } from "sonner";

interface ModalPagamentoAsaasProps {
  open: boolean;
  resultado: NormalizedAsaasPayment | null;
  onAtualizarResultado: (resultado: NormalizedAsaasPayment) => void;
  onFechar: () => void;
  /**
   * "Pagar depois" — só faz sentido em Pix/boleto, que ficam em aberto e podem
   * ser pagos mais tarde. Quando ausente, o botão não aparece.
   */
  onPagarDepois?: (resultado: NormalizedAsaasPayment) => Promise<void> | void;
}

function useCopiar() {
  const [copiado, setCopiado] = useState(false);
  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error("Nao foi possivel copiar agora.");
    }
  };
  return { copiado, copiar };
}

export function ModalPagamentoAsaas({
  open,
  resultado,
  onAtualizarResultado,
  onFechar,
  onPagarDepois,
}: ModalPagamentoAsaasProps) {
  const pixCopiar = useCopiar();
  const boletoCopiar = useCopiar();
  const [consultando, setConsultando] = useState(false);
  const [adiando, setAdiando] = useState(false);
  const [confirmandoAdiar, setConfirmandoAdiar] = useState(false);

  if (!resultado) return null;

  const isPix = resultado.paymentMethod === "pix" && resultado.pix;
  const isBoleto = resultado.paymentMethod === "boleto" && resultado.boleto;
  const valor = resultado.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const concluido = isPagamentoConcluido(resultado.status);
  const pixImage = resultado.pix?.qrCodeBase64
    ? resultado.pix.qrCodeBase64.startsWith("data:")
      ? resultado.pix.qrCodeBase64
      : `data:image/png;base64,${resultado.pix.qrCodeBase64}`
    : "";

  async function consultarStatus() {
    if (!resultado?.paymentId) return;
    setConsultando(true);
    try {
      const { data, error } = await supabase.functions.invoke<NormalizedAsaasPayment>(
        "asaas-get-payment",
        {
          body: { paymentId: resultado.paymentId },
        },
      );
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      if (data) {
        onAtualizarResultado(data);
        toast.success(statusPagamentoLabel(data.status));
      }
    } catch (error: any) {
      toast.error(error?.message || "Nao foi possivel atualizar o status.");
    } finally {
      setConsultando(false);
    }
  }

  // Pagar depois só existe para cobranças que continuam válidas sem pagamento
  // imediato (Pix e boleto) e que ainda não foram quitadas.
  const podeAdiar = !!onPagarDepois && !concluido && !!(isPix || isBoleto);

  async function pagarDepois() {
    if (!onPagarDepois || !resultado) return;
    setAdiando(true);
    try {
      await onPagarDepois(resultado);
      setConfirmandoAdiar(false);
    } finally {
      setAdiando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-md rounded-2xl">
        {isPix && resultado.pix && (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-yellow-50">
              <QrCode className="h-6 w-6 text-yellow-600" />
            </div>
            <DialogTitle className="text-xl font-bold text-neutral-900">Pague com Pix</DialogTitle>
            <DialogDescription className="text-sm text-neutral-600">
              Escaneie o QR Code ou copie o codigo abaixo no app do banco.
            </DialogDescription>
            <StatusPill status={resultado.status} valor={valor} />
            {pixImage && (
              <img
                src={pixImage}
                alt="QR Code Pix"
                className="h-56 w-56 rounded-lg border border-neutral-200 p-2"
              />
            )}
            <div className="flex w-full items-center gap-2">
              <Input readOnly value={resultado.pix.qrCode} className="font-mono text-xs" />
              <Button
                type="button"
                variant="outline"
                onClick={() => pixCopiar.copiar(resultado.pix!.qrCode)}
                className="shrink-0"
              >
                {pixCopiar.copiado ? (
                  <Check className="h-4 w-4 text-emerald-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            {resultado.pix.expiresAt && (
              <p className="text-xs text-neutral-500">
                Expira em {new Date(resultado.pix.expiresAt).toLocaleString("pt-BR")}
              </p>
            )}
          </div>
        )}

        {isBoleto && resultado.boleto && (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-yellow-50">
              <FileText className="h-6 w-6 text-yellow-600" />
            </div>
            <DialogTitle className="text-xl font-bold text-neutral-900">Boleto gerado</DialogTitle>
            <DialogDescription className="text-sm text-neutral-600">
              Copie a linha digitavel ou abra o boleto para pagar.
            </DialogDescription>
            <StatusPill status={resultado.status} valor={valor} />
            <div className="flex w-full items-center gap-2">
              <Input readOnly value={resultado.boleto.barcode} className="font-mono text-xs" />
              <Button
                type="button"
                variant="outline"
                onClick={() => boletoCopiar.copiar(resultado.boleto!.barcode)}
                className="shrink-0"
              >
                {boletoCopiar.copiado ? (
                  <Check className="h-4 w-4 text-emerald-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            {resultado.boleto.dueDate && (
              <p className="text-xs text-neutral-500">
                Vencimento:{" "}
                {new Date(`${resultado.boleto.dueDate}T00:00:00`).toLocaleDateString("pt-BR")}
              </p>
            )}
            {resultado.boleto.pdfUrl && (
              <a href={resultado.boleto.pdfUrl} target="_blank" rel="noreferrer" className="w-full">
                <Button
                  type="button"
                  className="w-full bg-neutral-900 text-white hover:bg-neutral-800"
                >
                  Visualizar boleto
                </Button>
              </a>
            )}
          </div>
        )}

        {resultado.paymentMethod === "credit_card" && (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-yellow-50">
              <Check className="h-6 w-6 text-yellow-600" />
            </div>
            <DialogTitle className="text-xl font-bold text-neutral-900">
              {statusPagamentoLabel(resultado.status)}
            </DialogTitle>
            <DialogDescription className="text-sm text-neutral-600">
              O processamento do cartao sera atualizado pelo Asaas.
            </DialogDescription>
            <StatusPill status={resultado.status} valor={valor} />
          </div>
        )}

        {concluido && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center text-sm font-semibold text-emerald-700">
            Pagamento identificado com sucesso.
          </div>
        )}

        {resultado.recipient && (resultado.recipient.emailMasked || resultado.recipient.phoneMasked) && (
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
            <p className="font-semibold text-neutral-800">
              Responsável pelo pagamento: {resultado.recipient.responsible === "agency" ? "Imobiliária" : "Inquilino"}
            </p>
            {resultado.recipient.emailMasked && <p>Cobrança enviada para: {resultado.recipient.emailMasked}</p>}
            {resultado.recipient.phoneMasked && <p>SMS enviado para: {resultado.recipient.phoneMasked}</p>}
          </div>
        )}

        {podeAdiar && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="flex items-center gap-1.5 font-bold">
              <Clock className="h-3.5 w-3.5" /> Prefere pagar depois?
            </p>
            <p className="mt-1 leading-relaxed">
              A cobrança fica em aberto na sua aba de faturas e pode ser paga a qualquer momento.
              O contrato só é enviado para assinatura após a confirmação do primeiro pagamento —
              por isso o ideal é pagar agora e seguir o fluxo.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={consultarStatus}
            disabled={consultando}
            className="w-full"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${consultando ? "animate-spin" : ""}`} />
            Atualizar status
          </Button>
          {podeAdiar && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmandoAdiar(true)}
              disabled={adiando}
              className="w-full border-amber-300 text-amber-800 hover:bg-amber-50"
            >
              <Clock className="mr-2 h-4 w-4" />
              Pagar depois
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onFechar} className="w-full">
            Fechar
          </Button>
        </DialogFooter>

        <AlertDialog open={confirmandoAdiar} onOpenChange={setConfirmandoAdiar}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Deixar esta cobrança em aberto?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm text-neutral-600">
                  <p>
                    A cobrança de <strong>{valor}</strong> ficará disponível na sua aba de faturas
                    em aberto e continua válida.
                  </p>
                  <p className="rounded-md border border-amber-200 bg-amber-50 p-3 font-semibold text-amber-900">
                    A proposta só será enviada para assinatura após o primeiro pagamento ser
                    identificado pelo sistema.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={adiando}>Voltar e pagar agora</AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  void pagarDepois();
                }}
                disabled={adiando}
                className="bg-neutral-900 text-white hover:bg-neutral-800"
              >
                {adiando ? "Registrando..." : "Confirmar e pagar depois"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

function StatusPill({ status, valor }: { status: string; valor: string }) {
  return (
    <div className="rounded-full bg-yellow-50 px-3 py-1 text-xs font-bold text-yellow-800">
      {statusPagamentoLabel(status)} - {valor}
    </div>
  );
}
