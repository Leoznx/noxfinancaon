import { useEffect, useState, type FormEvent } from "react";
import { Landmark, ShieldCheck, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { inferDemoPixKeyType } from "@/lib/demo-withdrawal";
import { formatCents, type UserWithdrawal } from "@/lib/withdrawals";

export interface DemoWithdrawalData {
  bankName: string;
  holderName: string;
  pixKey: string;
  pixKeyType: UserWithdrawal["pix_key_type"];
}

interface DemoWithdrawalRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableCents: number;
  onSuccess: (data: DemoWithdrawalData) => void;
}

type Field = "bankName" | "holderName" | "pixKey";

const emptyErrors: Record<Field, string> = {
  bankName: "",
  holderName: "",
  pixKey: "",
};

export function DemoWithdrawalRequestDialog({
  open,
  onOpenChange,
  availableCents,
  onSuccess,
}: DemoWithdrawalRequestDialogProps) {
  const [bankName, setBankName] = useState("");
  const [holderName, setHolderName] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [errors, setErrors] = useState(emptyErrors);

  useEffect(() => {
    if (!open) {
      setBankName("");
      setHolderName("");
      setPixKey("");
      setErrors(emptyErrors);
    }
  }, [open]);

  const clearError = (field: Field) => setErrors((current) => ({ ...current, [field]: "" }));

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = {
      bankName: bankName.trim() ? "" : "Informe o banco.",
      holderName: holderName.trim() ? "" : "Informe o titular da conta.",
      pixKey: pixKey.trim() ? "" : "Informe a chave Pix.",
    };
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

    onSuccess({
      bankName: bankName.trim(),
      holderName: holderName.trim(),
      pixKey: pixKey.trim(),
      pixKeyType: inferDemoPixKeyType(pixKey),
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-neutral-100 bg-neutral-50 px-6 py-5 pr-12">
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-yellow-400 text-neutral-950">
            <Wallet className="h-5 w-5" />
          </div>
          <DialogTitle>Simular saque</DialogTitle>
          <DialogDescription>
            Preencha somente os dados de destino. Nenhum saque ou Pix real será criado.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-5 px-6 pb-6" onSubmit={handleSubmit}>
          <div className="flex items-center justify-between rounded-xl border border-yellow-200 bg-yellow-50 p-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-yellow-800">
                Saldo da simulação
              </p>
              <p className="mt-1 text-2xl font-black text-neutral-950">
                {formatCents(availableCents)}
              </p>
            </div>
            <ShieldCheck className="h-7 w-7 text-yellow-700" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="demo-withdrawal-bank">Banco</Label>
            <Input
              id="demo-withdrawal-bank"
              value={bankName}
              onChange={(event) => {
                setBankName(event.target.value);
                clearError("bankName");
              }}
              placeholder="Ex.: Banco do Brasil"
              autoComplete="organization"
              aria-invalid={Boolean(errors.bankName)}
              className="h-11"
            />
            {errors.bankName && (
              <p className="text-xs font-medium text-red-600">{errors.bankName}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="demo-withdrawal-holder">Titular da conta</Label>
            <Input
              id="demo-withdrawal-holder"
              value={holderName}
              onChange={(event) => {
                setHolderName(event.target.value);
                clearError("holderName");
              }}
              placeholder="Nome completo do titular"
              autoComplete="name"
              aria-invalid={Boolean(errors.holderName)}
              className="h-11"
            />
            {errors.holderName && (
              <p className="text-xs font-medium text-red-600">{errors.holderName}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="demo-withdrawal-pix">Chave Pix</Label>
            <Input
              id="demo-withdrawal-pix"
              value={pixKey}
              onChange={(event) => {
                setPixKey(event.target.value);
                clearError("pixKey");
              }}
              placeholder="CPF, CNPJ, e-mail, telefone ou chave aleatória"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={Boolean(errors.pixKey)}
              className="h-11"
            />
            {errors.pixKey && <p className="text-xs font-medium text-red-600">{errors.pixKey}</p>}
          </div>

          <p className="flex items-start gap-2 rounded-xl bg-neutral-100 p-3 text-xs leading-relaxed text-neutral-600">
            <Landmark className="mt-0.5 h-4 w-4 shrink-0" />
            Esta ação aparece apenas nas contas de demonstração e fica somente nesta tela.
          </p>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              className="bg-yellow-400 font-bold text-neutral-950 hover:bg-yellow-300"
            >
              Confirmar simulação
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default DemoWithdrawalRequestDialog;
