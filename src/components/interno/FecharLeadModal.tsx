import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  leadId: string | null;
  sellerInternalId: string | null;
  onSuccess: () => void;
}

export function FecharLeadModal({ open, onOpenChange, leadId, sellerInternalId, onSuccess }: Props) {
  const [apolices, setApolices] = useState<any[]>([]);
  const [apoliceId, setApoliceId] = useState<string>("");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [paga, setPaga] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase.from("apolices").select("id, numero, valor_premio").eq("status", "ativa").limit(50);
      setApolices(data ?? []);
    })();
  }, [open]);

  const submit = async () => {
    if (!leadId || !sellerInternalId || !apoliceId) {
      toast.error("Preencha contrato vinculado");
      return;
    }
    setLoading(true);
    const now = new Date();
    const { error: e1 } = await supabase.from("sales_leads").update({
      status: "convertido",
      notes: `Fechado em ${data}. Valor mensal: R$ ${valor}.`,
    }).eq("id", leadId);

    const { error: e2 } = await supabase.from("seller_commissions" as any).insert({
      seller_id: sellerInternalId,
      contract_id: apoliceId,
      apolice_id: apoliceId,
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      commission_amount: 0,
      bonus_amount: 0,
      status: paga ? "elegivel" : "aguardando_primeira_parcela",
      eligible_at: paga ? now.toISOString() : null,
    });

    setLoading(false);
    if (e1 || e2) { toast.error((e1 ?? e2)?.message ?? "Erro ao fechar"); return; }
    toast.success("Lead fechado e comissão vinculada");
    onSuccess();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Fechar lead como contrato</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Contrato (apólice) vinculado</Label>
            <Select value={apoliceId} onValueChange={setApoliceId}>
              <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>
                {apolices.map((a) => <SelectItem key={a.id} value={a.id}>{a.numero} — R$ {a.valor_premio}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Valor mensal (R$)</Label>
            <Input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="350,00" />
          </div>
          <div>
            <Label>Data do fechamento</Label>
            <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="paga" checked={paga} onCheckedChange={(v) => setPaga(v === true)} />
            <Label htmlFor="paga" className="cursor-pointer">Primeira parcela já paga</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={loading}>{loading ? "Salvando…" : "Confirmar fechamento"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
