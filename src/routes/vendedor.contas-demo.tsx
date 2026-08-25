import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Clock3,
  CreditCard,
  Home,
  KeyRound,
  LockKeyhole,
  MousePointerClick,
  Search,
  ShieldCheck,
  UserRound,
  Users,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import {
  DEMO_CPF_SCENARIOS,
  DEMO_PROFILE_KEYS,
  DEMO_PROFILES,
  type DemoDecision,
  type DemoProfileKey,
} from "@/lib/demo-accounts";

export const Route = createFileRoute("/vendedor/contas-demo")({
  component: () => (
    <ProtectedRoute roles={["vendedor"]}>
      <DemoAccountsPage />
    </ProtectedRoute>
  ),
});

const PROFILE_PRESENTATION: Record<
  DemoProfileKey,
  {
    icon: LucideIcon;
    eyebrow: string;
    description: string;
    highlights: string[];
  }
> = {
  proprietario: {
    icon: Home,
    eyebrow: "Gestão do imóvel",
    description: "Consultas, contratos, faturas e sinistros pelo olhar do proprietário.",
    highlights: ["Consultas", "Contratos", "Sinistros"],
  },
  corretor: {
    icon: UserRound,
    eyebrow: "Operação comercial",
    description: "Simulação de crédito e jornada comercial completa do corretor parceiro.",
    highlights: ["Simulação", "Carteira", "Comissões"],
  },
  imobiliaria: {
    icon: Building2,
    eyebrow: "Gestão de carteira",
    description: "Equipe de corretores, contratos e cobrança consolidada da imobiliária.",
    highlights: ["Equipe", "Cobranças", "Contratos"],
  },
  inquilino: {
    icon: Users,
    eyebrow: "Jornada do locatário",
    description: "Documentos, faturas e acompanhamento do seguro pela visão do inquilino.",
    highlights: ["Seguro", "Documentos", "Faturas"],
  },
};

const SCENARIO_PRESENTATION: Record<
  DemoDecision,
  { icon: LucideIcon; iconClass: string; caption: string }
> = {
  aprovado: {
    icon: CheckCircle2,
    iconClass: "text-emerald-600",
    caption: "Crédito liberado",
  },
  recusado: {
    icon: XCircle,
    iconClass: "text-red-500",
    caption: "Crédito recusado",
  },
  pendente: {
    icon: Clock3,
    iconClass: "text-yellow-600",
    caption: "Em análise",
  },
};

const SCRIPT_STEPS: Array<{
  icon: LucideIcon;
  title: string;
  text: string;
}> = [
  {
    icon: MousePointerClick,
    title: "Escolha uma conta",
    text: "Abra a visão que combina com o cliente.",
  },
  {
    icon: Search,
    title: "Simule o crédito",
    text: "Use um dos CPFs demonstrativos abaixo.",
  },
  {
    icon: CreditCard,
    title: "Conclua o fluxo",
    text: "Avance até pagamento e contrato fake.",
  },
];

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
      <div className="mx-auto w-full max-w-[1260px] space-y-5 pb-10">
        <section className="grid overflow-hidden rounded-[26px] border border-neutral-200 bg-white shadow-[0_14px_42px_rgba(0,0,0,0.05)] lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="p-6 sm:p-8">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-500">
              <KeyRound className="h-4 w-4 text-yellow-600" /> Central de demonstração
            </div>
            <h1 className="mt-4 max-w-3xl text-3xl font-black leading-[1.02] tracking-[-0.045em] text-neutral-950 sm:text-4xl lg:text-[42px]">
              Entre no produto pelos olhos de cada cliente.
            </h1>
            <p className="mt-4 max-w-2xl text-sm font-medium leading-6 text-neutral-600">
              Escolha um perfil e apresente todo o fluxo sem cadastro ou consulta real.
            </p>
          </div>

          <div className="relative flex min-h-[150px] flex-col justify-between overflow-hidden border-t border-neutral-200 bg-yellow-300 p-6 lg:border-l lg:border-t-0">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-neutral-800">
                Acesso do vendedor
              </span>
              <ShieldCheck className="h-7 w-7 text-neutral-950" />
            </div>
            <div className="relative z-10 flex items-end gap-3">
              <span className="text-6xl font-black leading-none tracking-[-0.08em] text-neutral-950">4</span>
              <span className="max-w-[120px] pb-1 text-[11px] font-black uppercase leading-4 tracking-[0.12em] text-neutral-900">
                contas prontas
              </span>
            </div>
            <KeyRound className="absolute -bottom-7 -right-5 h-28 w-28 rotate-[-12deg] text-black/[0.06]" />
          </div>
        </section>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_310px]">
          <section className="overflow-hidden rounded-[24px] border border-neutral-200 bg-white shadow-sm">
            <div className="flex flex-col gap-2 border-b border-neutral-200 px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-yellow-700">
                  Contas disponíveis
                </p>
                <h2 className="mt-1.5 text-2xl font-black tracking-[-0.035em] text-neutral-950">
                  Escolha o perfil
                </h2>
              </div>
              <p className="max-w-[250px] text-xs font-semibold leading-5 text-neutral-500">
                Cada conta abre em uma nova aba.
              </p>
            </div>

            <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
              {DEMO_PROFILE_KEYS.map((profileKey) => {
                const profile = DEMO_PROFILES[profileKey];
                const presentation = PROFILE_PRESENTATION[profileKey];
                const Icon = presentation.icon;
                return (
                  <button
                    key={profileKey}
                    type="button"
                    onClick={() => openDemo(profileKey)}
                    className="group flex min-h-[290px] flex-col rounded-[22px] border border-neutral-200 bg-white p-5 text-left transition duration-200 hover:-translate-y-1 hover:border-yellow-400 hover:shadow-[0_16px_35px_rgba(0,0,0,0.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 sm:aspect-square"
                  >
                    <div className="flex items-center gap-4">
                      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border-2 border-neutral-900 bg-yellow-50 transition-colors group-hover:bg-yellow-300">
                        <Icon className="h-8 w-8 text-neutral-950" strokeWidth={1.7} />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-xl font-black tracking-[-0.025em] text-neutral-950">
                          {profile.label}
                        </h3>
                        <p className="mt-1 text-[9px] font-black uppercase tracking-[0.16em] text-yellow-700">
                          {presentation.eyebrow}
                        </p>
                      </div>
                    </div>

                    <p className="mt-5 text-sm font-medium leading-6 text-neutral-600">
                      {presentation.description}
                    </p>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {presentation.highlights.map((highlight) => (
                        <span
                          key={highlight}
                          className="rounded-full border border-neutral-200 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-neutral-500"
                        >
                          {highlight}
                        </span>
                      ))}
                    </div>

                    <span className="mt-auto flex items-center justify-between border-t border-neutral-200 pt-4 text-xs font-black text-neutral-950">
                      Entrar como {profile.label.toLowerCase()}
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-yellow-300 transition-transform group-hover:translate-x-1">
                        <ArrowUpRight className="h-4 w-4" />
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <aside className="overflow-hidden rounded-[24px] border border-neutral-200 bg-white text-neutral-950 shadow-sm lg:sticky lg:top-5">
            <div className="p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-yellow-700">
                    Roteiro rápido
                  </p>
                  <h2 className="mt-1.5 text-xl font-black tracking-[-0.03em]">
                    Apresente em 3 passos
                  </h2>
                </div>
                <KeyRound className="h-6 w-6 text-yellow-600" />
              </div>

              <div className="mt-4 space-y-2.5">
                {SCRIPT_STEPS.map((step) => {
                  const Icon = step.icon;
                  return (
                    <div
                      key={step.title}
                      className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-3"
                    >
                      <Icon className="h-5 w-5 shrink-0 text-yellow-700" strokeWidth={1.8} />
                      <div>
                        <p className="text-xs font-black text-neutral-950">{step.title}</p>
                        <p className="mt-0.5 text-[10px] font-medium leading-4 text-neutral-500">
                          {step.text}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-neutral-200 px-5 py-2">
              {DEMO_CPF_SCENARIOS.map((scenario) => {
                const presentation = SCENARIO_PRESENTATION[scenario.decision];
                const Icon = presentation.icon;
                return (
                  <div
                    key={scenario.cpf}
                    className="flex items-center gap-3 border-b border-neutral-200 py-3 last:border-b-0"
                  >
                    <Icon className={`h-5 w-5 ${presentation.iconClass}`} strokeWidth={1.8} />
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs font-black text-neutral-950">{scenario.cpf}</p>
                      <p className="mt-0.5 text-[9px] font-semibold text-neutral-500">
                        {presentation.caption}
                      </p>
                    </div>
                    <span className="text-[8px] font-black uppercase tracking-[0.1em] text-neutral-500">
                      {scenario.label}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2.5 border-t border-yellow-200 bg-yellow-50 p-4 text-neutral-950">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-[10px] font-bold leading-4">
                Ambiente isolado, sem consulta real ou registro no painel administrativo.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </DashboardLayout>
  );
}
