import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { FecharLeadModal } from "@/components/interno/FecharLeadModal";
import { useAuth } from "@/components/AuthProvider";

export const Route = createFileRoute("/vendedor/pipeline")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin"]}>
      <Pipeline />
    </ProtectedRoute>
  ),
});

const COLUNAS = [
  { key: "novo", label: "Novo" },
  { key: "em_contato", label: "Primeiro contato" },
  { key: "qualificado", label: "Qualificado" },
  { key: "proposta_enviada", label: "Proposta enviada" },
  { key: "negociacao", label: "Negociação" },
  { key: "convertido", label: "Fechado" },
  { key: "perdido", label: "Perdido" },
];

function LeadCard({ lead }: { lead: any }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.5 : 1 } : undefined;
  return (
    <Card ref={setNodeRef} style={style} {...listeners} {...attributes} className="cursor-grab active:cursor-grabbing">
      <CardContent className="p-3">
        <p className="text-sm font-medium">{lead.full_name}</p>
        <p className="text-xs text-muted-foreground">{lead.phone ?? "—"}</p>
        {lead.origin && <p className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1">{lead.origin}</p>}
      </CardContent>
    </Card>
  );
}

function Coluna({ col, leads }: { col: typeof COLUNAS[0]; leads: any[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key });
  return (
    <div ref={setNodeRef} className={`bg-muted/40 rounded-lg p-3 min-h-[400px] transition-colors ${isOver ? "bg-primary/10 ring-2 ring-primary" : ""}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold uppercase">{col.label}</h3>
        <span className="text-xs text-muted-foreground">{leads.length}</span>
      </div>
      <div className="space-y-2">{leads.map((l) => <LeadCard key={l.id} lead={l} />)}</div>
    </div>
  );
}

function Pipeline() {
  const { user } = useAuth();
  const [leads, setLeads] = useState<any[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [modalLead, setModalLead] = useState<string | null>(null);
  const [sellerInternalId, setSellerInternalId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const carregar = async () => {
    const { data } = await supabase.from("sales_leads").select("*").order("created_at", { ascending: false });
    setLeads((data as any[]) ?? []);
  };

  useEffect(() => { carregar(); }, []);
  useEffect(() => {
    (async () => {
      if (!user?.email) return;
      const { data } = await supabase.from("internal_users" as any).select("id").eq("email", user.email).maybeSingle();
      setSellerInternalId((data as any)?.id ?? null);
    })();
  }, [user?.email]);

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const onDragEnd = async (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const leadId = String(active.id);
    const novoStatus = String(over.id);
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.status === novoStatus) return;

    if (novoStatus === "convertido") {
      setModalLead(leadId);
      return;
    }

    const anterior = lead.status;
    setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, status: novoStatus } : l));
    const { error } = await supabase.from("sales_leads").update({ status: novoStatus }).eq("id", leadId);
    if (error) {
      console.error("[pipeline] erro ao mover lead", error);
      setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, status: anterior } : l));
      toast.error("Não foi possível mover o lead");
    } else {
      toast.success("Lead movido");
    }
  };

  const activeLead = leads.find((l) => l.id === activeId);

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Pipeline Comercial</h1>
        <p className="text-sm text-muted-foreground">Arraste os cards entre as colunas. Ao mover para <strong>Fechado</strong>, vincule o contrato.</p>
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
            {COLUNAS.map((col) => (
              <Coluna key={col.key} col={col} leads={leads.filter((l) => l.status === col.key)} />
            ))}
          </div>
          <DragOverlay>{activeLead ? <LeadCard lead={activeLead} /> : null}</DragOverlay>
        </DndContext>
      </div>
      <FecharLeadModal
        open={!!modalLead}
        onOpenChange={(v) => !v && setModalLead(null)}
        leadId={modalLead}
        sellerInternalId={sellerInternalId}
        onSuccess={carregar}
      />
    </DashboardLayout>
  );
}
