import { createFileRoute } from "@tanstack/react-router";
import { PhoneCall } from "lucide-react";

import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { SellerContactLeadsPanel } from "@/components/seller-clients/SellerContactLeadsPanel";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/vendedor/leads-do-dia")({
  component: () => (
    <ProtectedRoute roles={["vendedor"]} sellerTypes={["sdr", "closer"]}>
      <SellerDailyLeadsPage />
    </ProtectedRoute>
  ),
});

function SellerDailyLeadsPage() {
  return (
    <DashboardLayout>
      <main className="space-y-5 pb-6">
        <section className="relative overflow-hidden rounded-[28px] bg-neutral-950 p-6 text-white shadow-xl sm:p-8">
          <div className="absolute -right-16 -top-16 h-52 w-52 rounded-full bg-violet-500/25 blur-3xl" />
          <div className="relative">
            <Badge className="border-0 bg-violet-500 px-3 py-1.5 font-black text-white hover:bg-violet-500">
              <PhoneCall className="mr-1.5 h-4 w-4" /> Leads do dia
            </Badge>
            <h1 className="mt-4 text-3xl font-black tracking-[-0.04em] sm:text-4xl">
              Seus contatos em uma <span className="text-violet-400">carteira inteligente.</span>
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-300 sm:text-base">
              Cadastre nome e telefone, acompanhe os lembretes automáticos e consulte o histórico de cada lead.
            </p>
          </div>
        </section>

        <SellerContactLeadsPanel />
      </main>
    </DashboardLayout>
  );
}
