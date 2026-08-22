import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Clock, Copy, FileText, CalendarClock } from "lucide-react";
import { statusPagamentoLabel } from "@/lib/asaas-payment";
import { MESES_PT, formatDateBr } from "@/lib/asaas-payment";
import { toast } from "sonner";

export type ParcelaCronograma = {
  installmentNumber: number;
  dueDate: string;
  value: number;
  status: string;
  boletoUrl: string | null;
  boletoBarcode: string | null;
  faturaId: string;
};

export type CronogramaResultado = {
  installmentTotal: number;
  installments: ParcelaCronograma[];
  recipient?: {
    responsible: "agency" | "tenant" | null;
    type: "user" | "tenant" | null;
    emailMasked: string | null;
    phoneMasked: string | null;
  } | null;
};

interface ModalCronogramaBoletosProps {
  open: boolean;
  resultado: CronogramaResultado | null;
  onFechar: () => void;
  /** "Pagar depois": deixa os boletos em aberto na aba de faturas do usuário. */
  onPagarDepois?: (resultado: CronogramaResultado) => Promise<void> | void;
}

export function ModalCronogramaBoletos({
  open,
  resultado,
  onFechar,
  onPagarDepois,
}: ModalCronogramaBoletosProps) {
  const [adiando, setAdiando] = useState(false);

  if (!resultado) return null;

  const valorFmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  async function pagarDepois() {
    if (!onPagarDepois || !resultado) return;
    setAdiando(true);
    try {
      await onPagarDepois(resultado);
    } finally {
      setAdiando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-2xl">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-yellow-50">
            <CalendarClock className="h-6 w-6 text-yellow-600" />
          </div>
          <DialogTitle className="text-xl font-bold text-neutral-900">
            {resultado.installmentTotal} boletos gerados
          </DialogTitle>
          <DialogDescription className="text-sm text-neutral-600">
            Cada mensalidade é uma cobrança independente no Asaas — pode ser paga separadamente.
          </DialogDescription>
        </div>

        {resultado.recipient && (resultado.recipient.emailMasked || resultado.recipient.phoneMasked) && (
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
            <p className="font-semibold text-neutral-800">
              Responsável pelo pagamento: {resultado.recipient.responsible === "agency" ? "Imobiliária" : "Inquilino"}
            </p>
            {resultado.recipient.emailMasked && <p>Cobranças enviadas para: {resultado.recipient.emailMasked}</p>}
            {resultado.recipient.phoneMasked && <p>SMS enviado para: {resultado.recipient.phoneMasked}</p>}
          </div>
        )}

        <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
          {resultado.installments.map((parcela) => (
            <ParcelaLinha key={parcela.faturaId} parcela={parcela} total={resultado.installmentTotal} valorFmt={valorFmt} />
          ))}
        </div>

        {onPagarDepois && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="flex items-center gap-1.5 font-bold">
              <Clock className="h-3.5 w-3.5" /> Prefere pagar depois?
            </p>
            <p className="mt-1 leading-relaxed">
              Os boletos ficam em aberto na aba de faturas e podem ser pagos a qualquer momento.
              A proposta só é enviada para assinatura após a confirmação do primeiro pagamento.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {onPagarDepois && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void pagarDepois()}
              disabled={adiando}
              className="w-full border-amber-300 text-amber-800 hover:bg-amber-50"
            >
              <Clock className="mr-2 h-4 w-4" />
              {adiando ? "Registrando..." : "Pagar depois"}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onFechar} className="w-full">
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ParcelaLinha({
  parcela,
  total,
  valorFmt,
}: {
  parcela: ParcelaCronograma;
  total: number;
  valorFmt: (v: number) => string;
}) {
  const [copiado, setCopiado] = useState(false);
  const [ano, mes] = parcela.dueDate.split("-").map(Number);

  async function copiar() {
    if (!parcela.boletoBarcode) return;
    try {
      await navigator.clipboard.writeText(parcela.boletoBarcode);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error("Não foi possível copiar agora.");
    }
  }

  return (
    <div className="rounded-lg border border-neutral-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-neutral-900">
            Mês {parcela.installmentNumber} de {total} — {MESES_PT[mes - 1]} de {ano}
          </p>
          <p className="text-xs text-neutral-500">
            Vencimento: {formatDateBr(parcela.dueDate)} · {valorFmt(parcela.value)}
          </p>
        </div>
        <Badge variant="outline" className="text-xs">
          {statusPagamentoLabel(parcela.status)}
        </Badge>
      </div>
      <div className="mt-2 flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 flex-1 gap-1 text-xs"
          onClick={copiar}
          disabled={!parcela.boletoBarcode}
        >
          {copiado ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
          Copiar linha digitável
        </Button>
        {parcela.boletoUrl && (
          <a href={parcela.boletoUrl} target="_blank" rel="noreferrer" className="flex-1">
            <Button type="button" size="sm" variant="outline" className="h-8 w-full gap-1 text-xs">
              <FileText className="h-3 w-3" />
              Ver boleto
            </Button>
          </a>
        )}
      </div>
    </div>
  );
}
