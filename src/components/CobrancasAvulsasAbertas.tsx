import { useCallback, useEffect, useState } from "react";
import {
  Clock,
  Copy,
  ExternalLink,
  FileText,
  Mail,
  MessageCircle,
  QrCode,
  RefreshCw,
  RotateCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { statusPagamentoLabel } from "@/lib/asaas-payment";
import { useAuth } from "@/components/AuthProvider";
import {
  loadCobrancasAvulsas,
  peekCobrancasAvulsas,
  type CobrancaAvulsa,
} from "@/lib/cobrancas-avulsas-data";
import { managePersistedAsaasPayment } from "@/lib/asaas-checkout";
import { toast } from "sonner";

/**
 * Cobranças de contratação (Pix/boleto/cartão) que ainda estão em aberto e não
 * viraram parcela em `faturas_inquilino` — é aqui que cai o valor quando o
 * usuário escolhe "pagar depois". O fluxo documental continua e a ativação
 * permanece condicionada aos requisitos contratuais e financeiros.
 */
export function CobrancasAvulsasAbertas() {
  const { user } = useAuth();
  const userId = user?.id;
  const userEmail = user?.email;
  const userRole = user?.role;
  const cached = userId ? peekCobrancasAvulsas(userId) : undefined;
  const [itens, setItens] = useState<CobrancaAvulsa[]>(() => cached ?? []);
  const [carregando, setCarregando] = useState(cached === undefined);
  const [atualizandoId, setAtualizandoId] = useState<string | null>(null);
  const [acaoId, setAcaoId] = useState<string | null>(null);

  const carregar = useCallback(
    async (force = true) => {
      if (!userId || !userEmail || !userRole) return;
      try {
        setItens(
          await loadCobrancasAvulsas({ id: userId, email: userEmail, role: userRole }, force),
        );
      } finally {
        setCarregando(false);
      }
    },
    [userId, userEmail, userRole],
  );

  useEffect(() => {
    void carregar(false).catch((error) => {
      // A carteira principal continua utilizável mesmo se este bloco auxiliar
      // estiver temporariamente indisponível; evita dois alertas para a mesma falha.
      console.warn("[CobrancasAvulsas] atualização indisponível", error);
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const canal = supabase
      .channel("cobrancas-avulsas-abertas")
      .on("postgres_changes", { event: "*", schema: "public", table: "asaas_payments" }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          void carregar().catch(() => undefined);
        }, 350);
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(canal);
    };
  }, [carregar]);

  async function atualizarStatus(item: CobrancaAvulsa) {
    if (!item.asaas_payment_id) return;
    setAtualizandoId(item.id);
    try {
      const data = await managePersistedAsaasPayment({
        paymentId: item.asaas_payment_id,
        consultationId: item.consultation_id,
        action: "refresh",
      });
      toast.success(statusPagamentoLabel(data.paymentStatus || data.status));
      await carregar();
    } catch (error: any) {
      toast.error(error?.message || "Não foi possível atualizar o status agora.");
    } finally {
      setAtualizandoId(null);
    }
  }

  async function executarAcao(
    item: CobrancaAvulsa,
    action: "resend_email" | "resend_whatsapp" | "reissue",
  ) {
    if (!item.asaas_payment_id) return;
    const key = `${item.id}:${action}`;
    setAcaoId(key);
    try {
      await managePersistedAsaasPayment({
        paymentId: item.asaas_payment_id,
        consultationId: item.consultation_id,
        action,
        paymentMethod:
          item.payment_method === "pix" || item.payment_method === "boleto"
            ? item.payment_method
            : undefined,
      });
      toast.success(
        action === "resend_email"
          ? "Cobrança reenviada por e-mail."
          : action === "resend_whatsapp"
            ? "Cobrança reenviada por WhatsApp."
            : "Segunda via gerada.",
      );
      await carregar();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível concluir a ação.");
    } finally {
      setAcaoId(null);
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
            A assinatura pode continuar; a cobertura só é ativada quando todos os requisitos forem
            cumpridos.
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
              <p className="mt-1 text-[11px] text-neutral-500">
                {item.payment_method === "pix"
                  ? "Pix"
                  : item.payment_method === "boleto"
                    ? "Boleto"
                    : "Cartão"}
                {" · "}
                {item.payment_responsible === "agency" ? "Imobiliária" : "Inquilino"}
                {item.asaas_payment_id ? ` · Asaas ${item.asaas_payment_id}` : ""}
              </p>
              {(item.confirmed_at || item.received_at) && (
                <p className="text-[11px] text-emerald-700">
                  Confirmado em{" "}
                  {new Date(item.received_at || item.confirmed_at || "").toLocaleString("pt-BR")}
                </p>
              )}
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
            {(item.payment_url || item.invoice_url) && (
              <a
                href={item.payment_url || item.invoice_url || "#"}
                target="_blank"
                rel="noreferrer"
              >
                <Button size="sm" variant="outline" className="h-8 gap-1 text-xs">
                  <ExternalLink className="h-3 w-3" /> Abrir cobrança
                </Button>
              </a>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1 text-xs"
              disabled={acaoId !== null || !item.asaas_payment_id}
              onClick={() => void executarAcao(item, "resend_whatsapp")}
            >
              <MessageCircle className="h-3 w-3" /> WhatsApp
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1 text-xs"
              disabled={acaoId !== null || !item.asaas_payment_id}
              onClick={() => void executarAcao(item, "resend_email")}
            >
              <Mail className="h-3 w-3" /> E-mail
            </Button>
            {(item.payment_method === "pix" || item.payment_method === "boleto") && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1 text-xs"
                disabled={acaoId !== null || !item.asaas_payment_id}
                onClick={() => void executarAcao(item, "reissue")}
              >
                <RotateCw className="h-3 w-3" /> Segunda via
              </Button>
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
