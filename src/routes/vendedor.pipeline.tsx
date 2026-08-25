import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { FecharLeadModal } from "@/components/interno/FecharLeadModal";
import { RefreshCw, AlertCircle, ListChecks, Phone, Search, X } from "lucide-react";
import { STATUS_PIPELINE, formatDateTime, getSellerContext, normalizeLeadStatus } from "@/lib/vendedor-portal";

type PipelineLead = {
  id: string;
  full_name?: string | null;
  phone?: string | null;
  origin?: string | null;
  status?: string | null;
  updated_at?: string | null;
  assigned_seller_id?: string | null;
  converted_consulta_id?: string | null;
  search_document?: string | null;
  cpf?: string | null;
  documento?: string | null;
  tenant_document?: string | null;
};

export const Route = createFileRoute("/vendedor/pipeline")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin"]} moduleKey="pipeline">
      <Pipeline />
    </ProtectedRoute>
  ),
});

function LeadCard({ lead }: { lead: PipelineLead }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.5 : 1 } : undefined;

  return (
    <Card ref={setNodeRef} style={style} {...listeners} {...attributes} className="cursor-grab border-neutral-200 bg-white active:cursor-grabbing">
      <CardContent className="space-y-2 p-3">
        <p className="line-clamp-2 text-sm font-bold text-neutral-950">{lead.full_name}</p>
        <div className="flex items-center gap-1 text-xs text-neutral-500">
          <Phone className="h-3 w-3" />
          <span>{lead.phone || "Sem telefone"}</span>
        </div>
        {lead.origin && <Badge variant="outline" className="text-[10px]">{lead.origin}</Badge>}
        <p className="text-[10px] font-medium text-neutral-400">Atualizado: {formatDateTime(lead.updated_at) || "-"}</p>
      </CardContent>
    </Card>
  );
}

function Coluna({ col, leads }: { col: typeof STATUS_PIPELINE[number]; leads: PipelineLead[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key });

  return (
    <div ref={setNodeRef} className={`min-h-[360px] rounded-xl border p-3 transition-colors ${isOver ? "border-yellow-300 bg-yellow-50" : "border-neutral-200 bg-neutral-50"}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-xs font-black uppercase tracking-wider text-neutral-700">{col.label}</h3>
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-neutral-500">{leads.length}</span>
      </div>
      <div className="space-y-2">
        {leads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-200 bg-white p-4 text-center text-xs text-neutral-400">Sem leads</div>
        ) : (
          leads.map((lead) => <LeadCard key={lead.id} lead={lead} />)
        )}
      </div>
    </div>
  );
}

function Pipeline() {
  const [leads, setLeads] = useState<PipelineLead[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [modalLead, setModalLead] = useState<string | null>(null);
  const [sellerInternalId, setSellerInternalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState("todos");

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const carregar = async () => {
    setLoading(true);
    setErro("");

    try {
      const context = await getSellerContext();
      setSellerInternalId(context.sellerId);

      let query = supabase
        .from("sales_leads" as any)
        .select("*")
        .order("updated_at", { ascending: false });

      if (context.isSeller) {
        query = query.eq("assigned_seller_id", context.sellerId);
      }

      const { data, error } = await query;
      if (error) throw error;
      const normalizedLeads = ((data as unknown as PipelineLead[]) ?? []).map((lead) => ({
        ...lead,
        status: normalizeLeadStatus(lead.status),
      }));
      const consultaIds = Array.from(
        new Set(
          normalizedLeads
            .map((lead) => lead.converted_consulta_id)
            .filter((id): id is string => Boolean(id)),
        ),
      );
      const documentsByConsulta = new Map<string, string>();

      if (consultaIds.length > 0) {
        const { data: consultas } = await supabase
          .from("consultas_credito" as any)
          .select("id, documento, documento_masked, tenant_document")
          .in("id", consultaIds);

        for (const consulta of (consultas as any[]) ?? []) {
          const document = consulta.documento || consulta.tenant_document || consulta.documento_masked;
          if (document) documentsByConsulta.set(String(consulta.id), String(document));
        }
      }

      setLeads(
        normalizedLeads.map((lead) => ({
          ...lead,
          search_document:
            lead.search_document ||
            lead.cpf ||
            lead.documento ||
            lead.tenant_document ||
            (lead.converted_consulta_id
              ? documentsByConsulta.get(lead.converted_consulta_id) ?? null
              : null),
        })),
      );
    } catch (e: any) {
      setErro(e.message || "Não foi possível carregar os atendimentos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { carregar(); }, []);

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const onDragEnd = async (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const leadId = String(active.id);
    const novoStatus = String(over.id);
    const lead = leads.find((item) => item.id === leadId);
    if (!lead || lead.status === novoStatus) return;

    if (novoStatus === "convertido") {
      setModalLead(leadId);
      return;
    }

    const anterior = lead.status;
    setLeads((prev) => prev.map((item) => item.id === leadId ? { ...item, status: novoStatus } : item));
    const { error } = await supabase
      .from("sales_leads" as any)
      .update({ status: novoStatus, last_interaction_at: new Date().toISOString() })
      .eq("id", leadId);

    if (error) {
      setLeads((prev) => prev.map((item) => item.id === leadId ? { ...item, status: anterior } : item));
      toast.error(error.message || "Não foi possível mover o lead.");
    } else {
      toast.success("Status do atendimento atualizado.");
      await carregar();
    }
  };

  const activeLead = leads.find((lead) => lead.id === activeId);
  const normalizedSearch = normalizeSearch(busca);
  const filteredLeads = useMemo(
    () =>
      leads.filter((lead) => {
        const statusMatches =
          statusFiltro === "todos" || normalizeLeadStatus(lead.status) === statusFiltro;
        return statusMatches && leadMatchesSearch(lead, normalizedSearch);
      }),
    [leads, normalizedSearch, statusFiltro],
  );
  const hasFilters = Boolean(busca.trim()) || statusFiltro !== "todos";

  const clearFilters = () => {
    setBusca("");
    setStatusFiltro("todos");
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-yellow-100 p-2 text-yellow-700">
              <ListChecks className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight text-neutral-950">Atendimento</h1>
              <p className="text-sm font-medium text-neutral-500">Encontre seus clientes e organize cada atendimento por status.</p>
            </div>
          </div>
          <Button variant="outline" className="gap-2" onClick={carregar} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>

        {erro && (
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        <div className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm sm:p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(280px,1fr)_240px_auto] lg:items-center">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <Input
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
                placeholder="Buscar por nome, telefone ou CPF..."
                aria-label="Buscar atendimento por nome, telefone ou CPF"
                className="h-11 pl-9 pr-10"
              />
              {busca && (
                <button
                  type="button"
                  onClick={() => setBusca("")}
                  aria-label="Limpar busca"
                  className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Select value={statusFiltro} onValueChange={setStatusFiltro}>
              <SelectTrigger className="h-11 bg-white" aria-label="Filtrar atendimentos por status">
                <SelectValue placeholder="Todos os status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                {STATUS_PIPELINE.map((status) => (
                  <SelectItem key={status.key} value={status.key}>
                    {status.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center justify-between gap-3 lg:justify-end">
              <span className="whitespace-nowrap text-xs font-semibold text-neutral-500">
                {filteredLeads.length} de {leads.length} atendimentos
              </span>
              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 px-2 text-xs">
                  Limpar filtros
                </Button>
              )}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-neutral-200 bg-white p-12 text-center text-neutral-400">Carregando atendimentos...</div>
        ) : !erro && leads.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-200 bg-white p-12 text-center">
            <p className="font-bold text-neutral-900">Nenhum atendimento disponível.</p>
            <p className="mt-1 text-sm text-neutral-500">Leads distribuídos para você aparecem aqui automaticamente.</p>
          </div>
        ) : !erro && filteredLeads.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-200 bg-white p-12 text-center">
            <p className="font-bold text-neutral-900">Nenhum atendimento encontrado.</p>
            <p className="mt-1 text-sm text-neutral-500">Tente outro nome, telefone, CPF ou status.</p>
            <Button variant="outline" size="sm" onClick={clearFilters} className="mt-4">
              Limpar filtros
            </Button>
          </div>
        ) : (
          <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
              {STATUS_PIPELINE.map((col) => (
                <Coluna key={col.key} col={col} leads={filteredLeads.filter((lead) => normalizeLeadStatus(lead.status) === col.key)} />
              ))}
            </div>
            <DragOverlay>{activeLead ? <LeadCard lead={activeLead} /> : null}</DragOverlay>
          </DndContext>
        )}
      </div>

      <FecharLeadModal
        open={!!modalLead}
        onOpenChange={(open) => !open && setModalLead(null)}
        leadId={modalLead}
        sellerInternalId={sellerInternalId ?? leads.find((lead) => lead.id === modalLead)?.assigned_seller_id ?? null}
        onSuccess={carregar}
      />
    </DashboardLayout>
  );
}

function normalizeSearch(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function leadMatchesSearch(lead: PipelineLead, normalizedSearch: string) {
  if (!normalizedSearch) return true;
  return [
    lead.full_name,
    lead.phone,
    lead.search_document,
    lead.cpf,
    lead.documento,
    lead.tenant_document,
  ].some((value) => normalizeSearch(value).includes(normalizedSearch));
}
