import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { STATUS_ATIVOS_APOLICE, formatMoney } from "@/lib/vendedor-portal";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  leadId: string | null;
  sellerInternalId: string | null;
  onSuccess: () => void;
}

export function FecharLeadModal({ open, onOpenChange, leadId, sellerInternalId, onSuccess }: Props) {
  const [apolices, setApolices] = useState<any[]>([]);
  const [apoliceId, setApoliceId] = useState("");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [paga, setPaga] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingApolices, setLoadingApolices] = useState(false);

  useEffect(() => {
    if (!open) return;

    (async () => {
      setLoadingApolices(true);
      const { data, error } = await supabase
        .from("apolices")
        .select("id, numero, valor_premio, status")
        .in("status", [...STATUS_ATIVOS_APOLICE])
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) toast.error(error.message);
      setApolices((data as any[]) ?? []);
      setLoadingApolices(false);
    })();
  }, [open]);

  const submit = async () => {
    if (!leadId || !sellerInternalId || !apoliceId) {
      toast.error("Selecione uma apólice para vincular ao fechamento.");
      return;
    }

    setLoading(true);
    const now = new Date();
    const status = paga ? "elegivel" : "aguardando_primeira_parcela";

    const { error: leadError } = await supabase
      .from("sales_leads" as any)
      .update({
        status: "convertido",
        converted_consulta_id: null,
        notes: `Fechado em ${data}. Valor mensal: R$ ${valor || "não informado"}.`,
        last_interaction_at: now.toISOString(),
        next_action_at: null,
      })
      .eq("id", leadId);

    const { error: commissionError } = await supabase.from("seller_commissions" as any).insert({
      seller_id: sellerInternalId,
      contract_id: apoliceId,
      apolice_id: apoliceId,
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      commission_amount: 0,
      bonus_amount: 0,
      reserve_amount: 0,
      released_amount: 0,
      status,
      eligible_at: paga ? now.toISOString() : null,
    });

    setLoading(false);

    if (leadError || commissionError) {
      toast.error(leadError?.message || commissionError?.message || "Não foi possível fechar o lead.");
      return;
    }

    toast.success("Lead fechado e comissão vinculada.");
    onSuccess();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Fechar lead como contrato</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Contrato/apólice vinculado</Label>
            <Select value={apoliceId} onValueChange={setApoliceId}>
              <SelectTrigger><SelectValue placeholder={loadingApolices ? "Carregando..." : "Selecione..."} /></SelectTrigger>
              <SelectContent>
                {apolices.map((apolice) => (
                  <SelectItem key={apolice.id} value={apolice.id}>
                    {apolice.numero ?? apolice.id} - {formatMoney(apolice.valor_premio)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!loadingApolices && apolices.length === 0 && (
              <p className="mt-2 text-xs text-neutral-500">Nenhuma apólice ativa encontrada para vínculo.</p>
            )}
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
            <Checkbox id="paga" checked={paga} onCheckedChange={(value) => setPaga(value === true)} />
            <Label htmlFor="paga" className="cursor-pointer">Primeira parcela já paga</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={loading || loadingApolices || apolices.length === 0}>
            {loading ? "Salvando..." : "Confirmar fechamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
