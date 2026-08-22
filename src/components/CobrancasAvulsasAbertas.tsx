import { useCallback, useEffect, useState } from "react";
import { Clock, Copy, FileText, QrCode, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { isPagamentoConcluido, statusPagamentoLabel } from "@/lib/asaas-payment";
import { toast } from "sonner";

type CobrancaAvulsa = {
  id: string;
  consultation_id: string | null;
  asaas_payment_id: string | null;
  payment_method: string | null;
  status: string | null;
  value: number | null;
  due_date: string | null;
  pix_copy_paste: string | null;
  boleto_url: string | null;
  boleto_barcode: string | null;
  consulta?: { tenant_name: string | null } | null;
};

/**
 * Cobranças de contratação (Pix/boleto/cartão) que ainda estão em aberto e não
 * viraram parcela em `faturas_inquilino` — é aqui que cai o valor quando o
 * usuário escolhe "pagar depois". Enquanto não houver baixa, a proposta não
 * segue para assinatura.
 */
export function CobrancasAvulsasAbertas() {
  const [itens, setItens] = useState<CobrancaAvulsa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [atualizandoId, setAtualizandoId] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const [pagamentosRes, faturasRes] = await Promise.all([
      (supabase as any)
        .from("asaas_payments")
        .select(
          "id, consultation_id, asaas_payment_id, payment_method, status, value, due_date, pix_copy_paste, boleto_url, boleto_barcode, consulta:consultas_credito(tenant_name)",
        )
        .order("created_at", { ascending: false }),
      supabase.from("faturas_inquilino").select("asaas_payment_id"),
    ]);

    const jaEhParcela = new Set(
      ((faturasRes.data as any[]) ?? [])
        .map((fatura) => fatura.asaas_payment_id)
        .filter(Boolean),
    );

    const abertas = (((pagamentosRes.data as CobrancaAvulsa[]) ?? []) as CobrancaAvulsa[]).filter(
      (pagamento) => !isPagamentoConcluido(pagamento.status) && !jaEhParcela.has(pagamento.id),
    );
    setItens(abertas);
    setCarregando(false);
  }, []);

  useEffect(() => {
    void carregar();
    const canal = supabase
      .channel("cobrancas-avulsas-abertas")
      .on("postgres_changes", { event: "*", schema: "public", table: "asaas_payments" }, () => {
        void carregar();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
  }, [carregar]);

  async function atualizarStatus(item: CobrancaAvulsa) {
    if (!item.asaas_payment_id) return;
    setAtualizandoId(item.id);
    try {
      const { data, error } = await supabase.functions.invoke("asaas-get-payment", {
        body: { paymentId: item.asaas_payment_id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(statusPagamentoLabel((data as any)?.status));
      await carregar();
    } catch (error: any) {
      toast.error(error?.message || "Não foi possível atualizar o status agora.");
    } finally {
      setAtualizandoId(null);
    }
  }

  async function copiar(texto: string, mensagem: string) {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success(mensagem);
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }

  if (carregando || !itens.length) return null;

  const fmt = (valor: number | null) =>
    Number(valor ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <section className="rounded-2xl border border-amber-300 bg-amber-50/60 p-5">
      <div className="mb-4 flex items-center gap-2">
        <Clock size={18} className="text-amber-700" />
        <div>
          <h2 className="text-sm font-black uppercase tracking-widest text-amber-800">
            Faturas em aberto da contratação
          </h2>
          <p className="text-xs text-amber-900/80">
            A proposta só é enviada para assinatura depois que o pagamento for identificado.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {itens.map((item) => (
          <div
            key={item.id}
            className="rounded-xl border border-amber-200 bg-white p-3 flex flex-wrap items-center gap-3"
          >
            <div className="min-w-[180px] flex-1">
              <p className="text-sm font-bold text-neutral-900">
                {item.consulta?.tenant_name || "Contratação NOX Fiança"}
              </p>
              <p className="text-xs text-neutral-500">
                {fmt(item.value)}
                {item.due_date
                  ? ` · vence em ${new Date(`${item.due_date}T00:00:00`).toLocaleDateString("pt-BR")}`
                  : ""}
              </p>
            </div>
            <Badge variant="outline" className="text-xs">
              {statusPagamentoLabel(item.status)}
            </Badge>
            {item.pix_copy_paste && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1 text-xs"
                onClick={() => copiar(item.pix_copy_paste!, "Código Pix copiado.")}
              >
                <QrCode className="h-3 w-3" /> Copiar Pix
              </Button>
            )}
            {item.boleto_barcode && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1 text-xs"
                onClick={() => copiar(item.boleto_barcode!, "Linha digitável copiada.")}
              >
                <Copy className="h-3 w-3" /> Linha digitável
              </Button>
            )}
            {item.boleto_url && (
              <a href={item.boleto_url} target="_blank" rel="noreferrer">
                <Button size="sm" variant="outline" className="h-8 gap-1 text-xs">
                  <FileText className="h-3 w-3" /> Ver boleto
                </Button>
              </a>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1 text-xs"
              disabled={atualizandoId === item.id || !item.asaas_payment_id}
              onClick={() => atualizarStatus(item)}
            >
              <RefreshCw className={`h-3 w-3 ${atualizandoId === item.id ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
