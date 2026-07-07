import { createFileRoute, Link } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FileText, ArrowRight, AlertCircle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/apolices/")({
  component: () => (
    <ProtectedRoute>
      <ErrorBoundary nome="apólices">
        <ApolicesList />
      </ErrorBoundary>
    </ProtectedRoute>
  ),
});

function ApolicesList() {
  const { user } = useAuth();
  const [apolices, setApolices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!user?.email) return;
      setLoading(true);
      setErro(null);
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, role")
          .eq("email", user.email)
          .maybeSingle();

        const pid = profile?.id;
        const role = profile?.role || user.role;

        let query = supabase
          .from("apolices")
          .select(`
            id, numero, status, vigencia_inicio, vigencia_fim, valor_premio,
            consulta:consultas_credito(
              inquilino:inquilinos(nome, cpf),
              imovel:imoveis(endereco, cidade, estado),
              plano:planos(nome)
            ),
            imobiliaria:profiles!apolices_imobiliaria_profile_id_fkey(nome),
            corretor:profiles!apolices_corretor_profile_id_fkey(nome)
          `)
          .order("created_at", { ascending: false });

        if (pid) {
          if (role === "corretor") query = query.eq("corretor_profile_id", pid);
          else if (role === "imobiliaria") query = query.eq("imobiliaria_profile_id", pid);
          else if (role === "proprietario") query = query.eq("proprietario_profile_id", pid);
        }

        const { data, error } = await query;
        if (error) throw error;
        if (!cancelled) setApolices(data || []);
      } catch (e: any) {
        if (!cancelled) setErro(e.message || "Erro ao carregar apólices");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [user?.email]);

  const filtradas = apolices.filter((a) => {
    const q = busca.toLowerCase();
    return (
      !q ||
      a.numero?.toLowerCase().includes(q) ||
      a.consulta?.inquilino?.nome?.toLowerCase().includes(q) ||
      a.imobiliaria?.nome?.toLowerCase().includes(q)
    );
  });

  const formatBRL = (v: number) =>
    (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const formatDate = (d: string) =>
    d ? new Date(d).toLocaleDateString("pt-BR") : "—";

  return (
    <DashboardLayout>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">Contratos Ativos</h1>
          <p className="text-neutral-500 mt-1 font-medium">
            Acompanhe cada apólice, seus documentos e o histórico financeiro.
          </p>
        </div>
        <div className="relative w-full md:w-80">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
          <Input
            placeholder="Buscar por nº, inquilino ou imobiliária"
            className="pl-12 h-12 bg-white border-neutral-200 rounded-xl"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </div>

      {erro && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 mb-6 flex items-start gap-3">
          <AlertCircle className="text-red-600 mt-0.5" />
          <div>
            <p className="font-bold text-red-900">Não foi possível carregar as informações.</p>
            <p className="text-sm text-red-700">{erro}</p>
          </div>
        </div>
      )}

      <Card className="border-neutral-200 shadow-sm overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[820px]">
            <thead className="bg-neutral-50 text-neutral-500 text-[10px] font-black uppercase tracking-widest">
              <tr>
                <th className="px-6 py-5">Nº Apólice</th>
                <th className="px-6 py-5">Inquilino</th>
                <th className="px-6 py-5">Imobiliária</th>
                <th className="px-6 py-5">Vigência</th>
                <th className="px-6 py-5 text-right">Prêmio</th>
                <th className="px-6 py-5 text-center">Status</th>
                <th className="px-6 py-5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y border-t">
              {loading ? (
                <tr><td colSpan={7} className="text-center py-20 text-neutral-400">Carregando contratos...</td></tr>
              ) : filtradas.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-20">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-14 h-14 rounded-full bg-neutral-50 flex items-center justify-center text-neutral-300">
                        <FileText size={28} />
                      </div>
                      <p className="text-neutral-900 font-bold">Nenhum contrato ativo encontrado.</p>
                    </div>
                  </td>
                </tr>
              ) : filtradas.map((a) => (
                <tr key={a.id} className="hover:bg-neutral-50/50 transition-colors">
                  <td className="px-6 py-5">
                    <p className="font-black text-neutral-900">#{a.numero}</p>
                    <p className="text-[10px] uppercase tracking-widest text-neutral-400 mt-0.5">{a.consulta?.plano?.nome || 'Plano padrão'}</p>
                  </td>
                  <td className="px-6 py-5">
                    <p className="font-bold text-neutral-900 text-sm">{a.consulta?.inquilino?.nome || '—'}</p>
                    <p className="text-xs text-neutral-500">{a.consulta?.imovel?.endereco || ''}</p>
                  </td>
                  <td className="px-6 py-5 text-sm text-neutral-600">{a.imobiliaria?.nome || 'Autônomo'}</td>
                  <td className="px-6 py-5 text-sm text-neutral-600">
                    {formatDate(a.vigencia_inicio)} <span className="text-neutral-300">→</span> {formatDate(a.vigencia_fim)}
                  </td>
                  <td className="px-6 py-5 text-right font-black text-neutral-900">{formatBRL(Number(a.valor_premio))}</td>
                  <td className="px-6 py-5 text-center">
                    <StatusBadge status={a.status} />
                  </td>
                  <td className="px-6 py-5 text-right">
                    <Button asChild size="sm" className="bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg gap-2 font-bold">
                      <Link to="/apolices/$id" params={{ id: a.id }}>
                        Ver contrato <ArrowRight size={14} />
                      </Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </DashboardLayout>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ativa: "bg-green-50 text-green-700 border-green-200",
    pendente: "bg-amber-50 text-amber-700 border-amber-200",
    cancelada: "bg-red-50 text-red-700 border-red-200",
    encerrada: "bg-neutral-100 text-neutral-600 border-neutral-200",
  };
  return (
    <Badge className={`${map[status] || map.pendente} border text-[10px] uppercase font-black px-2.5 py-0.5`}>
      {status}
    </Badge>
  );
}
