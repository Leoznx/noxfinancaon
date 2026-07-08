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
import { Copy, Check, QrCode, FileText, ExternalLink } from "lucide-react";
import type { NormalizedCaktoPayment } from "@/lib/cakto.service";

interface ModalPagamentoCaktoProps {
  open: boolean;
  resultado: NormalizedCaktoPayment | null;
  onFechar: () => void;
}

function useCopiar() {
  const [copiado, setCopiado] = useState(false);
  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      // navegador sem permissão de clipboard — botão só não confirma visualmente
    }
  };
  return { copiado, copiar };
}

/**
 * Mostra o QR Code/código copia-e-cola do Pix ou a linha digitável do boleto retornados
 * pela Cakto na criação da cobrança. Cartão não passa por aqui — vai direto pro
 * checkout hospedado (ver ResumoPropostaLoft em consultas.$id.finalizar.lazy.tsx).
 */
export function ModalPagamentoCakto({ open, resultado, onFechar }: ModalPagamentoCaktoProps) {
  const pixCopiar = useCopiar();
  const boletoCopiar = useCopiar();

  if (!resultado) return null;
  const isPix = resultado.paymentMethod === "pix" && resultado.pix;
  const isBoleto = resultado.paymentMethod === "boleto" && resultado.boleto;

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
              Escaneie o QR Code ou copie o código abaixo no app do seu banco.
            </DialogDescription>
            {resultado.pix.qrCodeBase64 && (
              <img
                src={resultado.pix.qrCodeBase64}
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
              Copie a linha digitável ou abra o PDF para pagar no banco de sua preferência.
            </DialogDescription>
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
                  Abrir boleto (PDF)
                </Button>
              </a>
            )}
          </div>
        )}

        {resultado.checkoutUrl && (
          <a
            href={resultado.checkoutUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block text-center"
          >
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-neutral-500 underline hover:text-neutral-700">
              Ou pague pela página da Cakto <ExternalLink className="h-3 w-3" />
            </span>
          </a>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onFechar} className="w-full">
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
