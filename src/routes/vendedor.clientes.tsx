import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BriefcaseBusiness,
  CalendarCheck2,
  Clock3,
  RefreshCw,
  Search,
  UserRound,
  UsersRound,
} from "lucide-react";

import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchSellerLinkClientActivity,
  getSellerClientActivityStatus,
  type SellerClientActivityStatus,
  type SellerLinkClientActivity,
} from "@/lib/seller-clients";

export const Route = createFileRoute("/vendedor/clientes")({
  component: () => (
    <ProtectedRoute roles={["vendedor"]} sellerTypes={["sdr", "closer"]}>
      <SellerClientsPage />
    </ProtectedRoute>
  ),
});

type ClientFilter = "all" | "moving" | "contracts" | "attention";

const STATUS_COPY: Record<
  SellerClientActivityStatus,
  { label: string; className: string }
> = {
  active_contract: {
    label: "Contrato ativo",
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  consulted_this_week: {
    label: "Consultou na semana",
    className: "border-blue-200 bg-blue-50 text-blue-800",
  },
  inactive_this_week: {
    label: "Sem consulta na semana",
    className: "border-amber-200 bg-amber-50 text-amber-800",
  },
  never_consulted: {
    label: "Ainda não consultou",
    className: "border-neutral-200 bg-neutral-100 text-neutral-700",
  },
};

function SellerClientsPage() {
  const [clients, setClients] = useState<SellerLinkClientActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ClientFilter>("all");

  const load = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    setError("");
    try {
      setClients(await fetchSellerLinkClientActivity());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar a movimentação dos clientes.",
      );
    } finally {
      if (showLoader) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    const refresh = () => void load(false);
    const channel = supabase
      .channel("seller-link-client-activity")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_signup_attributions" },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "consultas_credito" },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "apolices" },
        refresh,
      )
      .subscribe();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const summary = useMemo(() => {
    const consultedThisWeek = clients.filter(
      (client) => client.weekly_consultation_count > 0,
    ).length;
    const activeContracts = clients.reduce(
      (total, client) => total + client.active_contract_count,
      0,
    );
    const needsAttention = clients.filter(
      (client) =>
        client.weekly_consultation_count === 0 && client.active_contract_count === 0,
    ).length;
    return { consultedThisWeek, activeContracts, needsAttention };
  }, [clients]);

  const visibleClients = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return clients.filter((client) => {
      const matchesQuery =
        !normalized ||
        `${client.client_name} ${client.client_email} ${client.client_phone ?? ""}`
          .toLocaleLowerCase("pt-BR")
          .includes(normalized);
      if (!matchesQuery) return false;
      if (filter === "moving") return client.weekly_consultation_count > 0;
      if (filter === "contracts") return client.active_contract_count > 0;
      if (filter === "attention") {
        return client.weekly_consultation_count === 0 && client.active_contract_count === 0;
      }
      return true;
    });
  }, [clients, filter, query]);

  async function refreshNow() {
    setRefreshing(true);
    await load(false);
    setRefreshing(false);
  }

  return (
    <DashboardLayout>
      <main className="space-y-5 pb-6">
        <section className="relative overflow-hidden rounded-[28px] bg-neutral-950 p-6 text-white shadow-xl sm:p-8">
          <div className="absolute -right-16 -top-16 h-52 w-52 rounded-full bg-yellow-400/20 blur-3xl" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <Badge className="border-0 bg-yellow-400 px-3 py-1.5 font-black text-neutral-950 hover:bg-yellow-400">
                <UsersRound className="mr-1.5 h-4 w-4" /> Clientes
              </Badge>
              <h1 className="mt-4 text-3xl font-black tracking-[-0.04em] sm:text-4xl">
                Acompanhe cada cliente <span className="text-yellow-400">em tempo real.</span>
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-300 sm:text-base">
                Aqui aparecem somente os usuários cadastrados pelos seus links, com consultas da
                semana, contratos ativos e a última movimentação.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="border-white/20 bg-white/10 font-bold text-white hover:bg-white/20 hover:text-white"
              onClick={() => void refreshNow()}
              disabled={refreshing}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard icon={UsersRound} label="Minha carteira" value={clients.length} detail="cadastros pelos seus links" />
          <SummaryCard icon={CalendarCheck2} label="Ativos na semana" value={summary.consultedThisWeek} detail="clientes que fizeram consulta" tone="blue" />
          <SummaryCard icon={BriefcaseBusiness} label="Contratos ativos" value={summary.activeContracts} detail="contratos em andamento" tone="green" />
          <SummaryCard icon={Clock3} label="Precisam de atenção" value={summary.needsAttention} detail="sem consulta nesta semana" tone="yellow" />
        </section>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">
            {error}
          </div>
        )}

        <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
          <div className="space-y-4 border-b border-neutral-200 p-5 sm:p-6">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-black text-neutral-950">Movimentação dos clientes</h2>
                <p className="mt-1 text-sm text-neutral-500">
                  Semana atual: {formatCurrentWeek()}. Atualização automática.
                </p>
              </div>
              <span className="text-xs font-bold text-neutral-500">
                {visibleClients.length} de {clients.length} cliente(s)
              </span>
            </div>

            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="relative w-full xl:max-w-md">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-neutral-400" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar nome, e-mail ou telefone"
                  className="h-10 pl-9"
                />
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>Todos</FilterButton>
                <FilterButton active={filter === "moving"} onClick={() => setFilter("moving")}>Consultaram</FilterButton>
                <FilterButton active={filter === "contracts"} onClick={() => setFilter("contracts")}>Com contrato</FilterButton>
                <FilterButton active={filter === "attention"} onClick={() => setFilter("attention")}>Atenção</FilterButton>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 p-12 text-sm font-semibold text-neutral-500">
              <RefreshCw className="h-4 w-4 animate-spin" /> Carregando sua carteira...
            </div>
          ) : visibleClients.length === 0 ? (
            <div className="p-10 text-center">
              <UserRound className="mx-auto h-9 w-9 text-neutral-300" />
              <p className="mt-3 font-black text-neutral-800">Nenhum cliente encontrado</p>
              <p className="mt-1 text-sm text-neutral-500">
                Os cadastros concluídos pelos seus links aparecerão aqui automaticamente.
              </p>
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[980px] text-left">
                  <thead className="bg-neutral-50 text-[11px] font-black uppercase tracking-wider text-neutral-500">
                    <tr>
                      <th className="px-6 py-3">Cliente</th>
                      <th className="px-4 py-3">Cadastro</th>
                      <th className="px-4 py-3">Status semanal</th>
                      <th className="px-4 py-3">Consultas</th>
                      <th className="px-4 py-3">Contratos ativos</th>
                      <th className="px-6 py-3">Última movimentação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {visibleClients.map((client) => <ClientTableRow key={client.attribution_id} client={client} />)}
                  </tbody>
                </table>
              </div>
              <div className="divide-y divide-neutral-100 lg:hidden">
                {visibleClients.map((client) => <ClientMobileRow key={client.attribution_id} client={client} />)}
              </div>
            </>
          )}
        </section>
      </main>
    </DashboardLayout>
  );
}

function SummaryCard({ icon: Icon, label, value, detail, tone = "neutral" }: {
  icon: typeof UsersRound;
  label: string;
  value: number;
  detail: string;
  tone?: "neutral" | "blue" | "green" | "yellow";
}) {
  const tones = {
    neutral: "bg-neutral-100 text-neutral-800",
    blue: "bg-blue-50 text-blue-700",
    green: "bg-emerald-50 text-emerald-700",
    yellow: "bg-yellow-100 text-yellow-800",
  };
  return (
    <article className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wider text-neutral-500">{label}</p>
          <p className="mt-2 text-3xl font-black text-neutral-950">{value}</p>
          <p className="mt-1 text-xs text-neutral-500">{detail}</p>
        </div>
        <span className={`grid h-11 w-11 place-items-center rounded-2xl ${tones[tone]}`}><Icon className="h-5 w-5" /></span>
      </div>
    </article>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <Button type="button" size="sm" variant={active ? "default" : "outline"} className={active ? "bg-neutral-950 font-bold text-white hover:bg-neutral-800" : "font-bold"} onClick={onClick}>
      {children}
    </Button>
  );
}

function ClientTableRow({ client }: { client: SellerLinkClientActivity }) {
  return (
    <tr className="transition-colors hover:bg-neutral-50/70">
      <td className="px-6 py-4"><ClientIdentity client={client} /></td>
      <td className="px-4 py-4 text-sm text-neutral-600">{formatDate(client.registered_at)}</td>
      <td className="px-4 py-4"><WeeklyStatus client={client} /></td>
      <td className="px-4 py-4"><strong className="text-neutral-950">{client.total_consultation_count}</strong><span className="ml-1 text-xs text-neutral-500">total</span></td>
      <td className="px-4 py-4"><strong className={client.active_contract_count > 0 ? "text-emerald-700" : "text-neutral-500"}>{client.active_contract_count}</strong></td>
      <td className="px-6 py-4"><LastActivity client={client} /></td>
    </tr>
  );
}

function ClientMobileRow({ client }: { client: SellerLinkClientActivity }) {
  return (
    <article className="space-y-4 p-5">
      <div className="flex items-start justify-between gap-3"><ClientIdentity client={client} /><WeeklyStatus client={client} /></div>
      <div className="grid grid-cols-3 gap-2">
        <Metric label="Na semana" value={client.weekly_consultation_count} />
        <Metric label="Consultas" value={client.total_consultation_count} />
        <Metric label="Contratos" value={client.active_contract_count} highlight={client.active_contract_count > 0} />
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
        <span>Cadastro: {formatDate(client.registered_at)}</span><LastActivity client={client} compact />
      </div>
    </article>
  );
}

function ClientIdentity({ client }: { client: SellerLinkClientActivity }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-neutral-950 text-yellow-300"><UserRound className="h-5 w-5" /></span>
      <div className="min-w-0">
        <p className="truncate font-black text-neutral-950">{client.client_name}</p>
        <p className="truncate text-xs text-neutral-500">{client.client_email}</p>
        <p className="mt-1 text-[10px] font-black uppercase tracking-wider text-neutral-400">{profileLabel(client.profile_role)}</p>
      </div>
    </div>
  );
}

function WeeklyStatus({ client }: { client: SellerLinkClientActivity }) {
  const status = getSellerClientActivityStatus(client);
  const copy = STATUS_COPY[status];
  return <Badge variant="outline" className={`whitespace-nowrap ${copy.className}`}>{copy.label}</Badge>;
}

function LastActivity({ client, compact = false }: { client: SellerLinkClientActivity; compact?: boolean }) {
  const status = getSellerClientActivityStatus(client);
  const date = client.last_contract_at ?? client.last_consultation_at;
  return (
    <span className={`flex items-center gap-1.5 ${compact ? "justify-end" : "text-xs text-neutral-500"}`}>
      <Activity className="h-3.5 w-3.5 shrink-0" />
      {date ? formatDateTime(date) : status === "never_consulted" ? "Só cadastro" : formatDateTime(client.last_activity_at)}
    </span>
  );
}

function Metric({ label, value, highlight = false }: { label: string; value: number; highlight?: boolean }) {
  return <div className={`rounded-xl border p-2.5 text-center ${highlight ? "border-emerald-200 bg-emerald-50" : "border-neutral-200 bg-neutral-50"}`}><p className={`text-lg font-black ${highlight ? "text-emerald-700" : "text-neutral-950"}`}>{value}</p><p className="text-[10px] font-bold text-neutral-500">{label}</p></div>;
}

function profileLabel(role: SellerLinkClientActivity["profile_role"]) {
  if (role === "proprietario") return "Proprietário";
  if (role === "imobiliaria") return "Imobiliária";
  return "Corretor";
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("pt-BR");
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatCurrentWeek() {
  const today = new Date();
  const day = today.getDay() || 7;
  const monday = new Date(today);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(today.getDate() - day + 1);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return `${monday.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} a ${sunday.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;
}
