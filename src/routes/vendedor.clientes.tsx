import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  PhoneCall,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";

import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { SellerClientRegistrationFlow } from "@/components/seller-clients/SellerClientRegistrationFlow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchSellerClientPhoneHistory,
  fetchSellerClients,
  type SellerClient,
  type SellerClientPhoneContact,
} from "@/lib/seller-clients";

export const Route = createFileRoute("/vendedor/clientes")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin"]}>
      <SellerClientsPage />
    </ProtectedRoute>
  ),
});

const PREVIEW_SIZE = 8;

function SellerClientsPage() {
  const [clients, setClients] = useState<SellerClient[]>([]);
  const [phoneContacts, setPhoneContacts] = useState<SellerClientPhoneContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    setError("");
    try {
      const [clientRows, contactRows] = await Promise.all([
        fetchSellerClients(),
        fetchSellerClientPhoneHistory(),
      ]);
      setClients(clientRows);
      setPhoneContacts(contactRows);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar os clientes.");
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
      .channel("seller-client-registration")
      .on("postgres_changes", { event: "*", schema: "public", table: "seller_client_phone_contacts" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "seller_client_partnerships" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "corretores" }, refresh)
      .subscribe();
    const expirationTimer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(expirationTimer);
      window.removeEventListener("focus", refresh);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  return (
    <DashboardLayout>
      <div className="space-y-7 pb-6">
        <section className="overflow-hidden rounded-3xl border border-yellow-300 bg-yellow-400 shadow-sm">
          <div className="p-6 sm:p-8">
            <Badge className="mb-4 border-neutral-900/10 bg-neutral-950 text-yellow-300 hover:bg-neutral-950">Cadastro sem duplicidade</Badge>
            <h1 className="text-3xl font-black tracking-tight text-neutral-950">Cadastrar cliente</h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-neutral-800">
              Consulte o telefone antes do contato. Cadastre pelo e-mail somente quando o cliente realmente seguir no atendimento — os dois processos são independentes.
            </p>
            <div className="mt-6">
              <SellerClientRegistrationFlow onPhoneClaimed={() => void load(false)} onRegistered={() => void load(false)} />
            </div>
          </div>
        </section>

        {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">{error}</div>}

        {loading ? (
          <LoadingCard label="Carregando históricos..." />
        ) : (
          <>
            <CollectionShowcase
              title="Histórico de pré-atendimentos"
              description="Reservas ativas. Cada telefone fica com você por 1 hora e depois é liberado automaticamente."
              icon={<Clock3 className="h-5 w-5 text-neutral-700" />}
              items={phoneContacts}
              itemKey={(contact) => contact.contact_id}
              searchText={(contact) => `${contact.phone_display} ${contact.client_email ?? ""}`}
              emptyText="Nenhum telefone reservado neste momento."
              searchPlaceholder="Pesquisar telefone"
              renderItem={(contact) => <PhoneContactCard contact={contact} />}
            />

            <CollectionShowcase
              title="Clientes cadastrados"
              description="Clientes vinculados definitivamente à sua carteira."
              icon={<Users className="h-5 w-5 text-neutral-700" />}
              items={clients}
              itemKey={(client) => client.partnership_id}
              searchText={(client) => `${client.partner_name} ${client.partner_email} ${client.partner_city ?? ""}`}
              emptyText="Cadastre o primeiro cliente para iniciar sua carteira."
              searchPlaceholder="Pesquisar nome, e-mail ou cidade"
              renderItem={(client) => <ClientCard client={client} />}
            />
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function CollectionShowcase<T>({ title, description, icon, items, itemKey, searchText, emptyText, searchPlaceholder, renderItem }: {
  title: string;
  description: string;
  icon: ReactNode;
  items: T[];
  itemKey: (item: T) => string;
  searchText: (item: T) => string;
  emptyText: string;
  searchPlaceholder: string;
  renderItem: (item: T) => ReactNode;
}) {
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pageCount = Math.max(1, Math.ceil(items.length / PREVIEW_SIZE));
  const visibleItems = items.slice(page * PREVIEW_SIZE, (page + 1) * PREVIEW_SIZE);
  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return normalized ? items.filter((item) => searchText(item).toLocaleLowerCase("pt-BR").includes(normalized)) : items;
  }, [items, query, searchText]);

  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);

  return (
    <section className="space-y-4 rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">{icon}<h2 className="text-lg font-black text-neutral-950">{title}</h2><Badge variant="secondary">{items.length}</Badge></div>
          <p className="mt-1 text-sm text-neutral-500">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          {items.length > PREVIEW_SIZE && (
            <>
              <Button variant="outline" size="icon" aria-label="Página anterior" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0}><ChevronLeft className="h-4 w-4" /></Button>
              <span className="min-w-12 text-center text-xs font-bold text-neutral-500">{page + 1}/{pageCount}</span>
              <Button variant="outline" size="icon" aria-label="Próxima página" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={page === pageCount - 1}><ChevronRight className="h-4 w-4" /></Button>
            </>
          )}
          <Button variant="outline" className="font-bold" onClick={() => setOpen(true)}>Ver mais</Button>
        </div>
      </div>

      {items.length === 0 ? <EmptyCard text={emptyText} /> : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{visibleItems.map((item) => <div key={itemKey(item)}>{renderItem(item)}</div>)}</div>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90vh] max-w-6xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-neutral-400" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} className="h-10 pl-9" autoFocus />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {filteredItems.length === 0 ? <EmptyCard text="Nenhum resultado encontrado." /> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{filteredItems.map((item) => <div key={itemKey(item)}>{renderItem(item)}</div>)}</div>}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ClientCard({ client }: { client: SellerClient }) {
  const isAgency = client.partner_type === "imobiliaria";
  return (
    <article className="h-full rounded-2xl border border-neutral-200 bg-neutral-50/60 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-950 text-yellow-300">{isAgency ? <Building2 className="h-5 w-5" /> : <Users className="h-5 w-5" />}</div>
        <div className="min-w-0 flex-1"><p className="truncate font-black text-neutral-950">{client.partner_name}</p><p className="truncate text-xs text-neutral-500">{client.partner_email}</p></div>
        <Badge variant="outline" className="shrink-0 text-[10px]">{isAgency ? "Imobiliária" : "Corretor"}</Badge>
      </div>
      <div className="mt-3 space-y-1.5 text-xs text-neutral-500">
        <p className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{client.partner_city || "Cidade não informada"}</p>
        <p className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />Cadastrado em {formatDate(client.registered_at)}</p>
        {isAgency && <p className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />{client.broker_count} corretor(es) vinculado(s)</p>}
      </div>
    </article>
  );
}

function PhoneContactCard({ contact }: { contact: SellerClientPhoneContact }) {
  return (
    <article className="h-full rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-yellow-700 shadow-sm"><PhoneCall className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1"><p className="font-black text-neutral-950">{contact.phone_display}</p><p className="truncate text-xs text-neutral-500">Reservado para seu atendimento</p></div>
        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Ativo</Badge>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-amber-200/70 pt-3 text-[11px] font-semibold text-neutral-500">
        <span>Consultado {formatDateTime(contact.first_contact_at)}</span>
        <span className="flex items-center gap-1 text-amber-800"><Clock3 className="h-3.5 w-3.5" />até {formatTime(contact.expires_at)}</span>
      </div>
    </article>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function LoadingCard({ label }: { label: string }) {
  return <div className="flex items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-white p-8 text-sm font-medium text-neutral-500"><RefreshCw className="h-4 w-4 animate-spin" />{label}</div>;
}

function EmptyCard({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm font-medium text-neutral-500">{text}</div>;
}
