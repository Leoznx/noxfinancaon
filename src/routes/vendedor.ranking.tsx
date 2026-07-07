import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trophy } from "lucide-react";

export const Route = createFileRoute("/vendedor/ranking")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin", "financeiro"]}>
      <Ranking />
    </ProtectedRoute>
  ),
});

function Ranking() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const now = new Date();
      const { data } = await supabase.from("seller_performance" as any)
        .select("*, internal_users(full_name)")
        .eq("month", now.getMonth() + 1).eq("year", now.getFullYear())
        .order("contracts_activated", { ascending: false });
      setRows((data as any[]) ?? []);
    })();
  }, []);

  return (
    <DashboardLayout>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Trophy className="w-5 h-5 text-yellow-600" /> Ranking Comercial — mês atual</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem dados ainda neste mês.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>#</TableHead><TableHead>Vendedor</TableHead><TableHead>Ativados</TableHead><TableHead>Receita LTV</TableHead><TableHead>Comissão</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={r.id}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell>{r.internal_users?.full_name ?? "—"}</TableCell>
                    <TableCell>{r.contracts_activated}</TableCell>
                    <TableCell>R$ {Number(r.generated_revenue_ltv).toFixed(2)}</TableCell>
                    <TableCell>R$ {Number(r.commission_total).toFixed(2)}</TableCell>
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
