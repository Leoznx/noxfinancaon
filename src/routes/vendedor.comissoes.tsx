import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/vendedor/comissoes")({
  component: () => (
    <ProtectedRoute roles={["vendedor", "admin_master", "admin", "financeiro"]}>
      <Comissoes />
    </ProtectedRoute>
  ),
});

function Comissoes() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("seller_commissions" as any).select("*").order("created_at", { ascending: false });
      setRows((data as any[]) ?? []);
    })();
  }, []);

  return (
    <DashboardLayout>
      <Card>
        <CardHeader><CardTitle>Minhas Comissões</CardTitle></CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem comissões registradas. Comissão é gerada após a 1ª parcela paga.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Período</TableHead><TableHead>Comissão</TableHead><TableHead>Bônus</TableHead><TableHead>Retido</TableHead><TableHead>Liberado</TableHead><TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.month}/{r.year}</TableCell>
                    <TableCell>R$ {Number(r.commission_amount).toFixed(2)}</TableCell>
                    <TableCell>R$ {Number(r.bonus_amount).toFixed(2)}</TableCell>
                    <TableCell>R$ {Number(r.reserve_amount).toFixed(2)}</TableCell>
                    <TableCell>R$ {Number(r.released_amount).toFixed(2)}</TableCell>
                    <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
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
