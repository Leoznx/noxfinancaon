"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatPixKey,
  maskPixKey,
  validateWithdrawalPixData,
  type NormalizedWithdrawalPixData,
  type PixKeyType,
} from "@/lib/withdrawal-pix";
import { formatCents, requestWithdrawal } from "@/lib/withdrawals";

export interface WithdrawalRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableCents: number;
  onSuccess: () => void | Promise<void>;
}

type DialogStep = "details" | "review";
type FormErrorField = "amount" | "bankName" | "holderName" | "pixKey" | "confirmation";
type FormErrors = Partial<Record<FormErrorField, string>>;

const PIX_KEY_OPTIONS: Array<{ value: PixKeyType; label: string }> = [
  { value: "cpf", label: "CPF" },
  { value: "cnpj", label: "CNPJ" },
  { value: "email", label: "E-mail" },
  { value: "phone", label: "Telefone" },
  { value: "random", label: "Chave aleatória" },
];

const PIX_KEY_LABELS = Object.fromEntries(
  PIX_KEY_OPTIONS.map(({ value, label }) => [value, label]),
) as Record<PixKeyType, string>;

const PIX_KEY_PLACEHOLDERS: Record<PixKeyType, string> = {
  cpf: "000.000.000-00",
  cnpj: "00.000.000/0000-00",
  email: "seuemail@exemplo.com",
  phone: "(00) 00000-0000",
  random: "00000000-0000-0000-0000-000000000000",
};

const BUSINESS_ERROR_MESSAGES: Record<string, string> = {
  ACTIVE_WITHDRAWAL_EXISTS:
    "Você já possui um saque em andamento. Aguarde a conclusão antes de solicitar outro.",
  NO_AVAILABLE_BALANCE: "Não há saldo disponível para saque. Atualize a página e tente novamente.",
};

function getSubmissionErrorMessage(code?: string, fallback?: string): string {
  if (code && BUSINESS_ERROR_MESSAGES[code]) return BUSINESS_ERROR_MESSAGES[code];
  const messageCode = Object.keys(BUSINESS_ERROR_MESSAGES).find((knownCode) =>
    fallback?.includes(knownCode),
  );
  if (messageCode) return BUSINESS_ERROR_MESSAGES[messageCode];
  return fallback || "Não foi possível solicitar o saque agora. Tente novamente.";
}

export function WithdrawalRequestDialog({
  open,
  onOpenChange,
  availableCents,
  onSuccess,
}: WithdrawalRequestDialogProps) {
  const [step, setStep] = useState<DialogStep>("details");
  const [bankName, setBankName] = useState("");
  const [holderName, setHolderName] = useState("");
  const [pixKeyType, setPixKeyType] = useState<PixKeyType>("cpf");
  const [pixKey, setPixKey] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [reviewData, setReviewData] = useState<NormalizedWithdrawalPixData | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const wasOpenRef = useRef(false);
  const isSubmittingRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setStep("details");
      setBankName("");
      setHolderName("");
      setPixKeyType("cpf");
      setPixKey("");
      setConfirmed(false);
      setErrors({});
      setReviewData(null);
      setIsSubmitting(false);
      isSubmittingRef.current = false;
      idempotencyKeyRef.current = crypto.randomUUID();
    }

    if (!open) idempotencyKeyRef.current = null;
    wasOpenRef.current = open;
  }, [open]);

  const clearError = (field: FormErrorField) => {
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isSubmittingRef.current) return;
    onOpenChange(nextOpen);
  };

  const handlePixKeyTypeChange = (value: PixKeyType) => {
    setPixKeyType(value);
    setPixKey("");
    clearError("pixKey");
  };

  const handleReview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const validation = validateWithdrawalPixData({
      bankName,
      holderName,
      pixKeyType,
      pixKey,
    });
    const nextErrors: FormErrors = validation.success ? {} : { ...validation.errors };

    if (!Number.isSafeInteger(availableCents) || availableCents <= 0) {
      nextErrors.amount = "Não há saldo disponível para solicitar este saque.";
    }
    if (!confirmed) {
      nextErrors.confirmation = "Confirme que os dados estão corretos para continuar.";
    }

    setErrors(nextErrors);
    if (!validation.success || Object.keys(nextErrors).length > 0) return;

    setReviewData(validation.data);
    setStep("review");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reviewData || isSubmittingRef.current) return;

    isSubmittingRef.current = true;
    setIsSubmitting(true);

    const idempotencyKey = idempotencyKeyRef.current ?? crypto.randomUUID();
    idempotencyKeyRef.current = idempotencyKey;

    try {
      const result = await requestWithdrawal(reviewData, idempotencyKey);
      if (!result.ok) {
        toast.error(getSubmissionErrorMessage(result.code));
        return;
      }

      toast.success(
        `Saque de ${formatCents(result.amount_cents ?? availableCents)} solicitado com sucesso.`,
      );

      try {
        await onSuccess();
      } catch {
        toast.error("O saque foi solicitado, mas os dados da tela não puderam ser atualizados.");
      }

      idempotencyKeyRef.current = null;
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      onOpenChange(false);
    } catch (error) {
      const source = error as { code?: string; message?: string };
      toast.error(getSubmissionErrorMessage(source?.code, source?.message));
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const inputMode = pixKeyType === "email" ? "email" : pixKeyType === "random" ? "text" : "numeric";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={`max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-2xl border-neutral-200 p-0 shadow-2xl [&>button]:text-white [&>button]:hover:bg-white/10 ${
          isSubmitting ? "[&>button]:pointer-events-none [&>button]:opacity-30" : ""
        }`}
        onEscapeKeyDown={(event) => {
          if (isSubmittingRef.current) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (isSubmittingRef.current) event.preventDefault();
        }}
      >
        <div className="border-b border-neutral-100 bg-neutral-950 px-5 py-5 text-white sm:px-6">
          <DialogHeader>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-yellow-400">
              Etapa {step === "details" ? "1" : "2"} de 2
            </p>
            <DialogTitle className="text-xl font-black sm:text-2xl">
              Solicitar saque de comissão
            </DialogTitle>
            <DialogDescription className="text-sm text-neutral-300">
              {step === "details"
                ? "Informe os dados que serão usados pelo setor financeiro."
                : "Revise cuidadosamente os dados antes de confirmar."}
            </DialogDescription>
          </DialogHeader>
        </div>

        {step === "details" ? (
          <form className="space-y-5 px-5 pb-5 sm:px-6 sm:pb-6" onSubmit={handleReview} noValidate>
            <div className="space-y-2">
              <Label htmlFor="withdrawal-amount">Valor solicitado</Label>
              <Input
                id="withdrawal-amount"
                value={formatCents(availableCents)}
                readOnly
                aria-readonly="true"
                aria-invalid={Boolean(errors.amount)}
                aria-describedby={errors.amount ? "withdrawal-amount-error" : undefined}
                className="h-11 bg-neutral-100 font-bold text-neutral-950"
              />
              {errors.amount && (
                <p
                  id="withdrawal-amount-error"
                  className="text-xs font-medium text-red-600"
                  role="alert"
                >
                  {errors.amount}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="withdrawal-bank">Nome do banco</Label>
              <Input
                id="withdrawal-bank"
                value={bankName}
                onChange={(event) => {
                  setBankName(event.target.value);
                  clearError("bankName");
                }}
                placeholder="Ex.: Banco do Brasil"
                autoComplete="organization"
                aria-invalid={Boolean(errors.bankName)}
                aria-describedby={errors.bankName ? "withdrawal-bank-error" : undefined}
                className="h-11"
              />
              {errors.bankName && (
                <p
                  id="withdrawal-bank-error"
                  className="text-xs font-medium text-red-600"
                  role="alert"
                >
                  {errors.bankName}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="withdrawal-holder">Nome completo do titular</Label>
              <Input
                id="withdrawal-holder"
                value={holderName}
                onChange={(event) => {
                  setHolderName(event.target.value);
                  clearError("holderName");
                }}
                placeholder="Nome do titular da chave Pix"
                autoComplete="name"
                aria-invalid={Boolean(errors.holderName)}
                aria-describedby={errors.holderName ? "withdrawal-holder-error" : undefined}
                className="h-11"
              />
              {errors.holderName && (
                <p
                  id="withdrawal-holder-error"
                  className="text-xs font-medium text-red-600"
                  role="alert"
                >
                  {errors.holderName}
                </p>
              )}
            </div>

            <div className="grid gap-5 sm:grid-cols-[0.8fr_1.2fr]">
              <div className="space-y-2">
                <Label htmlFor="withdrawal-pix-type">Tipo da chave Pix</Label>
                <Select value={pixKeyType} onValueChange={handlePixKeyTypeChange}>
                  <SelectTrigger id="withdrawal-pix-type" className="h-11">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {PIX_KEY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="withdrawal-pix-key">Chave Pix</Label>
                <Input
                  id="withdrawal-pix-key"
                  value={pixKey}
                  onChange={(event) => {
                    setPixKey(formatPixKey(pixKeyType, event.target.value));
                    clearError("pixKey");
                  }}
                  placeholder={PIX_KEY_PLACEHOLDERS[pixKeyType]}
                  inputMode={inputMode}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={Boolean(errors.pixKey)}
                  aria-describedby={errors.pixKey ? "withdrawal-pix-key-error" : undefined}
                  className="h-11"
                />
                {errors.pixKey && (
                  <p
                    id="withdrawal-pix-key-error"
                    className="text-xs font-medium text-red-600"
                    role="alert"
                  >
                    {errors.pixKey}
                  </p>
                )}
              </div>
            </div>

            <div
              className={`rounded-xl border p-4 ${
                errors.confirmation
                  ? "border-red-300 bg-red-50"
                  : "border-neutral-200 bg-neutral-50"
              }`}
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  id="withdrawal-confirmation"
                  checked={confirmed}
                  onCheckedChange={(checked) => {
                    setConfirmed(checked === true);
                    clearError("confirmation");
                  }}
                  aria-invalid={Boolean(errors.confirmation)}
                  aria-describedby={
                    errors.confirmation ? "withdrawal-confirmation-error" : undefined
                  }
                  className="mt-0.5"
                />
                <Label
                  htmlFor="withdrawal-confirmation"
                  className="cursor-pointer text-sm font-medium leading-relaxed text-neutral-700"
                >
                  Declaro que os dados informados estão corretos e que a chave Pix pertence ao
                  titular informado.
                </Label>
              </div>
              {errors.confirmation && (
                <p
                  id="withdrawal-confirmation-error"
                  className="mt-2 text-xs font-medium text-red-600"
                  role="alert"
                >
                  {errors.confirmation}
                </p>
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                className="bg-yellow-400 font-bold text-neutral-950 hover:bg-yellow-300"
              >
                Revisar solicitação
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form className="space-y-5 px-5 pb-5 sm:px-6 sm:pb-6" onSubmit={handleSubmit}>
            <div className="overflow-hidden rounded-xl border border-neutral-200">
              <dl className="divide-y divide-neutral-100">
                <SummaryRow
                  label="Valor solicitado"
                  value={formatCents(availableCents)}
                  highlight
                />
                <SummaryRow label="Banco" value={reviewData?.bankName ?? "—"} />
                <SummaryRow label="Titular" value={reviewData?.holderName ?? "—"} />
                <SummaryRow
                  label="Tipo da chave"
                  value={reviewData ? PIX_KEY_LABELS[reviewData.pixKeyType] : "—"}
                />
                <SummaryRow
                  label="Chave Pix"
                  value={reviewData ? maskPixKey(reviewData.pixKeyType, reviewData.pixKey) : "—"}
                  mono
                />
              </dl>
            </div>

            <div className="rounded-xl border border-yellow-300 bg-yellow-50 p-4 text-sm leading-relaxed text-neutral-700">
              <strong className="block text-neutral-950">Confira atentamente os dados.</strong>
              <p>
                O pagamento será realizado utilizando as informações cadastradas nesta solicitação e
                será analisado pelo setor financeiro. O saldo será reservado após a confirmação.
              </p>
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => setStep("details")}
              >
                Voltar
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || !reviewData}
                className="bg-yellow-400 font-bold text-neutral-950 hover:bg-yellow-300"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Enviando...
                  </>
                ) : (
                  "Confirmar solicitação"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface SummaryRowProps {
  label: string;
  value: string;
  highlight?: boolean;
  mono?: boolean;
}

function SummaryRow({ label, value, highlight = false, mono = false }: SummaryRowProps) {
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[0.9fr_1.1fr] sm:items-center">
      <dt className="text-xs font-bold uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd
        className={`break-all text-sm font-semibold sm:text-right ${
          highlight ? "text-lg font-black text-neutral-950" : "text-neutral-800"
        } ${mono ? "font-mono" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

export default WithdrawalRequestDialog;
