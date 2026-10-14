import { motion } from "framer-motion";
import { CalendarClock, Check, Mail, MessageCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";

export type AutomatedSuccessKind = "pay_later" | "card_checkout";

interface ModalEnvioAutomatizadoSucessoProps {
  open: boolean;
  kind: AutomatedSuccessKind | null;
  paymentMethodLabel: string;
  contractPeriodLabel: string;
  emailMasked?: string | null;
  phoneMasked?: string | null;
  onClose: () => void;
  onViewDetails: () => void;
}

const CONFETTI = [
  { x: -52, y: -34, color: "#FACC15", rotate: -24 },
  { x: -35, y: -58, color: "#22C55E", rotate: 18 },
  { x: -8, y: -66, color: "#111827", rotate: 52 },
  { x: 26, y: -62, color: "#EAB308", rotate: -42 },
  { x: 50, y: -38, color: "#10B981", rotate: 36 },
  { x: 58, y: -4, color: "#FACC15", rotate: 78 },
  { x: -58, y: -3, color: "#0F172A", rotate: -72 },
];

export function ModalEnvioAutomatizadoSucesso({
  open,
  kind,
  paymentMethodLabel,
  contractPeriodLabel,
  emailMasked,
  phoneMasked,
  onClose,
  onViewDetails,
}: ModalEnvioAutomatizadoSucessoProps) {
  if (!kind) return null;

  const isCardCheckout = kind === "card_checkout";

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-md overflow-hidden rounded-3xl border-0 p-0 shadow-2xl">
        <div className="relative bg-gradient-to-b from-emerald-50 via-white to-white px-6 pb-6 pt-8 text-center">
          <div className="relative mx-auto mb-5 h-20 w-20">
            {CONFETTI.map((particle, index) => (
              <motion.span
                key={`${particle.x}-${particle.y}`}
                className="absolute left-1/2 top-1/2 h-2.5 w-1.5 rounded-full"
                style={{ backgroundColor: particle.color }}
                initial={{ x: -3, y: -3, opacity: 0, scale: 0.4 }}
                animate={{
                  x: particle.x,
                  y: particle.y,
                  opacity: [0, 1, 1, 0],
                  scale: [0.4, 1, 1, 0.8],
                  rotate: particle.rotate,
                }}
                transition={{ duration: 1.15, delay: 0.12 + index * 0.035, ease: "easeOut" }}
              />
            ))}
            <motion.div
              initial={{ scale: 0.45, rotate: -18, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ type: "spring", stiffness: 230, damping: 15 }}
              className="absolute inset-0 flex items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-200"
            >
              <Check className="h-9 w-9" strokeWidth={3} />
            </motion.div>
          </div>

          <div className="mb-2 flex items-center justify-center gap-2 text-emerald-700">
            <Sparkles className="h-4 w-4" />
            <span className="text-xs font-black uppercase tracking-[0.2em]">Tudo certo</span>
            <Sparkles className="h-4 w-4" />
          </div>
          <DialogTitle className="text-2xl font-black text-neutral-950">
            Verifique seu WhatsApp
          </DialogTitle>
          <DialogDescription className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-600">
            {isCardCheckout
              ? "O link seguro do Asaas foi enviado ao inquilino. Depois da confirmação do pagamento e da recorrência, o contrato seguirá automaticamente para assinatura na D4Sign."
              : "A cobrança ficou disponível para pagamento posterior e o contrato seguirá automaticamente para assinatura com os dados da proposta."}
          </DialogDescription>

          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.28, duration: 0.35 }}
            className="mt-6 space-y-3 rounded-2xl border border-emerald-100 bg-white p-4 text-left shadow-sm"
          >
            <div className="flex items-center gap-3">
              <MessageCircle className="h-5 w-5 shrink-0 text-emerald-600" />
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">WhatsApp</p>
                <p className="truncate text-sm font-semibold text-neutral-900">
                  {phoneMasked || "Envio solicitado para o contato do inquilino"}
                </p>
              </div>
            </div>
            {emailMasked && (
              <div className="flex items-center gap-3">
                <Mail className="h-5 w-5 shrink-0 text-emerald-600" />
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">E-mail</p>
                  <p className="truncate text-sm font-semibold text-neutral-900">{emailMasked}</p>
                </div>
              </div>
            )}
            <div className="flex items-center gap-3">
              <CalendarClock className="h-5 w-5 shrink-0 text-emerald-600" />
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                  Contratação
                </p>
                <p className="text-sm font-semibold text-neutral-900">
                  {paymentMethodLabel} · {contractPeriodLabel}
                </p>
              </div>
            </div>
          </motion.div>
        </div>

        <DialogFooter className="gap-2 border-t border-slate-100 bg-white px-6 py-4 sm:gap-2">
          <Button type="button" variant="outline" onClick={onViewDetails}>
            Ver detalhes
          </Button>
          <Button
            type="button"
            className="bg-yellow-400 font-bold text-neutral-950 hover:bg-yellow-300"
            onClick={onClose}
          >
            Concluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
