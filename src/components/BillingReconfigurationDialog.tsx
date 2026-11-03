import { useEffect, useMemo, useState } from "react";
import { CalendarClock, CreditCard, Loader2, RefreshCw, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  canReconfigureInvoice,
  RECONFIGURABLE_PAYMENT_METHODS,
  reconfigurablePaymentMethodLabel,
  reconfigureInvoice,
  type ReconfigurablePaymentMethod,
} from "@/lib/invoice-reconfiguration";
import {
  nextInvoiceDueDate,
  normalizePaymentDueDay,
  PAYMENT_DUE_DAYS,
  type PaymentDueDay,
} from "@/lib/payment-due-date";

type Props = {
  invoiceId?: string | null;
  status?: string | null;
  method?: string | null;
  dueDate?: string | null;
  onUpdated: () => void | Promise<void>;
  compact?: boolean;
};

const formatDate = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR");

export function BillingReconfigurationDialog({
  invoiceId,
  status,
  method,
  dueDate,
  onUpdated,
  compact = false,
}: Props) {
  const available = canReconfigureInvoice({ invoiceId, status, method });
  const normalizedMethod = String(method || "").toLowerCase();
  const initialMethod: ReconfigurablePaymentMethod =
    normalizedMethod === "pix" || normalizedMethod === "credit_card" ? normalizedMethod : "boleto";
  const initialDueDay = normalizePaymentDueDay(String(dueDate || "").slice(-2)) ?? 10;
  const [open, setOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<ReconfigurablePaymentMethod>(initialMethod);
  const [dueDay, setDueDay] = useState<PaymentDueDay>(initialDueDay);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPaymentMethod(initialMethod);
    setDueDay(initialDueDay);
  }, [initialDueDay, initialMethod, open]);

  const selectedDate = useMemo(() => nextInvoiceDueDate(dueDate, dueDay), [dueDate, dueDay]);

  if (!available || !invoiceId) return null;
  const targetInvoiceId = invoiceId;

  async function submit() {
    if (saving) return;
    setSaving(true);
    try {
      const result = await reconfigureInvoice({
        invoiceId: targetInvoiceId,
        paymentMethod,
        billingDueDay: dueDay,
      });
      const cancelled = Number(result?.invoice?.obsoleteChargesCancelled || 0);
      const paymentUrl = result?.invoice?.paymentUrl || null;
      toast.success(
        paymentMethod === "credit_card"
          ? "Cobrança alterada para cartão. O link seguro foi enviado automaticamente ao responsável."
          : cancelled > 0
            ? `Cobrança atualizada e ${cancelled} cobrança(s) antiga(s) cancelada(s).`
            : "Cobrança atualizada sem duplicidade.",
        paymentMethod === "credit_card" && paymentUrl
          ? {
              action: {
                label: "Abrir link seguro",
                onClick: () => window.open(paymentUrl, "_blank", "noopener,noreferrer"),
              },
            }
          : undefined,
      );
      setOpen(false);
      await onUpdated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível alterar a cobrança.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className={compact ? "h-8 rounded-lg gap-1 px-2" : "rounded-lg gap-2 font-bold"}
        >
          <RefreshCw size={12} /> {compact ? "Alterar" : "Alterar cobrança"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] w-[calc(100%-1rem)] max-w-lg overflow-y-auto rounded-2xl sm:w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-black">
            <WalletCards className="h-5 w-5 text-yellow-500" /> Alterar cobrança
          </DialogTitle>
          <DialogDescription>
            Escolha a modalidade e um dos vencimentos permitidos. A cobrança atual será substituída
            no mesmo registro e eventuais duplicadas da parcela serão canceladas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <fieldset className="space-y-2">
            <legend className="text-xs font-black uppercase tracking-widest text-neutral-500">
              Modalidade de pagamento
            </legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {RECONFIGURABLE_PAYMENT_METHODS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={paymentMethod === option}
                  onClick={() => setPaymentMethod(option)}
                  className={`rounded-xl border px-4 py-3 text-sm font-black transition ${
                    paymentMethod === option
                      ? "border-yellow-400 bg-yellow-50 text-neutral-950 ring-2 ring-yellow-100"
                      : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"
                  }`}
                >
                  <span className="inline-flex items-center justify-center gap-2">
                    {option === "credit_card" ? <CreditCard className="h-4 w-4" /> : null}
                    {reconfigurablePaymentMethodLabel(option)}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-xs font-black uppercase tracking-widest text-neutral-500">
              Novo vencimento
            </legend>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_DUE_DAYS.map((option) => {
                const optionDate = nextInvoiceDueDate(dueDate, option);
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={dueDay === option}
                    onClick={() => setDueDay(option)}
                    className={`rounded-xl border px-2 py-2.5 text-center transition ${
                      dueDay === option
                        ? "border-yellow-400 bg-yellow-50 ring-2 ring-yellow-100"
                        : "border-neutral-200 bg-white hover:border-neutral-300"
                    }`}
                  >
                    <span className="block text-sm font-black text-neutral-900">Dia {option}</span>
                    <span className="block text-[10px] font-bold text-neutral-500">
                      {formatDate(optionDate)}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="flex gap-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-950">
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Nova cobrança: <strong>{reconfigurablePaymentMethodLabel(paymentMethod)}</strong>,
              vencendo em <strong>{formatDate(selectedDate)}</strong>.{" "}
              {paymentMethod === "credit_card"
                ? "O responsável receberá automaticamente o link seguro do Asaas para informar o cartão."
                : "Links e códigos antigos deixarão de ser usados automaticamente."}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} disabled={saving} className="font-black">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {saving
              ? "Refazendo cobrança..."
              : paymentMethod === "credit_card"
                ? "Confirmar e gerar link"
                : "Confirmar alteração"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
