import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { RouteErrorFallback } from "@/components/RouteErrorFallback";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { ConsultaDetalhesModal } from "@/components/admin/ConsultaDetalhesModal";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, Eye } from "lucide-react";
import { toast } from "sonner";
import {
  LABEL_STATUS_CONSULTA,
  formatDocumento,
  resolverStatusConsulta,
  type StatusExibicaoConsulta,
} from "@/lib/consultasCredito";

export const Route = createFileRoute("/admin/consultas")({
  component: () => (
    <ProtectedRoute roles={["admin", "analista", "admin_master"]} moduleKey="consultas">
      <ConsultasAdminPage />
    </ProtectedRoute>
  ),
  errorComponent: ({ error, reset }) => (
    <RouteErrorFallback
      error={error}
      reset={reset}
      message="Não foi possível carregar as consultas."
    />
  ),
});

const SELECT_CONSULTA = `
  id, status, resultado, substatus, created_at, updated_at,
  tenant_name, tenant_document, documento, property_address, rent_value, valor_aluguel,
  cep, imovel_cep, imovel_cidade, imovel_estado,
  role_solicitante, profile_id_solicitante, payment_status,
  plano_id, valor_premio_mensal, valor_anual,
  solicitante:profiles!profile_id_solicitante (id, nome, email, telefone, role),
  inquilinos (nome, razao_social, cpf, cnpj),
  imoveis (cidade, estado, cep, valor_aluguel),
  planos (nome)
`;

const LIMITE_LISTA = 500;

function ConsultasAdminPage() {
  const { user } = useAuth();
  const [linhas, setLinhas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<string>("todas");
  const [aoVivo, setAoVivo] = useState(false);
  const [consultaAberta, setConsultaAberta] = useState<any | null>(null);
  const montadoRef = useRef(true);

  // Só o administrador abre a caixa de detalhes aqui; analista e cargos internos
  // continuam indo para a tela de resultado da consulta, como sempre foi.
  const usaModal = user?.role === "admin" || user?.role === "admin_master" ||
    user?.internalRole === "admin_master";

  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
    };
  }, []);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase
      .from("consultas_credito")
      .select(SELECT_CONSULTA)
      .order("created_at", { ascending: false })
      .limit(LIMITE_LISTA);
    if (!montadoRef.current) return;
    if (error) toast.error("Erro ao carregar consultas");
    else setLinhas((data as any[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    setLoading(true);
    void carregar();
  }, [carregar]);

  // Tempo real: toda consulta criada ou atualizada por qualquer usuário do site entra
  // na lista sem recarregar a página. Em vez de refazer a busca inteira a cada evento,
  // busca só a linha alterada (o payload do realtime não traz os joins de solicitante/
  // inquilino/imóvel que a tabela mostra).
  useEffect(() => {
    const canal = supabase
      .channel("admin-consultas-tempo-real")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "consultas_credito" },
        async (payload) => {
          if (!montadoRef.current) return;

          if (payload.eventType === "DELETE") {
            const idRemovido = (payload.old as any)?.id;
            if (idRemovido) setLinhas((atual) => atual.filter((c) => c.id !== idRemovido));
            return;
          }

          const id = (payload.new as any)?.id;
          if (!id) return;

          const { data } = await supabase
            .from("consultas_credito")
            .select(SELECT_CONSULTA)
            .eq("id", id)
            .maybeSingle();
          if (!data || !montadoRef.current) return;

          setLinhas((atual) => {
            const semAntiga = atual.filter((c) => c.id !== id);
            return [data as any, ...semAntiga]
              .sort(
                (a, b) =>
                  new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
              )
              .slice(0, LIMITE_LISTA);
          });
          setConsultaAberta((atual: any) => (atual?.id === id ? (data as any) : atual));
        },
      )
      .subscribe((estado) => {
        if (montadoRef.current) setAoVivo(estado === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(canal);
    };
  }, []);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const qDigitos = busca.replace(/\D/g, "");
    return linhas.filter((c) => {
      const statusConsulta = resolverStatusConsulta(c);
      // "reprovado" (reprovação manual) e "recusado" (recusa automática do CredPago)
      // são os dois jeitos que uma consulta finaliza como negada — agrupa como um só
      // filtro pro admin, já que a distinção é interna, não faz sentido pra quem usa.
      if (status !== "todas" && statusConsulta !== status) return false;
      if (!q) return true;
      const documento = c.tenant_document ?? c.documento ?? "";
      return (
        (c.tenant_name ?? "").toLowerCase().includes(q) ||
        (c.inquilinos?.nome ?? "").toLowerCase().includes(q) ||
        (!!qDigitos && String(documento).replace(/\D/g, "").includes(qDigitos)) ||
        (c.property_address ?? "").toLowerCase().includes(q) ||
        (c.solicitante?.nome ?? "").toLowerCase().includes(q) ||
        (c.solicitante?.email ?? "").toLowerCase().includes(q) ||
        (c.role_solicitante ?? "").toLowerCase().includes(q) ||
        LABEL_STATUS_CONSULTA[statusConsulta].toLowerCase().includes(q)
      );
    });
  }, [linhas, busca, status]);

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">Consultas</h1>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${
                aoVivo
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-neutral-200 bg-neutral-100 text-neutral-500"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${aoVivo ? "bg-emerald-500 animate-pulse" : "bg-neutral-400"}`}
              />
              {aoVivo ? "Ao vivo" : "Conectando..."}
            </span>
          </div>
          <p className="text-neutral-500 mt-2 font-medium">
            Todas as consultas de todos os usuários do site, atualizadas em tempo real.
          </p>
        </div>

        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1 max-w-md">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
              size={18}
            />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por inquilino, CPF, endereço ou quem consultou..."
              className="pl-10 h-11"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-56 h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todos os status</SelectItem>
              <SelectItem value="aprovado">Aprovadas</SelectItem>
              <SelectItem value="recusado">Reprovadas</SelectItem>
              <SelectItem value="em_analise">Em análise</SelectItem>
              <SelectItem value="falta_documentos">Falta de documentos</SelectItem>
              <SelectItem value="processando">Consultando</SelectItem>
              <SelectItem value="pendente">Pendentes</SelectItem>
              <SelectItem value="erro">Com erro</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Mobile/tablet estreito (< md): cards empilhados, sem tabela pra arrastar. */}
        <div className="md:hidden space-y-3">
          {loading ? (
            <div className="text-center py-16 text-neutral-400 bg-white border border-neutral-200 rounded-xl">
              Carregando...
            </div>
          ) : !filtradas.length ? (
            <div className="text-center py-16 text-neutral-500 bg-white border border-neutral-200 rounded-xl">
              Nenhuma consulta encontrada.
            </div>
          ) : (
            filtradas.map((c) => {
              const documento = c.tenant_document ?? c.documento ?? c.inquilinos?.cpf ?? null;
              const criadaEm = new Date(c.created_at);
              const aluguel = Number(
                c.rent_value ?? c.valor_aluguel ?? c.imoveis?.valor_aluguel ?? 0,
              );
              return (
                <div key={c.id} className="bg-white border border-neutral-200 rounded-xl shadow-sm p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-neutral-900 truncate">
                        {c.tenant_name || c.inquilinos?.nome || "—"}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {documento ? formatDocumento(documento) : "—"}
                      </p>
                    </div>
                    <div className="shrink-0">
                      <StatusBadge status={resolverStatusConsulta(c)} />
                    </div>
                  </div>

                  <div className="mt-3 space-y-1 text-xs text-neutral-600">
                    <p className="truncate">{c.property_address ?? "—"}</p>
                    <p className="font-semibold text-neutral-900">
                      {aluguel > 0
                        ? `R$ ${aluguel.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                        : "—"}
                    </p>
                    <p className="truncate">
                      <span className="font-semibold">{c.solicitante?.nome ?? "—"}</span>
                      {" · "}
                      <span className="uppercase text-[10px] tracking-wide text-neutral-400">
                        {c.solicitante?.role ?? c.role_solicitante ?? "—"}
                      </span>
                    </p>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3">
                    <span className="text-[10px] text-neutral-400 font-medium">
                      {criadaEm.toLocaleDateString("pt-BR")}{" "}
                      {criadaEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {usaModal ? (
                      <Button size="sm" variant="ghost" className="gap-1" onClick={() => setConsultaAberta(c)}>
                        <Eye size={14} /> Ver
                      </Button>
                    ) : (
                      <a href={`/consultas/${c.id}/resultado`}>
                        <Button size="sm" variant="ghost" className="gap-1">
                          <Eye size={14} /> Ver
                        </Button>
                      </a>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Tablet/desktop (md:+): tabela completa. */}
        <div className="hidden md:block bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-neutral-50">
                <TableRow>
                  <TableHead className="px-6">Inquilino</TableHead>
                  <TableHead>Documento</TableHead>
                  <TableHead>Imóvel</TableHead>
                  <TableHead>Aluguel</TableHead>
                  <TableHead>Quem consultou</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead className="text-right pr-6">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-16 text-neutral-400">
                      Carregando...
                    </TableCell>
                  </TableRow>
                ) : !filtradas.length ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-16 text-neutral-500">
                      Nenhuma consulta encontrada.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtradas.map((c) => {
                    const documento = c.tenant_document ?? c.documento ?? c.inquilinos?.cpf ?? null;
                    const criadaEm = new Date(c.created_at);
                    const aluguel = Number(
                      c.rent_value ?? c.valor_aluguel ?? c.imoveis?.valor_aluguel ?? 0,
                    );
                    return (
                      <TableRow key={c.id} className="hover:bg-neutral-50/50">
                        <TableCell className="px-6 font-semibold">
                          {c.tenant_name || c.inquilinos?.nome || "—"}
                        </TableCell>
                        <TableCell className="text-xs text-neutral-500">
                          {documento ? formatDocumento(documento) : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-neutral-500 max-w-[220px] truncate">
                          {c.property_address ?? "—"}
                        </TableCell>
                        <TableCell>
                          {aluguel > 0
                            ? `R$ ${aluguel.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-neutral-600 max-w-[180px]">
                          <span className="block font-semibold truncate">
                            {c.solicitante?.nome ?? "—"}
                          </span>
                          <span className="block uppercase text-[10px] tracking-wide text-neutral-400">
                            {c.solicitante?.role ?? c.role_solicitante ?? "—"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={resolverStatusConsulta(c)} />
                        </TableCell>
                        <TableCell className="text-xs text-neutral-400 whitespace-nowrap">
                          <span className="block text-neutral-600 font-semibold">
                            {criadaEm.toLocaleDateString("pt-BR")}
                          </span>
                          {criadaEm.toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          {usaModal ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="gap-1"
                              onClick={() => setConsultaAberta(c)}
                            >
                              <Eye size={14} /> Ver
                            </Button>
                          ) : (
                            <a href={`/consultas/${c.id}/resultado`}>
                              <Button size="sm" variant="ghost" className="gap-1">
                                <Eye size={14} /> Ver
                              </Button>
                            </a>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {usaModal && (
        <ConsultaDetalhesModal
          consulta={consultaAberta}
          open={!!consultaAberta}
          onOpenChange={(aberto) => {
            if (!aberto) setConsultaAberta(null);
          }}
        />
      )}
    </DashboardLayout>
  );
}

function StatusBadge({ status }: { status: StatusExibicaoConsulta }) {
  const map: Record<StatusExibicaoConsulta, string> = {
    aprovado: "bg-emerald-100 text-emerald-700 border-emerald-200",
    pendente: "bg-amber-100 text-amber-700 border-amber-200",
    recusado: "bg-red-100 text-red-700 border-red-200",
    em_analise: "bg-amber-100 text-amber-700 border-amber-200",
    falta_documentos: "bg-orange-100 text-orange-700 border-orange-200",
    processando: "bg-yellow-100 text-yellow-700 border-yellow-200",
    erro: "bg-red-100 text-red-700 border-red-200",
  };
  return (
    <Badge className={map[status] ?? "bg-neutral-100 text-neutral-700"}>
      {LABEL_STATUS_CONSULTA[status] ?? status}
    </Badge>
  );
}
