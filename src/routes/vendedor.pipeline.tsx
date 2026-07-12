import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { FecharLeadModal } from "@/components/interno/FecharLeadModal";
import { RefreshCw, AlertCircle, ListChecks, Phone } from "lucide-react";
import { STATUS_PIPELINE, formatDateTime, getSellerContext, normalizeLeadStatus } from "@/lib/vendedor-portal";

export const Route = createFileRoute("/vendedor/pipeline")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin"]} moduleKey="pipeline">
      <Pipeline />
    </ProtectedRoute>
  ),
});

function LeadCard({ lead }: { lead: any }) {
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

function Coluna({ col, leads }: { col: typeof STATUS_PIPELINE[number]; leads: any[] }) {
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
  const [leads, setLeads] = useState<any[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [modalLead, setModalLead] = useState<string | null>(null);
  const [sellerInternalId, setSellerInternalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");

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
      setLeads(((data as any[]) ?? []).map((lead) => ({ ...lead, status: normalizeLeadStatus(lead.status) })));
    } catch (e: any) {
      setErro(e.message || "Não foi possível carregar o pipeline.");
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
      toast.success("Lead movido no pipeline.");
      await carregar();
    }
  };

  const activeLead = leads.find((lead) => lead.id === activeId);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-yellow-100 p-2 text-yellow-700">
              <ListChecks className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight text-neutral-950">Pipeline</h1>
              <p className="text-sm font-medium text-neutral-500">Arraste os leads entre etapas. Ao fechar, vincule uma apólice real.</p>
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

        {loading ? (
          <div className="rounded-2xl border border-neutral-200 bg-white p-12 text-center text-neutral-400">Carregando pipeline...</div>
        ) : !erro && leads.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-200 bg-white p-12 text-center">
            <p className="font-bold text-neutral-900">Nenhum lead no pipeline.</p>
            <p className="mt-1 text-sm text-neutral-500">Leads distribuídos para você aparecem aqui automaticamente.</p>
          </div>
        ) : (
          <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
              {STATUS_PIPELINE.map((col) => (
                <Coluna key={col.key} col={col} leads={leads.filter((lead) => normalizeLeadStatus(lead.status) === col.key)} />
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
