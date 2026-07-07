import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Settings, AlertTriangle, RotateCcw } from "lucide-react";

interface ModalConsultandoProps {
  open: boolean;
  /** Quando preenchido, troca o loader pela mensagem de erro com botão de retry. */
  erro?: string | null;
  onTentarNovamente?: () => void;
  onFechar?: () => void;
}

/**
 * Modal bloqueante exibido enquanto o worker local consulta a CredPago.
 * Não fecha com clique fora nem com ESC — o fluxo termina por Realtime/polling
 * (redirecionamento) ou pelo estado de erro.
 */
export function ModalConsultando({ open, erro, onTentarNovamente, onFechar }: ModalConsultandoProps) {
  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-md rounded-2xl border-neutral-200 p-10 [&>button]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {!erro ? (
          <div className="flex flex-col items-center text-center gap-5">
            <div className="relative flex items-center justify-center w-24 h-24 rounded-full bg-yellow-50 border border-yellow-100">
              <Settings
                className="w-12 h-12 text-yellow-500 animate-spin"
                strokeWidth={1.5}
                style={{ animationDuration: "2.5s" }}
              />
            </div>
            <DialogTitle className="text-2xl font-bold text-neutral-900 tracking-tight">
              Consultando crédito
            </DialogTitle>
            <DialogDescription className="text-base text-neutral-600 leading-relaxed">
              Estamos consultando a simulação aguarde...
            </DialogDescription>
            <div className="flex items-center gap-2 text-xs font-bold text-neutral-400 uppercase tracking-widest">
              <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
              Consultando crédito na NOX FINANÇA
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center gap-5">
            <div className="flex items-center justify-center w-24 h-24 rounded-full bg-red-50 border border-red-100">
              <AlertTriangle className="w-11 h-11 text-red-500" strokeWidth={1.5} />
            </div>
            <DialogTitle className="text-2xl font-bold text-neutral-900 tracking-tight">
              Não foi possível consultar
            </DialogTitle>
            <DialogDescription className="text-base text-neutral-600 leading-relaxed">
              {erro}
            </DialogDescription>
            <div className="flex flex-col sm:flex-row gap-3 w-full mt-2">
              {onTentarNovamente && (
                <Button
                  onClick={onTentarNovamente}
                  className="flex-1 bg-neutral-900 hover:bg-neutral-800 text-white font-bold h-12 rounded-xl"
                >
                  <RotateCcw className="w-4 h-4 mr-2" /> Tentar novamente
                </Button>
              )}
              {onFechar && (
                <Button
                  variant="outline"
                  onClick={onFechar}
                  className="flex-1 font-bold h-12 rounded-xl text-neutral-600"
                >
                  Fechar
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
