import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileCheck2,
  MapPin,
  PhoneCall,
  RefreshCw,
  Users,
} from "lucide-react";

import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { SellerClientRegistrationFlow } from "@/components/seller-clients/SellerClientRegistrationFlow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchSellerClientContracts,
  fetchSellerClientMonthlyHistory,
  fetchSellerClientPhoneHistory,
  fetchSellerClients,
  type SellerClient,
  type SellerClientContract,
  type SellerClientMonthlyHistory,
  type SellerClientPhoneContact,
} from "@/lib/seller-clients";

export const Route = createFileRoute("/vendedor/clientes")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin"]}>
      <SellerClientsPage />
    </ProtectedRoute>
  ),
});

const MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}`;
}

function periodValue(month: number, year: number) {
  return `${year}-${month}`;
}

function parsePeriod(value: string) {
  const [year, month] = value.split("-").map(Number);
  return { month, year };
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SellerClientsPage() {
  const [clients, setClients] = useState<SellerClient[]>([]);
  const [history, setHistory] = useState<SellerClientMonthlyHistory[]>([]);
  const [phoneContacts, setPhoneContacts] = useState<SellerClientPhoneContact[]>([]);
  const [contracts, setContracts] = useState<SellerClientContract[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState(currentPeriod);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingContracts, setLoadingContracts] = useState(true);
  const [error, setError] = useState("");

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    setError("");
    try {
      const [clientsData, historyData, phoneContactsData] = await Promise.all([
        fetchSellerClients(),
        fetchSellerClientMonthlyHistory(),
        fetchSellerClientPhoneHistory(),
      ]);
      setClients(clientsData);
      setHistory(historyData);
      setPhoneContacts(phoneContactsData);
    } catch (caught: any) {
      setError(caught.message || "Não foi possível carregar os clientes cadastrados.");
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  const loadContracts = useCallback(async (period: string) => {
    setLoadingContracts(true);
    try {
      const { month, year } = parsePeriod(period);
      setContracts(await fetchSellerClientContracts(month, year));
    } catch (caught: any) {
      setContracts([]);
      setError(caught.message || "Não foi possível carregar os contratos do período.");
    } finally {
      setLoadingContracts(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([loadOverview(), loadContracts(selectedPeriod)]);
  }, [loadContracts, loadOverview, selectedPeriod]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    void loadContracts(selectedPeriod);
  }, [loadContracts, selectedPeriod]);

  useEffect(() => {
    const refreshFromRealtime = () => void refresh();
    const channel = supabase
      .channel("seller-client-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "seller_client_phone_contacts" }, refreshFromRealtime)
      .on("postgres_changes", { event: "*", schema: "public", table: "seller_client_partnerships" }, refreshFromRealtime)
      .on("postgres_changes", { event: "*", schema: "public", table: "corretores" }, refreshFromRealtime)
      .on("postgres_changes", { event: "*", schema: "public", table: "apolices" }, refreshFromRealtime)
      .on("postgres_changes", { event: "*", schema: "public", table: "faturas_inquilino" }, refreshFromRealtime)
      .on("postgres_changes", { event: "*", schema: "public", table: "mensalidades" }, refreshFromRealtime)
      .subscribe();

    window.addEventListener("focus", refreshFromRealtime);
    return () => {
      window.removeEventListener("focus", refreshFromRealtime);
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  const selectedSummary = useMemo(() => {
    const { month, year } = parsePeriod(selectedPeriod);
    return history.find((row) => row.month === month && row.year === year) ?? {
      month,
      year,
      contracts_closed: 0,
      first_installments_paid: 0,
    };
  }, [history, selectedPeriod]);

  return (
    <DashboardLayout>
      <div className="space-y-7">
        <section className="overflow-hidden rounded-3xl border border-yellow-300 bg-yellow-400 shadow-sm">
          <div className="grid gap-7 p-6 sm:p-8 lg:grid-cols-[1fr_0.95fr] lg:items-end">
            <div>
              <Badge className="mb-4 border-neutral-900/10 bg-neutral-950 text-yellow-300 hover:bg-neutral-950">
                Primeira aba do portal vendedor
              </Badge>
              <h1 className="text-3xl font-black tracking-tight text-neutral-950">Cadastrar cliente</h1>
              <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-neutral-800">
                Consulte primeiro o telefone com DDD. Se estiver livre, o contato entra no seu histórico
                antes do atendimento e o cadastro completo é liberado pelo e-mail NOX.
              </p>
            </div>

            <SellerClientRegistrationFlow
              onPhoneClaimed={() => void loadOverview()}
              onRegistered={() => void refresh()}
            />
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Clock3 className="h-5 w-5 text-neutral-700" />
                <h2 className="text-lg font-black text-neutral-950">Histórico de pré-atendimentos</h2>
                <Badge variant="secondary">{phoneContacts.length}</Badge>
              </div>
              <p className="mt-1 text-sm text-neutral-500">
                Telefones que você já consultou e reservou para atendimento.
              </p>
            </div>
          </div>

          {loadingOverview ? (
            <LoadingCard label="Carregando pré-atendimentos..." />
          ) : phoneContacts.length === 0 ? (
            <EmptyCard text="Nenhum telefone consultado ainda." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {phoneContacts.map((contact) => (
                <PhoneContactCard key={contact.contact_id} contact={contact} />
              ))}
            </div>
          )}
        </section>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-black text-neutral-950">Produção dos clientes</h2>
            <p className="text-sm text-neutral-500">Fechamentos organizados por mês, com histórico permanente.</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              aria-label="Período do histórico"
              value={selectedPeriod}
              onChange={(event) => setSelectedPeriod(event.target.value)}
              className="h-10 rounded-xl border border-neutral-200 bg-white px-3 text-sm font-bold text-neutral-800 shadow-sm outline-none focus:border-yellow-400 focus:ring-2 focus:ring-yellow-200"
            >
              {history.map((row) => (
                <option key={periodValue(row.month, row.year)} value={periodValue(row.month, row.year)}>
                  {MONTHS[row.month - 1]} de {row.year}
                </option>
              ))}
            </select>
            <Button variant="outline" size="icon" aria-label="Atualizar dados" onClick={refresh} disabled={loadingOverview || loadingContracts}>
              <RefreshCw className={`h-4 w-4 ${loadingOverview || loadingContracts ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">{error}</div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <SummaryCard
            icon={FileCheck2}
            label="Contratos fechados"
            value={selectedSummary.contracts_closed}
            description={`${MONTHS[selectedSummary.month - 1]} de ${selectedSummary.year}`}
          />
          <SummaryCard
            icon={CheckCircle2}
            label="1ª parcela paga"
            value={selectedSummary.first_installments_paid}
            description="Contratos do período com pagamento confirmado"
            success
          />
        </div>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-neutral-700" />
            <h2 className="text-lg font-black text-neutral-950">Clientes cadastrados</h2>
            <Badge variant="secondary">{clients.length}</Badge>
          </div>

          {loadingOverview ? (
            <LoadingCard label="Carregando clientes..." />
          ) : clients.length === 0 ? (
            <EmptyCard text="Cadastre o primeiro e-mail de parceiro para acompanhar a produção." />
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {clients.map((client) => <ClientCard key={client.partnership_id} client={client} />)}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-neutral-700" />
            <h2 className="text-lg font-black text-neutral-950">Contratos do período</h2>
          </div>

          {loadingContracts ? (
            <LoadingCard label="Carregando histórico..." />
          ) : contracts.length === 0 ? (
            <EmptyCard text="Nenhum contrato fechado por estes clientes neste período." />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[780px] text-left text-sm">
                  <thead className="border-b border-neutral-200 bg-neutral-50 text-[11px] font-black uppercase tracking-widest text-neutral-500">
                    <tr>
                      <th className="px-5 py-4">Usuário que fechou</th>
                      <th className="px-5 py-4">Cliente parceiro</th>
                      <th className="px-5 py-4">Data</th>
                      <th className="px-5 py-4">Cidade</th>
                      <th className="px-5 py-4">1ª parcela</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {contracts.map((contract) => (
                      <tr key={contract.contract_id} className="text-neutral-700">
                        <td className="px-5 py-4">
                          <p className="font-bold text-neutral-950">{contract.requester_name}</p>
                          <p className="text-xs text-neutral-400">{contract.contract_number || "Contrato sem número"}</p>
                        </td>
                        <td className="px-5 py-4 font-medium">{contract.partner_name}</td>
                        <td className="px-5 py-4">{formatDate(contract.contract_closed_at)}</td>
                        <td className="px-5 py-4">{contract.city || "Não informada"}</td>
                        <td className="px-5 py-4">
                          <Badge className={contract.first_installment_paid ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : "bg-amber-100 text-amber-800 hover:bg-amber-100"}>
                            {contract.first_installment_paid ? "Paga" : "Aguardando"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        {history.length > 1 && (
          <section className="space-y-3">
            <h2 className="text-lg font-black text-neutral-950">Histórico mensal</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {history.map((row) => (
                <button
                  key={periodValue(row.month, row.year)}
                  type="button"
                  onClick={() => setSelectedPeriod(periodValue(row.month, row.year))}
                  className={`rounded-2xl border p-4 text-left transition ${selectedPeriod === periodValue(row.month, row.year) ? "border-yellow-400 bg-yellow-50 ring-2 ring-yellow-200" : "border-neutral-200 bg-white hover:border-yellow-300"}`}
                >
                  <p className="text-xs font-black uppercase tracking-widest text-neutral-500">{MONTHS[row.month - 1]} {row.year}</p>
                  <p className="mt-2 text-2xl font-black text-neutral-950">{row.contracts_closed}</p>
                  <p className="text-xs text-neutral-500">contratos · {row.first_installments_paid} com 1ª parcela paga</p>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </DashboardLayout>
  );
}

function SummaryCard({ icon: Icon, label, value, description, success = false }: {
  icon: typeof FileCheck2;
  label: string;
  value: number;
  description: string;
  success?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${success ? "bg-emerald-100 text-emerald-700" : "bg-yellow-100 text-yellow-800"}`}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="mt-5 text-xs font-black uppercase tracking-widest text-neutral-400">{label}</p>
      <p className="mt-1 text-3xl font-black text-neutral-950">{value}</p>
      <p className="mt-1 text-xs text-neutral-500">{description}</p>
    </div>
  );
}

function ClientCard({ client }: { client: SellerClient }) {
  const isAgency = client.partner_type === "imobiliaria";
  return (
    <article className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-neutral-950 text-yellow-300">
            {isAgency ? <Building2 className="h-5 w-5" /> : <Users className="h-5 w-5" />}
          </div>
          <div className="min-w-0">
            <p className="truncate font-black text-neutral-950">{client.partner_name}</p>
            <p className="truncate text-sm text-neutral-500">{client.partner_email}</p>
          </div>
        </div>
        <Badge variant="outline" className="shrink-0">
          {isAgency ? "Imobiliária" : "Autônomo"}
        </Badge>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-neutral-500">
        <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{client.partner_city || "Cidade não informada"}</span>
        <span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />Cadastrado por {client.registered_by_name} em {formatDate(client.registered_at)}</span>
      </div>

      {isAgency && (
        <div className="mt-5 rounded-xl border border-neutral-100 bg-neutral-50 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs font-black uppercase tracking-widest text-neutral-500">Corretores vinculados</p>
            <Badge className="bg-yellow-300 text-neutral-950 hover:bg-yellow-300">{client.broker_count}</Badge>
          </div>
          {client.brokers.length === 0 ? (
            <p className="text-sm text-neutral-500">Nenhum corretor vinculado no momento.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {client.brokers.map((broker) => (
                <div key={broker.profile_id} className="rounded-lg bg-white px-3 py-2">
                  <p className="truncate text-sm font-bold text-neutral-900">{broker.nome}</p>
                  <p className="truncate text-xs text-neutral-500">{broker.cidade || broker.email}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function PhoneContactCard({ contact }: { contact: SellerClientPhoneContact }) {
  const registered = contact.status === "cadastrado";
  return (
    <article className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <PhoneCall className="h-5 w-5 shrink-0 text-yellow-600" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-black text-neutral-950">{contact.phone_display}</p>
            <p className="truncate text-xs text-neutral-500">{contact.client_email || "Cadastro ainda não finalizado"}</p>
          </div>
        </div>
        <Badge className={registered ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : "bg-amber-100 text-amber-800 hover:bg-amber-100"}>
          {registered ? "Cadastrado" : "Em atendimento"}
        </Badge>
      </div>

      {(contact.broker_name || contact.agency_name || contact.city) && (
        <p className="mt-3 truncate text-xs font-semibold text-neutral-600">
          {[contact.broker_name, contact.agency_name, contact.city].filter(Boolean).join(" · ")}
        </p>
      )}
      <p className="mt-3 text-[11px] font-medium text-neutral-400">
        Último contato em {formatDateTime(contact.last_contact_at)}
      </p>
    </article>
  );
}

function LoadingCard({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-white p-8 text-sm font-medium text-neutral-500">
      <RefreshCw className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm font-medium text-neutral-500">{text}</div>
  );
}
