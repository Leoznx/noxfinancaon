import { useEffect, useState } from "react";
import { LoaderCircle, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { SellerAppointment } from "@/lib/seller-agenda";

export function MeetingFeedbackDialog({
  item,
  onClose,
  onSubmit,
}: {
  item: SellerAppointment | null;
  onClose: () => void;
  onSubmit: (feedback: string) => Promise<void>;
}) {
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFeedback(item?.meeting_feedback ?? "");
  }, [item]);

  if (!item) return null;
  const valid = feedback.trim().length >= 10;

  async function submit() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await onSubmit(feedback.trim());
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="mb-2 grid h-11 w-11 place-items-center rounded-2xl bg-yellow-100 text-yellow-800"><MessageSquareText className="h-5 w-5" /></div>
          <DialogTitle className="text-xl font-black">Feedback obrigatório da reunião</DialogTitle>
        </DialogHeader>
        <div>
          <p className="mb-3 text-sm text-neutral-600">
            Registre o resultado de “{item.title}”, as dúvidas do cliente e o próximo passo combinado.
            Ao concluir, os follow-ups serão distribuídos automaticamente para Closer e SDR.
          </p>
          <Textarea
            autoFocus
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="Ex.: Cliente interessado, vai concluir o cadastro hoje e pediu retorno sobre integração..."
            className="min-h-32 resize-y"
            maxLength={2000}
          />
          <p className={`mt-1 text-right text-[11px] font-semibold ${valid ? "text-emerald-700" : "text-neutral-400"}`}>
            {feedback.trim().length}/2000 · mínimo 10 caracteres
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Voltar</Button>
          <Button type="button" className="bg-neutral-950 text-white hover:bg-neutral-800" onClick={() => void submit()} disabled={!valid || saving}>
            {saving && <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" />} Salvar feedback e concluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
