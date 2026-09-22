import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  Users2,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchAdminSellerPortfolioClients,
  fetchAdminSellerPortfolios,
  unlinkAdminSellerClient,
  type AdminSellerPortfolio,
  type AdminSellerPortfolioClient,
} from "@/lib/admin-seller-clients";

export function SellerClientsAdminTab() {
  const [sellers, setSellers] = useState<AdminSellerPortfolio[]>([]);
  const [selected, setSelected] = useState<AdminSellerPortfolio | null>(null);
  const [clients, setClients] = useState<AdminSellerPortfolioClient[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingClients, setLoadingClients] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<AdminSellerPortfolioClient | null>(null);

  const loadSellers = useCallback(async () => {
    try {
      setSellers(await fetchAdminSellerPortfolios());
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível carregar os vendedores.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadClients = useCallback(async (seller: AdminSellerPortfolio) => {
    setLoadingClients(true);
    try {
      setClients(await fetchAdminSellerPortfolioClients(seller.seller_id));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível carregar os clientes.",
      );
    } finally {
      setLoadingClients(false);
    }
  }, []);

  useEffect(() => {
    void loadSellers();
    const refresh = () => {
      void loadSellers();
      if (selected) void loadClients(selected);
    };
    const channel = supabase
      .channel("admin-seller-client-portfolios")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_signup_attributions" },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seller_client_partnerships" },
        refresh,
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadClients, loadSellers, selected]);

  const visibleSellers = useMemo(() => {
    const value = query.trim().toLocaleLowerCase("pt-BR");
    if (!value) return sellers;
    return sellers.filter((seller) =>
      `${seller.seller_name} ${seller.seller_email} ${seller.seller_type}`
        .toLocaleLowerCase("pt-BR")
        .includes(value),
    );
  }, [query, sellers]);

  async function selectSeller(seller: AdminSellerPortfolio) {
    setSelected(seller);
    setClients([]);
    await loadClients(seller);
  }

  async function confirmRemoval() {
    if (!selected || !pendingRemoval) return;
    setRemoving(true);
    try {
      await unlinkAdminSellerClient(selected.seller_id, pendingRemoval.client_profile_id);
      toast.success("Cliente removido somente da carteira do vendedor. A conta foi preservada.");
      setPendingRemoval(null);
      await Promise.all([loadSellers(), loadClients(selected)]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível remover o vínculo.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <>
      <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
        <header className="flex flex-col gap-4 border-b border-neutral-200 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-yellow-700">
              <ShieldCheck className="h-4 w-4" /> Controle exclusivo do administrador
            </div>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-neutral-950">
              Clientes dos vendedores
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              Selecione um SDR ou Closer para consultar sua carteira e corrigir vínculos feitos por
              engano.
            </p>
          </div>
          <Button variant="outline" onClick={() => void loadSellers()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Atualizar
          </Button>
        </header>

        <div className="grid min-h-[480px] lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="border-b border-neutral-200 p-4 lg:border-b-0 lg:border-r">
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-neutral-400" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar vendedor"
                className="pl-9"
              />
            </div>
            <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
              {loading ? (
                <LoadingState label="Carregando vendedores..." />
              ) : visibleSellers.length === 0 ? (
                <EmptyState label="Nenhum SDR ou Closer encontrado." />
              ) : (
                visibleSellers.map((seller) => (
                  <button
                    key={seller.seller_id}
                    type="button"
                    onClick={() => void selectSeller(seller)}
                    className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${
                      selected?.seller_id === seller.seller_id
                        ? "border-yellow-400 bg-yellow-50"
                        : "border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50"
                    }`}
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-neutral-950 text-sm font-black text-yellow-400">
                      {initials(seller.seller_name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-black text-neutral-950">
                        {seller.seller_name}
                      </span>
                      <span className="mt-1 flex items-center gap-2 text-[11px] font-semibold text-neutral-500">
                        <Badge
                          variant="outline"
                          className="h-5 px-1.5 text-[9px] font-black uppercase"
                        >
                          {seller.seller_type}
                        </Badge>
                        {seller.client_count} cliente(s)
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-neutral-400" />
                  </button>
                ))
              )}
            </div>
          </aside>

          <div className="min-w-0 p-4 sm:p-6">
            {!selected ? (
              <div className="grid h-full min-h-[360px] place-items-center rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 p-8 text-center">
                <div>
                  <Users2 className="mx-auto h-10 w-10 text-neutral-300" />
                  <p className="mt-3 font-black text-neutral-800">Escolha um vendedor</p>
                  <p className="mt-1 text-sm text-neutral-500">A carteira dele será aberta aqui.</p>
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-black text-neutral-950">
                        {selected.seller_name}
                      </h3>
                      <Badge className="bg-neutral-950 uppercase text-yellow-400 hover:bg-neutral-950">
                        {selected.seller_type}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-neutral-500">
                      {selected.seller_email} · {clients.length} cliente(s)
                    </p>
                  </div>
                </div>

                {loadingClients ? (
                  <LoadingState label="Carregando carteira..." />
                ) : clients.length === 0 ? (
                  <EmptyState label="Este vendedor não possui clientes vinculados." />
                ) : (
                  <div className="space-y-2">
                    {clients.map((client) => (
                      <article
                        key={client.client_profile_id}
                        className="flex flex-col gap-3 rounded-2xl border border-neutral-200 p-4 sm:flex-row sm:items-center"
                      >
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-neutral-100 font-black text-neutral-700">
                          <UserRound className="h-5 w-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="truncate font-black text-neutral-950">
                              {client.client_name}
                            </h4>
                            <Badge variant="outline" className="text-[9px] uppercase">
                              {roleLabel(client.profile_role)}
                            </Badge>
                          </div>
                          <p className="mt-1 truncate text-xs text-neutral-500">
                            {client.client_email}
                            {client.client_phone ? ` · ${client.client_phone}` : ""}
                          </p>
                          <p className="mt-1 text-[11px] font-semibold text-neutral-400">
                            Cadastrado em {formatDate(client.registered_at)} ·{" "}
                            {sourceLabel(client.attribution_source)}
                          </p>
                        </div>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setPendingRemoval(client)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> Excluir da lista
                        </Button>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <AlertDialog
        open={!!pendingRemoval}
        onOpenChange={(open) => !open && !removing && setPendingRemoval(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover cliente da carteira?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRemoval?.client_name} deixará de aparecer para {selected?.seller_name} e não
              contará mais nessa carteira. A conta, o login, as consultas e os contratos do cliente
              não serão excluídos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={removing}
              onClick={(event) => {
                event.preventDefault();
                void confirmRemoval();
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {removing ? "Removendo..." : "Remover somente o vínculo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-10 text-sm font-semibold text-neutral-500">
      <RefreshCw className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 p-8 text-center text-sm font-semibold text-neutral-500">
      {label}
    </div>
  );
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "VN"
  );
}

function roleLabel(role: string) {
  return (
    (
      { proprietario: "Proprietário", imobiliaria: "Imobiliária", corretor: "Corretor" } as Record<
        string,
        string
      >
    )[role] ?? role
  );
}

function sourceLabel(source: string) {
  return source === "manual"
    ? "cadastro manual"
    : source === "link"
      ? "cadastro por link"
      : "vínculo legado";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(value),
  );
}
