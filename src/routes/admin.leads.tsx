import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Copy,
  Download,
  Megaphone,
  Plus,
  RefreshCw,
  Search,
  Send,
  Target,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/admin/leads")({
  component: () => (
    <ProtectedRoute roles={["admin", "analista", "admin_master", "marketing"]} moduleKey="leads">
      <MarketingLeadsAdmin />
    </ProtectedRoute>
  ),
});

type Audience = "leads" | "inquilinos" | "corretores" | "imobiliarias" | "leads_consulta";
type Provider = "meta" | "google";

type MarketingContact = {
  id: string;
  audience: Audience;
  first_name: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  document: string | null;
  city: string | null;
  rent_range: string | null;
  rent_value: number | null;
  source_status: string | null;
  source_origin: string | null;
  weekly_message_enabled: boolean;
  closed_at: string | null;
  created_at: string;
};

type MarketingIntegration = {
  id: string;
  provider: Provider;
  account_name: string;
  account_id: string;
  status: string;
  token_secret_name: string | null;
  pixel_id: string | null;
  customer_id: string | null;
  last_sync_at: string | null;
  last_error: string | null;
};

type MarketingCampaign = {
  id: string;
  integration_id: string | null;
  provider: Provider;
  external_campaign_id: string | null;
  name: string;
  objective: string;
  audience: Audience;
  status: string;
  budget_daily: number | null;
  landing_page_url: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  notes: string | null;
  created_at: string;
};

type CampaignMetric = {
  campaign_id: string;
  impressions: number;
  clicks: number;
  leads: number;
  conversions: number;
  spend: number;
  revenue: number;
};

type LegacyLeadContato = {
  id: string;
  perfil: string | null;
  nome: string | null;
  email: string | null;
  telefone: string | null;
  cidade: string | null;
  uf: string | null;
  status: string | null;
  origem: string | null;
  created_at: string;
};

type LegacySalesLead = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  status: string | null;
  origin: string | null;
  created_at: string;
};

type LegacyConsulta = {
  id: string;
  tenant_name: string | null;
  tenant_document: string | null;
  tenant_email: string | null;
  tenant_telefone: string | null;
  imovel_cidade: string | null;
  property_address: string | null;
  rent_value: number | null;
  valor_aluguel: number | null;
  status: string | null;
  origem: string | null;
  created_at: string;
};

type LegacyProfile = {
  id: string;
  nome: string | null;
  email: string | null;
  telefone: string | null;
  role: string | null;
  created_at: string;
};

const AUDIENCE_LABEL: Record<Audience, string> = {
  leads: "Leads",
  inquilinos: "Inquilinos",
  corretores: "Corretores",
  imobiliarias: "Imobiliarias",
  leads_consulta: "Leads Consulta",
};

const AUDIENCE_CLASS: Record<Audience, string> = {
  leads: "border-neutral-200 bg-neutral-100 text-neutral-800",
  inquilinos: "border-blue-200 bg-blue-50 text-blue-700",
  corretores: "border-emerald-200 bg-emerald-50 text-emerald-700",
  imobiliarias: "border-amber-200 bg-amber-50 text-amber-700",
  leads_consulta: "border-violet-200 bg-violet-50 text-violet-700",
};

const PROVIDER_LABEL: Record<Provider, string> = {
  meta: "Facebook / Instagram",
  google: "Google Ads",
};

const emptyCampaign = {
  provider: "meta" as Provider,
  external_campaign_id: "",
  name: "",
  objective: "lead_generation",
  audience: "leads" as Audience,
  budget_daily: "",
  landing_page_url: "",
  utm_source: "facebook",
  utm_medium: "paid_social",
  utm_campaign: "",
  utm_content: "",
  utm_term: "",
  notes: "",
};

function isMissingMarketingSchema(error: unknown) {
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message)
      : String(error ?? "");
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  return (
    code === "PGRST205" ||
    code === "PGRST202" ||
    code === "42P01" ||
    message.includes("marketing_contacts") ||
    message.includes("marketing_ad_integrations") ||
    message.includes("marketing_campaigns") ||
    message.includes("marketing_campaign_metrics") ||
    message.includes("refresh_marketing_audiences") ||
    message.includes("Could not find the function") ||
    message.includes("schema cache")
  );
}

async function loadMarketingContacts(): Promise<{
  contacts: MarketingContact[];
  missingSchema: boolean;
}> {
  const refresh = await supabase.rpc("refresh_marketing_audiences" as any);
  if (refresh.error && !isMissingMarketingSchema(refresh.error)) throw refresh.error;

  const contactsRes = await supabase
    .from("marketing_contacts" as any)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(2000);

  if (isMissingMarketingSchema(contactsRes.error)) {
    return { contacts: [], missingSchema: true };
  }
  if (contactsRes.error) throw contactsRes.error;

  return {
    contacts: (contactsRes.data as unknown as MarketingContact[]) ?? [],
    missingSchema: false,
  };
}

async function loadLegacyMarketingContacts() {
  const [salesRes, contatoRes, profilesRes, consultasRes] = await Promise.all([
    supabase
      .from("sales_leads" as any)
      .select("id, full_name, email, phone, city, status, origin, created_at")
      .order("created_at", { ascending: false })
      .limit(700),
    supabase
      .from("leads_contato" as any)
      .select("id, perfil, nome, email, telefone, cidade, uf, status, origem, created_at")
      .order("created_at", { ascending: false })
      .limit(700),
    supabase
      .from("profiles")
      .select("id, nome, email, telefone, role, created_at")
      .in("role", ["inquilino", "corretor", "imobiliaria"] as any)
      .order("created_at", { ascending: false })
      .limit(700),
    supabase
      .from("consultas_credito")
      .select(
        "id, tenant_name, tenant_document, tenant_email, tenant_telefone, imovel_cidade, property_address, rent_value, valor_aluguel, status, origem, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(700),
  ]);

  const contacts = [
    ...((salesRes.data as unknown as LegacySalesLead[]) ?? []).map(mapSalesLeadContact),
    ...((contatoRes.data as unknown as LegacyLeadContato[]) ?? []).map(mapLeadContatoContact),
    ...((profilesRes.data as unknown as LegacyProfile[]) ?? []).map(mapProfileContact),
    ...((consultasRes.data as unknown as LegacyConsulta[]) ?? []).map(mapConsultaContact),
  ];

  return dedupeContacts(contacts).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

function mapSalesLeadContact(lead: LegacySalesLead): MarketingContact {
  return {
    id: `sales-${lead.id}`,
    audience: "leads",
    first_name: firstName(lead.full_name),
    full_name: lead.full_name,
    email: lead.email,
    phone: lead.phone,
    document: null,
    city: lead.city,
    rent_range: null,
    rent_value: null,
    source_status: lead.status,
    source_origin: lead.origin || "sales_leads",
    weekly_message_enabled: true,
    closed_at: ["convertido", "fechado", "ganho", "atendido"].includes(lead.status || "")
      ? lead.created_at
      : null,
    created_at: lead.created_at,
  };
}

function mapLeadContatoContact(lead: LegacyLeadContato): MarketingContact {
  const city = [lead.cidade, lead.uf].filter(Boolean).join("/");
  return {
    id: `contato-${lead.id}`,
    audience: audienceFromPerfil(lead.perfil),
    first_name: firstName(lead.nome),
    full_name: lead.nome,
    email: lead.email,
    phone: lead.telefone,
    document: null,
    city: city || null,
    rent_range: null,
    rent_value: null,
    source_status: lead.status,
    source_origin: lead.origem || "leads_contato",
    weekly_message_enabled: true,
    closed_at: lead.status === "convertido" ? lead.created_at : null,
    created_at: lead.created_at,
  };
}

function mapProfileContact(profile: LegacyProfile): MarketingContact {
  return {
    id: `profile-${profile.id}`,
    audience: audienceFromPerfil(profile.role),
    first_name: firstName(profile.nome),
    full_name: profile.nome,
    email: profile.email,
    phone: profile.telefone,
    document: null,
    city: null,
    rent_range: null,
    rent_value: null,
    source_status: profile.role,
    source_origin: "cadastro",
    weekly_message_enabled: true,
    closed_at: null,
    created_at: profile.created_at,
  };
}

function mapConsultaContact(consulta: LegacyConsulta): MarketingContact {
  const rentValue = consulta.rent_value ?? consulta.valor_aluguel ?? null;
  return {
    id: `consulta-${consulta.id}`,
    audience: "leads_consulta",
    first_name: firstName(consulta.tenant_name),
    full_name: consulta.tenant_name,
    email: consulta.tenant_email,
    phone: consulta.tenant_telefone,
    document: consulta.tenant_document,
    city: consulta.imovel_cidade || consulta.property_address,
    rent_range: rentRange(rentValue),
    rent_value: rentValue,
    source_status: consulta.status,
    source_origin: consulta.origem || "consultas_credito",
    weekly_message_enabled: true,
    closed_at: null,
    created_at: consulta.created_at,
  };
}

function audienceFromPerfil(perfil?: string | null): Audience {
  if (perfil === "inquilino") return "inquilinos";
  if (perfil === "corretor") return "corretores";
  if (perfil === "imobiliaria") return "imobiliarias";
  return "leads";
}

function firstName(name?: string | null) {
  return name?.trim().split(/\s+/)[0] || "Contato";
}

function rentRange(value?: number | null) {
  if (value == null) return null;
  if (value < 1500) return "Ate R$ 1.500";
  if (value < 3000) return "R$ 1.500 a R$ 3.000";
  if (value < 5000) return "R$ 3.000 a R$ 5.000";
  if (value < 8000) return "R$ 5.000 a R$ 8.000";
  return "Acima de R$ 8.000";
}

function dedupeContacts(contacts: MarketingContact[]) {
  const seen = new Map<string, MarketingContact>();
  contacts.forEach((contact) => {
    const key =
      contact.email?.toLowerCase() ||
      contact.phone?.replace(/\D/g, "") ||
      contact.document?.replace(/\D/g, "") ||
      contact.id;
    const previous = seen.get(`${contact.audience}-${key}`);
    if (!previous || new Date(contact.created_at) > new Date(previous.created_at)) {
      seen.set(`${contact.audience}-${key}`, contact);
    }
  });
  return Array.from(seen.values());
}

function MarketingLeadsAdmin() {
  const [contacts, setContacts] = useState<MarketingContact[]>([]);
  const [integrations, setIntegrations] = useState<MarketingIntegration[]>([]);
  const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([]);
  const [metrics, setMetrics] = useState<CampaignMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<Audience | "ads">("leads");
  const [searchTerm, setSearchTerm] = useState("");
  const [campaignDraft, setCampaignDraft] = useState(emptyCampaign);

  async function load() {
    setLoading(true);
    try {
      const contactsRes = await loadMarketingContacts();

      if (contactsRes.missingSchema) {
        const fallbackContacts = await loadLegacyMarketingContacts();
        setContacts(fallbackContacts);
        setIntegrations([]);
        setCampaigns([]);
        setMetrics([]);
        return;
      }

      const [integrationsRes, campaignsRes, metricsRes] = await Promise.all([
        supabase
          .from("marketing_ad_integrations" as any)
          .select("*")
          .order("provider", { ascending: true }),
        supabase
          .from("marketing_campaigns" as any)
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("marketing_campaign_metrics" as any)
          .select("campaign_id, impressions, clicks, leads, conversions, spend, revenue"),
      ]);

      setContacts(contactsRes.contacts);
      setIntegrations(
        isMissingMarketingSchema(integrationsRes.error)
          ? []
          : ((integrationsRes.data as unknown as MarketingIntegration[]) ?? []),
      );
      setCampaigns(
        isMissingMarketingSchema(campaignsRes.error)
          ? []
          : ((campaignsRes.data as unknown as MarketingCampaign[]) ?? []),
      );
      setMetrics(
        isMissingMarketingSchema(metricsRes.error)
          ? []
          : ((metricsRes.data as unknown as CampaignMetric[]) ?? []),
      );
    } catch (error: any) {
      toast.error(
        "Nao foi possivel carregar o marketing: " + (error.message || "erro desconhecido"),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const metricsByCampaign = useMemo(() => {
    const map = new Map<string, CampaignMetric>();
    metrics.forEach((metric) => {
      const previous = map.get(metric.campaign_id) ?? {
        campaign_id: metric.campaign_id,
        impressions: 0,
        clicks: 0,
        leads: 0,
        conversions: 0,
        spend: 0,
        revenue: 0,
      };
      map.set(metric.campaign_id, {
        campaign_id: metric.campaign_id,
        impressions: previous.impressions + Number(metric.impressions ?? 0),
        clicks: previous.clicks + Number(metric.clicks ?? 0),
        leads: previous.leads + Number(metric.leads ?? 0),
        conversions: previous.conversions + Number(metric.conversions ?? 0),
        spend: previous.spend + Number(metric.spend ?? 0),
        revenue: previous.revenue + Number(metric.revenue ?? 0),
      });
    });
    return map;
  }, [metrics]);

  const filteredContacts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const base =
      activeTab === "leads"
        ? contacts.filter((contact) => contact.audience !== "leads_consulta")
        : activeTab === "ads"
          ? []
          : contacts.filter((contact) => contact.audience === activeTab);
    if (!term) return base;
    return base.filter((contact) =>
      [
        contact.first_name,
        contact.full_name,
        contact.email,
        contact.phone,
        contact.document,
        contact.city,
        contact.source_origin,
      ].some((value) => value?.toLowerCase().includes(term)),
    );
  }, [contacts, activeTab, searchTerm]);

  const stats = useMemo(() => {
    const contactsWithChannel = contacts.filter((contact) => contact.audience !== "leads_consulta");
    return {
      total: contactsWithChannel.length,
      withEmail: contactsWithChannel.filter((contact) => contact.email).length,
      withPhone: contactsWithChannel.filter((contact) => contact.phone).length,
      consultas: contacts.filter((contact) => contact.audience === "leads_consulta").length,
      closedLeads: contacts.filter((contact) => contact.audience === "leads" && contact.closed_at)
        .length,
      activeCampaigns: campaigns.filter((campaign) => campaign.status === "ativo").length,
      spend: metrics.reduce((sum, metric) => sum + Number(metric.spend ?? 0), 0),
    };
  }, [contacts, campaigns, metrics]);

  function exportCsv() {
    const isConsultas = activeTab === "leads_consulta";
    const headers = isConsultas
      ? ["Primeiro Nome", "CPF", "Cidade", "Faixa de Aluguel", "Valor Aluguel", "Status", "Origem"]
      : [
          "Primeiro Nome",
          "Nome",
          "Email",
          "Telefone",
          "Segmento",
          "Cidade",
          "Origem",
          "Status",
          "Mensagem Semanal",
        ];
    const rows = filteredContacts.map((contact) =>
      isConsultas
        ? [
            contact.first_name,
            contact.document ?? "",
            contact.city ?? "",
            contact.rent_range ?? "",
            contact.rent_value ? formatCurrency(contact.rent_value) : "",
            contact.source_status ?? "",
            contact.source_origin ?? "",
          ]
        : [
            contact.first_name,
            contact.full_name ?? "",
            contact.email ?? "",
            contact.phone ?? "",
            AUDIENCE_LABEL[contact.audience],
            contact.city ?? "",
            contact.source_origin ?? "",
            contact.source_status ?? "",
            contact.weekly_message_enabled ? "Sim" : "Nao",
          ],
    );
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${activeTab}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function saveCampaign() {
    if (!campaignDraft.name.trim()) {
      toast.error("Informe o nome da campanha.");
      return;
    }
    setSaving(true);
    try {
      const integration =
        integrations.find(
          (item) => item.provider === campaignDraft.provider && item.status === "ativo",
        ) ??
        integrations.find((item) => item.provider === campaignDraft.provider) ??
        null;
      const { error } = await supabase.from("marketing_campaigns" as any).insert({
        integration_id: integration?.id ?? null,
        provider: campaignDraft.provider,
        external_campaign_id: campaignDraft.external_campaign_id || null,
        name: campaignDraft.name.trim(),
        objective: campaignDraft.objective,
        audience: campaignDraft.audience,
        status: "rascunho",
        budget_daily: campaignDraft.budget_daily
          ? Number(String(campaignDraft.budget_daily).replace(",", "."))
          : null,
        landing_page_url: campaignDraft.landing_page_url || null,
        utm_source: campaignDraft.utm_source || null,
        utm_medium: campaignDraft.utm_medium || null,
        utm_campaign: campaignDraft.utm_campaign || slugify(campaignDraft.name),
        utm_content: campaignDraft.utm_content || null,
        utm_term: campaignDraft.utm_term || null,
        notes: campaignDraft.notes || null,
      });
      if (error) throw error;
      toast.success("Campanha criada como rascunho.");
      setCampaignDraft(emptyCampaign);
      await load();
    } catch (error: any) {
      toast.error("Nao foi possivel salvar a campanha: " + (error.message || "erro desconhecido"));
    } finally {
      setSaving(false);
    }
  }

  async function updateCampaignStatus(campaign: MarketingCampaign, status: string) {
    const { error } = await supabase
      .from("marketing_campaigns" as any)
      .update({ status })
      .eq("id", campaign.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setCampaigns((prev) =>
      prev.map((item) => (item.id === campaign.id ? { ...item, status } : item)),
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-yellow-100 p-2 text-yellow-700">
              <Megaphone className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight text-neutral-950">
                Leads Marketing
              </h1>
              <p className="text-sm font-medium text-neutral-500">
                Base semanal, leads de consulta e estrutura de Ads para crescimento rapido.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-2" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
            {activeTab !== "ads" && (
              <Button
                variant="outline"
                className="gap-2"
                onClick={exportCsv}
                disabled={loading || filteredContacts.length === 0}
              >
                <Download className="h-4 w-4" />
                Exportar
              </Button>
            )}
          </div>
        </header>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          <StatCard icon={Users} label="Contatos" value={stats.total} />
          <StatCard icon={Send} label="Com e-mail" value={stats.withEmail} />
          <StatCard icon={Target} label="Com telefone" value={stats.withPhone} />
          <StatCard icon={Search} label="Leads consulta" value={stats.consultas} />
          <StatCard icon={CheckCircle2} label="Fechados" value={stats.closedLeads} />
          <StatCard icon={Megaphone} label="Campanhas ativas" value={stats.activeCampaigns} />
          <StatCard icon={BarChart3} label="Investimento" value={formatCurrency(stats.spend)} />
        </div>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as Audience | "ads")}>
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <TabsList className="h-auto flex-wrap justify-start">
              <TabsTrigger value="leads">Leads</TabsTrigger>
              <TabsTrigger value="inquilinos">Inquilinos</TabsTrigger>
              <TabsTrigger value="corretores">Corretores</TabsTrigger>
              <TabsTrigger value="imobiliarias">Imobiliarias</TabsTrigger>
              <TabsTrigger value="leads_consulta">Leads Consulta</TabsTrigger>
              <TabsTrigger value="ads">Facebook + Google Ads</TabsTrigger>
            </TabsList>
            {activeTab !== "ads" && (
              <div className="relative w-full xl:w-80">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-400" />
                <Input
                  className="pl-9"
                  placeholder="Buscar contato..."
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
              </div>
            )}
          </div>

          <TabsContent value="leads" className="mt-5">
            <ContactsTable contacts={filteredContacts} loading={loading} />
          </TabsContent>
          <TabsContent value="inquilinos" className="mt-5">
            <ContactsTable contacts={filteredContacts} loading={loading} />
          </TabsContent>
          <TabsContent value="corretores" className="mt-5">
            <ContactsTable contacts={filteredContacts} loading={loading} />
          </TabsContent>
          <TabsContent value="imobiliarias" className="mt-5">
            <ContactsTable contacts={filteredContacts} loading={loading} />
          </TabsContent>
          <TabsContent value="leads_consulta" className="mt-5">
            <ConsultaLeadsTable contacts={filteredContacts} loading={loading} />
          </TabsContent>
          <TabsContent value="ads" className="mt-5">
            <AdsPanel
              integrations={integrations}
              campaigns={campaigns}
              metricsByCampaign={metricsByCampaign}
              draft={campaignDraft}
              setDraft={setCampaignDraft}
              saving={saving}
              onSave={saveCampaign}
              onStatusChange={updateCampaignStatus}
            />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function ContactsTable({ contacts, loading }: { contacts: MarketingContact[]; loading: boolean }) {
  return (
    <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Primeiro nome</TableHead>
            <TableHead>E-mail</TableHead>
            <TableHead>Telefone</TableHead>
            <TableHead>Segmento</TableHead>
            <TableHead>Cidade</TableHead>
            <TableHead>Origem</TableHead>
            <TableHead>Semanal</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={7} className="py-12 text-center text-neutral-400">
                Carregando base de marketing...
              </TableCell>
            </TableRow>
          ) : contacts.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-12 text-center text-neutral-400">
                Nenhum contato encontrado.
              </TableCell>
            </TableRow>
          ) : (
            contacts.map((contact) => (
              <TableRow key={contact.id}>
                <TableCell>
                  <p className="font-black text-neutral-950">{contact.first_name}</p>
                  <p className="text-xs text-neutral-500">{contact.full_name ?? "-"}</p>
                </TableCell>
                <TableCell className="text-sm text-neutral-700">{contact.email ?? "-"}</TableCell>
                <TableCell className="text-sm text-neutral-700">{contact.phone ?? "-"}</TableCell>
                <TableCell>
                  <AudienceBadge audience={contact.audience} />
                </TableCell>
                <TableCell className="text-sm text-neutral-600">{contact.city ?? "-"}</TableCell>
                <TableCell>
                  <p className="text-sm text-neutral-700">{contact.source_origin ?? "-"}</p>
                  <p className="text-xs text-neutral-400">{contact.source_status ?? ""}</p>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      contact.weekly_message_enabled
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-neutral-200 bg-neutral-50 text-neutral-500"
                    }
                  >
                    {contact.weekly_message_enabled ? "Ativo" : "Pausado"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </section>
  );
}

function ConsultaLeadsTable({
  contacts,
  loading,
}: {
  contacts: MarketingContact[];
  loading: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Primeiro nome</TableHead>
            <TableHead>CPF</TableHead>
            <TableHead>Cidade</TableHead>
            <TableHead>Faixa de aluguel</TableHead>
            <TableHead>Valor</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={6} className="py-12 text-center text-neutral-400">
                Carregando consultas...
              </TableCell>
            </TableRow>
          ) : contacts.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-12 text-center text-neutral-400">
                Nenhuma consulta encontrada.
              </TableCell>
            </TableRow>
          ) : (
            contacts.map((contact) => (
              <TableRow key={contact.id}>
                <TableCell className="font-black text-neutral-950">{contact.first_name}</TableCell>
                <TableCell className="text-sm text-neutral-700">
                  {contact.document ?? "-"}
                </TableCell>
                <TableCell className="text-sm text-neutral-700">{contact.city ?? "-"}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className="border-violet-200 bg-violet-50 text-violet-700"
                  >
                    {contact.rent_range ?? "Sem faixa"}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-neutral-700">
                  {contact.rent_value ? formatCurrency(contact.rent_value) : "-"}
                </TableCell>
                <TableCell className="text-sm text-neutral-500">
                  {contact.source_status ?? "-"}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </section>
  );
}

function AdsPanel({
  integrations,
  campaigns,
  metricsByCampaign,
  draft,
  setDraft,
  saving,
  onSave,
  onStatusChange,
}: {
  integrations: MarketingIntegration[];
  campaigns: MarketingCampaign[];
  metricsByCampaign: Map<string, CampaignMetric>;
  draft: typeof emptyCampaign;
  setDraft: (draft: typeof emptyCampaign) => void;
  saving: boolean;
  onSave: () => void;
  onStatusChange: (campaign: MarketingCampaign, status: string) => void;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
      <div className="space-y-6">
        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="font-black text-neutral-950">Conexoes de Ads</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Configure tokens no ambiente e mantenha aqui as contas que rodam campanhas.
          </p>
          <div className="mt-4 space-y-3">
            {integrations.length === 0 ? (
              <div className="rounded-lg border border-dashed border-neutral-200 p-4 text-sm text-neutral-500">
                Nenhuma conexao cadastrada.
              </div>
            ) : (
              integrations.map((integration) => (
                <div key={integration.id} className="rounded-lg border border-neutral-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-black text-neutral-950">
                        {PROVIDER_LABEL[integration.provider]}
                      </p>
                      <p className="text-sm text-neutral-600">{integration.account_name}</p>
                      <p className="mt-1 text-xs text-neutral-400">
                        Conta: {integration.account_id}
                      </p>
                    </div>
                    <StatusBadge status={integration.status} />
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-neutral-500 md:grid-cols-2">
                    <span>Token: {integration.token_secret_name ?? "nao informado"}</span>
                    <span>Ultima sync: {formatDateTime(integration.last_sync_at) || "-"}</span>
                    {integration.pixel_id && <span>Pixel: {integration.pixel_id}</span>}
                    {integration.customer_id && <span>Customer ID: {integration.customer_id}</span>}
                  </div>
                  {integration.last_error && (
                    <p className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 p-2 text-xs font-medium text-red-700">
                      <AlertCircle className="h-3.5 w-3.5" /> {integration.last_error}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="font-black text-neutral-950">Nova campanha</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Select
              value={draft.provider}
              onValueChange={(value) =>
                setDraft({
                  ...draft,
                  provider: value as Provider,
                  utm_source: value === "google" ? "google" : "facebook",
                  utm_medium: value === "google" ? "paid_search" : "paid_social",
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="meta">Facebook / Instagram</SelectItem>
                <SelectItem value="google">Google Ads</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={draft.audience}
              onValueChange={(value) => setDraft({ ...draft, audience: value as Audience })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="leads">Leads</SelectItem>
                <SelectItem value="inquilinos">Inquilinos</SelectItem>
                <SelectItem value="corretores">Corretores</SelectItem>
                <SelectItem value="imobiliarias">Imobiliarias</SelectItem>
                <SelectItem value="leads_consulta">Leads Consulta</SelectItem>
              </SelectContent>
            </Select>
            <Input
              className="md:col-span-2"
              placeholder="Nome da campanha"
              value={draft.name}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  name: event.target.value,
                  utm_campaign: draft.utm_campaign || slugify(event.target.value),
                })
              }
            />
            <Input
              className="md:col-span-2"
              placeholder="ID externo da campanha no Meta/Google Ads"
              value={draft.external_campaign_id}
              onChange={(event) => setDraft({ ...draft, external_campaign_id: event.target.value })}
            />
            <Input
              placeholder="Orcamento diario"
              value={draft.budget_daily}
              onChange={(event) => setDraft({ ...draft, budget_daily: event.target.value })}
            />
            <Input
              placeholder="Objetivo"
              value={draft.objective}
              onChange={(event) => setDraft({ ...draft, objective: event.target.value })}
            />
            <Input
              className="md:col-span-2"
              placeholder="URL de destino"
              value={draft.landing_page_url}
              onChange={(event) => setDraft({ ...draft, landing_page_url: event.target.value })}
            />
            <Input
              placeholder="utm_source"
              value={draft.utm_source}
              onChange={(event) => setDraft({ ...draft, utm_source: event.target.value })}
            />
            <Input
              placeholder="utm_medium"
              value={draft.utm_medium}
              onChange={(event) => setDraft({ ...draft, utm_medium: event.target.value })}
            />
            <Input
              placeholder="utm_campaign"
              value={draft.utm_campaign}
              onChange={(event) => setDraft({ ...draft, utm_campaign: event.target.value })}
            />
            <Input
              placeholder="utm_content"
              value={draft.utm_content}
              onChange={(event) => setDraft({ ...draft, utm_content: event.target.value })}
            />
            <Textarea
              className="md:col-span-2"
              placeholder="Notas de criativo, publico, oferta e proxima acao"
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />
          </div>
          <Button
            className="mt-4 w-full gap-2 bg-neutral-950 text-white hover:bg-neutral-800"
            onClick={onSave}
            disabled={saving}
          >
            <Plus className="h-4 w-4" />
            Criar campanha
          </Button>
        </section>
      </div>

      <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-100 p-5">
          <h2 className="font-black text-neutral-950">Campanhas e UTMs</h2>
          <p className="text-sm text-neutral-500">
            Use rascunho para preparar criativos, ativo para acompanhar investimento e conversoes.
          </p>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campanha</TableHead>
                <TableHead>Publico</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Metricas</TableHead>
                <TableHead className="text-right">Acoes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center text-neutral-400">
                    Nenhuma campanha criada.
                  </TableCell>
                </TableRow>
              ) : (
                campaigns.map((campaign) => {
                  const metric = metricsByCampaign.get(campaign.id);
                  const url = buildUtmUrl(campaign);
                  return (
                    <TableRow key={campaign.id}>
                      <TableCell>
                        <p className="font-black text-neutral-950">{campaign.name}</p>
                        <p className="text-xs text-neutral-500">
                          {PROVIDER_LABEL[campaign.provider]}
                        </p>
                        {url && (
                          <p className="mt-1 max-w-[280px] truncate text-xs text-neutral-400">
                            {url}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <AudienceBadge audience={campaign.audience} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={campaign.status} />
                      </TableCell>
                      <TableCell className="text-xs text-neutral-600">
                        <p>
                          {metric?.leads ?? 0} leads | {metric?.conversions ?? 0} conv.
                        </p>
                        <p>{formatCurrency(metric?.spend ?? 0)} investidos</p>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {url && (
                            <Button variant="ghost" size="sm" onClick={() => copyUrl(url)}>
                              <Copy className="h-4 w-4" />
                            </Button>
                          )}
                          <Select
                            value={campaign.status}
                            onValueChange={(value) => onStatusChange(campaign, value)}
                          >
                            <SelectTrigger className="h-8 w-28">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="rascunho">Rascunho</SelectItem>
                              <SelectItem value="ativo">Ativo</SelectItem>
                              <SelectItem value="pausado">Pausado</SelectItem>
                              <SelectItem value="encerrado">Encerrado</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: any;
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <Icon className="mb-3 h-4 w-4 text-neutral-400" />
      <p className="text-xs font-medium text-neutral-500">{label}</p>
      <p className="text-2xl font-black text-neutral-950 tabular-nums">{value}</p>
    </div>
  );
}

function AudienceBadge({ audience }: { audience: Audience }) {
  return (
    <Badge variant="outline" className={AUDIENCE_CLASS[audience]}>
      {AUDIENCE_LABEL[audience]}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const className =
    status === "ativo"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "erro"
        ? "border-red-200 bg-red-50 text-red-700"
        : status === "pausado" || status === "encerrado"
          ? "border-neutral-200 bg-neutral-50 text-neutral-600"
          : "border-yellow-200 bg-yellow-50 text-yellow-700";
  return (
    <Badge variant="outline" className={className}>
      {status}
    </Badge>
  );
}

function formatCurrency(value: number) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateTime(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildUtmUrl(campaign: MarketingCampaign) {
  if (!campaign.landing_page_url) return "";
  try {
    const url = new URL(campaign.landing_page_url);
    const params: Record<string, string | null> = {
      utm_source: campaign.utm_source,
      utm_medium: campaign.utm_medium,
      utm_campaign: campaign.utm_campaign,
      utm_content: campaign.utm_content,
      utm_term: campaign.utm_term,
    };
    Object.entries(params).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
    });
    return url.toString();
  } catch {
    return campaign.landing_page_url;
  }
}

async function copyUrl(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast.success("URL copiada.");
  } catch {
    toast.error("Nao foi possivel copiar a URL.");
  }
}
