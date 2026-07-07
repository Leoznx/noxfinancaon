import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Trophy, Award, Medal, Gem, Settings, Save, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/configuracoes/niveis-comissao")({
  component: () => (
    <ProtectedRoute roles={["admin"]}>
      <ConfigNiveisComissao />
    </ProtectedRoute>
  ),
});

function ConfigNiveisComissao() {
  const niveis = [
    { nome: "Bronze", min: 0, max: 10, perc: 5, cor: "#CD7F32", icone: Medal },
    { nome: "Prata", min: 11, max: 20, perc: 7, cor: "#C0C0C0", icone: Award },
    { nome: "Ouro", min: 21, max: 30, perc: 9, cor: "#FFD700", icone: Trophy },
    { nome: "Diamante", min: 31, max: 999, perc: 12, cor: "#B9F2FF", icone: Gem },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black tracking-tight">Níveis de Comissão</h1>
            <p className="text-muted-foreground mt-1 font-medium">Configure as metas e percentuais do plano de carreira dos corretores.</p>
          </div>
          <Button className="bg-primary text-background font-black gap-2 h-12 rounded-2xl px-8">
            <Save size={20} />
            Salvar Alterações
          </Button>
        </div>

        <div className="bg-[#FACC15]/10 border border-[#FACC15]/20 p-4 rounded-2xl flex items-start gap-3">
          <AlertTriangle className="text-neutral-900 shrink-0" size={20} />
          <p className="text-xs text-neutral-900 font-medium">
            <strong>Atenção:</strong> Alterar as metas ou percentuais afetará apenas as novas comissões geradas a partir do salvamento. Comissões antigas mantêm o histórico original.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6">
          {niveis.map((n) => (
            <Card key={n.nome} className="bg-card border-zinc-800 rounded-3xl overflow-hidden">
              <CardContent className="p-0">
                <div className="flex flex-col lg:flex-row">
                  <div 
                    className="w-full lg:w-48 p-8 flex flex-col items-center justify-center gap-2 border-b lg:border-b-0 lg:border-r border-zinc-800"
                    style={{ backgroundColor: `${n.cor}05` }}
                  >
                    <n.icone size={48} style={{ color: n.cor }} />
                    <span className="font-black uppercase tracking-tighter" style={{ color: n.cor }}>{n.nome}</span>
                  </div>
                  
                  <div className="flex-1 p-8 grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Contratos Mínimos</label>
                      <Input type="number" defaultValue={n.min} className="bg-background border-zinc-800 h-12 font-bold" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Contratos Máximos</label>
                      <Input type="number" defaultValue={n.max} className="bg-background border-zinc-800 h-12 font-bold" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Comissão (%)</label>
                      <div className="relative">
                        <Input type="number" defaultValue={n.perc} className="bg-background border-zinc-800 h-12 font-bold pr-10" />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">%</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-8 flex items-center justify-center border-t lg:border-t-0 lg:border-l border-zinc-800 bg-zinc-900/30">
                    <Button variant="outline" className="border-zinc-800 text-xs font-bold gap-2">
                      <Settings size={16} />
                      Customizar Visual
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
