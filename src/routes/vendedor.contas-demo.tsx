import { createFileRoute } from "@tanstack/react-router";
import {
  Building2,
  ExternalLink,
  Home,
  KeyRound,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import {
  DEMO_CPF_SCENARIOS,
  DEMO_PROFILE_KEYS,
  DEMO_PROFILES,
  type DemoProfileKey,
} from "@/lib/demo-accounts";

export const Route = createFileRoute("/vendedor/contas-demo")({
  component: () => (
    <ProtectedRoute roles={["vendedor"]}>
      <DemoAccountsPage />
    </ProtectedRoute>
  ),
});

const PROFILE_ICONS: Record<DemoProfileKey, LucideIcon> = {
  proprietario: Home,
  corretor: UserRound,
  imobiliaria: Building2,
  inquilino: Users,
};

function DemoAccountsPage() {
  function openDemo(profile: DemoProfileKey) {
    const session =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.open(
      `/demo/${profile}?session=${encodeURIComponent(session)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-[1280px] space-y-6">
        <section className="overflow-hidden rounded-[28px] border border-yellow-300 bg-gradient-to-br from-yellow-300 via-yellow-400 to-amber-400 p-6 text-neutral-950 shadow-sm sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-neutral-950 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-yellow-300">
                <KeyRound className="h-3.5 w-3.5" /> Acesso exclusivo do vendedor
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-[-0.04em] sm:text-4xl">
                Contas demo
              </h1>
              <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-neutral-800 sm:text-base">
                Abra uma réplica fiel da conta original de cada perfil, com os mesmos menus, telas e
                recursos. Os dados de apresentação já ficam preenchidos automaticamente.
              </p>
            </div>
            <div className="grid h-20 w-20 shrink-0 place-items-center rounded-3xl border border-black/10 bg-white/70 shadow-sm">
              <ShieldCheck className="h-10 w-10" />
            </div>
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          {DEMO_PROFILE_KEYS.map((profileKey) => {
            const profile = DEMO_PROFILES[profileKey];
            const Icon = PROFILE_ICONS[profileKey];
            return (
              <article
                key={profileKey}
                className="group rounded-[24px] border border-neutral-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-yellow-400 hover:shadow-md sm:p-6"
              >
                <div className="flex items-start gap-4">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-neutral-950 text-yellow-300">
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-xl font-black text-neutral-950">{profile.label}</h2>
                      <span className="rounded-full bg-yellow-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-yellow-800">
                        João demo
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-neutral-600">{profile.description}</p>
                  </div>
                </div>
                <div className="mt-5 rounded-2xl border border-neutral-100 bg-neutral-50 p-4">
                  <p className="text-xs font-black uppercase tracking-wider text-neutral-500">
                    Recursos disponíveis
                  </p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-neutral-800">
                    Interface original do perfil, sem telas ou etapas criadas apenas para a
                    demonstração.
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={() => openDemo(profileKey)}
                  className="mt-5 h-12 w-full gap-2 rounded-xl bg-neutral-950 font-black text-yellow-300 hover:bg-neutral-800"
                >
                  Abrir conta {profile.label.toLowerCase()}
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </article>
            );
          })}
        </div>

        <section className="rounded-[24px] border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-yellow-600" />
            <div>
              <h2 className="font-black text-neutral-950">CPFs de demonstração</h2>
              <p className="mt-1 text-sm text-neutral-500">
                Use estes três cenários em qualquer uma das contas.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {DEMO_CPF_SCENARIOS.map((scenario) => (
              <div
                key={scenario.cpf}
                className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3"
              >
                <p className="font-mono text-sm font-black text-neutral-950">{scenario.cpf}</p>
                <p className="mt-1 text-xs font-bold text-neutral-500">
                  Resultado: {scenario.label}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs font-semibold leading-5 text-neutral-500">
            Os cenários são gravados somente nas contas demonstrativas e não acionam a análise de
            crédito real.
          </p>
        </section>
      </div>
    </DashboardLayout>
  );
}
