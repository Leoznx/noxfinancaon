import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Bell,
  DollarSign,
  CheckCircle,
  Wallet,
  Trophy,
  FileCheck,
  FileX,
  Megaphone,
  Sparkles,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthProvider";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

type Notificacao = {
  id: string;
  tipo: string;
  titulo: string;
  mensagem: string;
  link?: string | null;
  cor_destaque?: string | null;
  lida: boolean;
  created_at: string;
};

const ICONES_NOTIFICACAO: Record<string, LucideIcon> = {
  comissao_nova: DollarSign,
  comissao_liberada: CheckCircle,
  saque_solicitado: DollarSign,
  saque_aprovado: Wallet,
  saque_recusado: FileX,
  saque_pago: CheckCircle,
  saque_revisao: AlertTriangle,
  nivel_subiu: Trophy,
  contrato_aprovado: FileCheck,
  contrato_reprovado: FileX,
  sistema: Megaphone,
  atualizacao: Sparkles,
};

const CORES_NOTIFICACAO: Record<string, { fundo: string; icone: string }> = {
  verde: { fundo: "bg-green-100", icone: "text-green-700" },
  amarelo: { fundo: "bg-yellow-100", icone: "text-yellow-700" },
  azul: { fundo: "bg-blue-100", icone: "text-blue-700" },
  vermelho: { fundo: "bg-red-100", icone: "text-red-700" },
  cinza: { fundo: "bg-neutral-100", icone: "text-neutral-700" },
};

export function SinoNotificacoes() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [aberto, setAberto] = useState(false);
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([]);
  const [carregando, setCarregando] = useState(true);

  const naoLidas = notificacoes.filter((notificacao) => !notificacao.lida).length;

  const carregarNotificacoes = useCallback(async () => {
    if (!user) return;

    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    if (!authUser) return;

    const { data } = await supabase
      .from("notificacoes")
      .select("*")
      .eq("user_id", authUser.id)
      .order("created_at", { ascending: false })
      .limit(10);

    setNotificacoes((data || []) as Notificacao[]);
    setCarregando(false);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      if (!authUser) return;

      await carregarNotificacoes();

      channel = supabase
        .channel(`notificacoes-realtime-${authUser.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notificacoes",
            filter: `user_id=eq.${authUser.id}`,
          },
          (payload) => {
            const notificacao = payload.new as Notificacao;
            setNotificacoes((prev) => [notificacao, ...prev]);
            toast(notificacao.titulo, {
              description: notificacao.mensagem,
            });
          },
        )
        .subscribe();
    })();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [carregarNotificacoes, user]);

  async function marcarComoLidas() {
    if (!user) return;
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    if (!authUser) return;

    await supabase
      .from("notificacoes")
      .update({ lida: true, lida_em: new Date().toISOString() })
      .eq("user_id", authUser.id)
      .eq("lida", false);

    setNotificacoes((prev) => prev.map((n) => ({ ...n, lida: true })));
  }

  async function marcarUmaComoLida(id: string) {
    setNotificacoes((prev) => prev.map((n) => (n.id === id ? { ...n, lida: true } : n)));
    await supabase
      .from("notificacoes")
      .update({ lida: true, lida_em: new Date().toISOString() })
      .eq("id", id);
  }

  function formatarTempoRelativo(timestamp: string) {
    const agora = Date.now();
    const data = new Date(timestamp).getTime();
    const segundos = Math.floor((agora - data) / 1000);

    if (segundos < 60) return "Agora mesmo";
    if (segundos < 3600) return `Há ${Math.floor(segundos / 60)} min`;
    if (segundos < 86400) return `Há ${Math.floor(segundos / 3600)} h`;
    if (segundos < 604800) return `Há ${Math.floor(segundos / 86400)} dias`;
    return new Date(timestamp).toLocaleDateString("pt-BR");
  }

  return (
    <div className="relative">
      <button
        onClick={() => {
          setAberto(!aberto);
          if (naoLidas > 0 && !aberto) {
            setTimeout(marcarComoLidas, 2000);
          }
        }}
        className="relative p-2 hover:bg-neutral-100 rounded-lg transition-colors group"
      >
        <Bell
          className={`w-5 h-5 text-neutral-700 ${naoLidas > 0 ? "animate-shake" : ""}`}
          strokeWidth={1.5}
        />
        {naoLidas > 0 && (
          <span className="absolute top-1.5 right-1.5 min-w-[16px] h-[16px] px-1 bg-yellow-400 text-neutral-900 text-[9px] font-black rounded-full flex items-center justify-center border-2 border-white">
            {naoLidas > 9 ? "9+" : naoLidas}
          </span>
        )}
      </button>

      {aberto && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAberto(false)}></div>

          <div className="absolute top-full right-0 mt-3 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-neutral-100 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="px-5 py-4 border-b border-neutral-50 flex items-center justify-between bg-white">
              <div>
                <h3 className="font-bold text-neutral-900">Notificações</h3>
                {naoLidas > 0 && (
                  <p className="text-[10px] text-yellow-600 font-bold uppercase tracking-widest mt-0.5">
                    {naoLidas} novas mensagens
                  </p>
                )}
              </div>
              <button
                onClick={() => setAberto(false)}
                className="p-1 hover:bg-neutral-50 rounded-full text-neutral-400"
              >
                <X size={16} />
              </button>
            </div>

            <div className="max-h-[400px] overflow-y-auto">
              {carregando ? (
                <div className="p-10 text-center">
                  <div className="w-6 h-6 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
                </div>
              ) : notificacoes.length === 0 ? (
                <div className="text-center py-12 px-6">
                  <div className="w-12 h-12 bg-neutral-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Bell className="w-6 h-6 text-neutral-300" strokeWidth={1.5} />
                  </div>
                  <p className="text-sm font-bold text-neutral-900">Tudo limpo por aqui</p>
                  <p className="text-xs text-neutral-500 mt-1">
                    Você será avisado quando houver novidades na plataforma.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-neutral-50">
                  {notificacoes.map((notif) => {
                    const cor = CORES_NOTIFICACAO[notif.cor_destaque || "cinza"];
                    const Icone = ICONES_NOTIFICACAO[notif.tipo] || Bell;

                    return (
                      <button
                        key={notif.id}
                        onClick={() => {
                          if (!notif.lida) marcarUmaComoLida(notif.id);
                          if (notif.link) navigate({ to: notif.link as never });
                          setAberto(false);
                        }}
                        className={`w-full text-left px-5 py-4 hover:bg-neutral-50 transition-colors flex gap-4 ${
                          !notif.lida ? "bg-yellow-50/30" : ""
                        }`}
                      >
                        <div
                          className={`flex-shrink-0 ${cor.fundo} rounded-xl p-2.5 h-fit shadow-sm`}
                        >
                          <Icone className={`w-4 h-4 ${cor.icone}`} strokeWidth={2.5} />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-bold text-neutral-900 leading-tight">
                              {notif.titulo}
                            </p>
                            {!notif.lida && (
                              <span className="flex-shrink-0 w-2 h-2 bg-yellow-400 rounded-full mt-1.5"></span>
                            )}
                          </div>
                          <p className="text-xs text-neutral-500 mt-1 line-clamp-2 font-medium">
                            {notif.mensagem}
                          </p>
                          <p className="text-[10px] text-neutral-400 mt-2 font-bold uppercase tracking-wider">
                            {formatarTempoRelativo(notif.created_at)}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {notificacoes.length > 0 && (
              <div className="border-t border-neutral-50 p-3 bg-neutral-50/30">
                <Link
                  to="/painel/notificacoes"
                  className="block text-center text-xs font-bold text-neutral-600 hover:text-neutral-900 py-2.5 rounded-lg hover:bg-white transition-all border border-transparent hover:border-neutral-100 uppercase tracking-widest"
                  onClick={() => setAberto(false)}
                >
                  Ver todas as notificações
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
