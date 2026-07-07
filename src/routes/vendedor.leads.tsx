import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/vendedor/leads")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin"]}>
      <MeusLeads />
    </ProtectedRoute>
  ),
});

const STATUS_COLOR: Record<string, string> = {
  novo: "bg-blue-100 text-blue-800",
  em_contato: "bg-yellow-100 text-yellow-800",
  qualificado: "bg-purple-100 text-purple-800",
  proposta_enviada: "bg-indigo-100 text-indigo-800",
  negociacao: "bg-orange-100 text-orange-800",
  convertido: "bg-green-100 text-green-800",
  perdido: "bg-red-100 text-red-800",
};

function MeusLeads() {
  const [leads, setLeads] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("sales_leads" as any).select("*").order("created_at", { ascending: false });
      setLeads((data as any[]) ?? []);
    })();
  }, []);

  return (
    <DashboardLayout>
      <Card>
        <CardHeader><CardTitle>Meus Leads</CardTitle></CardHeader>
        <CardContent>
          {leads.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum lead atribuído ainda. O Marketing vai distribuir leads para você.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead><TableHead>Telefone</TableHead><TableHead>Origem</TableHead><TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.full_name}</TableCell>
                    <TableCell>{l.phone ?? "-"}</TableCell>
                    <TableCell>{l.origin ?? "-"}</TableCell>
                    <TableCell><Badge className={STATUS_COLOR[l.status] ?? ""}>{l.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
