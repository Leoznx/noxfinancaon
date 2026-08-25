import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Clock3,
  Home,
  KeyRound,
  LockKeyhole,
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
    index: string;
    icon: LucideIcon;
    eyebrow: string;
    description: string;
    highlights: string[];
  }
> = {
  proprietario: {
    index: "01",
    icon: Home,
    eyebrow: "Gestão do imóvel",
    description:
      "Acompanhe consultas, contratos ativos, faturas e sinistros pelo olhar do proprietário.",
    highlights: ["Consultas", "Contratos", "Sinistros"],
  },
  corretor: {
    index: "02",
    icon: UserRound,
    eyebrow: "Operação comercial",
    description:
      "Simule crédito e percorra a jornada comercial completa usada pelo corretor parceiro.",
    highlights: ["Simulação", "Carteira", "Comissões"],
  },
  imobiliaria: {
    index: "03",
    icon: Building2,
    eyebrow: "Gestão de carteira",
    description:
      "Explore a equipe de corretores, os contratos e a cobrança consolidada da imobiliária.",
    highlights: ["Equipe", "Cobranças", "Contratos"],
  },
  inquilino: {
    index: "04",
    icon: Users,
    eyebrow: "Jornada do locatário",
    description:
      "Confira documentos, faturas e o acompanhamento do seguro pela visão do inquilino.",
    highlights: ["Seguro", "Documentos", "Faturas"],
  },
};

const SCENARIO_PRESENTATION: Record<
  DemoDecision,
  { icon: LucideIcon; iconClass: string; caption: string }
> = {
  aprovado: {
    icon: CheckCircle2,
    iconClass: "text-emerald-400",
    caption: "Crédito liberado",
  },
  recusado: {
    icon: XCircle,
    iconClass: "text-red-400",
    caption: "Crédito não liberado",
  },
  pendente: {
    icon: Clock3,
    iconClass: "text-yellow-300",
    caption: "Análise demonstrativa",
  },
};

const HERO_FACTS = [
  ["04", "perfis reais"],
  ["01", "sessão isolada"],
  ["0", "consultas reais"],
] as const;

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
      <div className="mx-auto w-full max-w-[1360px] space-y-6 pb-10">
        <section className="overflow-hidden rounded-[30px] border border-neutral-200 bg-white shadow-[0_18px_55px_rgba(0,0,0,0.06)]">
          <div className="grid lg:grid-cols-[minmax(0,1.45fr)_minmax(310px,0.55fr)]">
            <div className="p-6 sm:p-9 lg:p-11">
              <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-neutral-500">
                <KeyRound className="h-4 w-4 text-yellow-500" /> Central de demonstração
              </div>
              <h1 className="mt-6 max-w-4xl text-4xl font-black leading-[0.98] tracking-[-0.055em] text-neutral-950 sm:text-5xl lg:text-[58px]">
                Entre no produto pelos olhos de
                <span className="ml-2 box-decoration-clone bg-yellow-300 px-2">cada cliente.</span>
              </h1>
              <p className="mt-6 max-w-2xl text-sm font-medium leading-7 text-neutral-600 sm:text-base">
                Quatro pontos de vista, o mesmo produto real. Escolha um ambiente e conduza a
                apresentação sem cadastro, preparação ou risco de acionar uma consulta verdadeira.
              </p>
            </div>

            <div className="relative flex min-h-[250px] flex-col justify-between overflow-hidden border-t border-neutral-200 bg-yellow-300 p-7 lg:border-l lg:border-t-0 lg:p-9">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-[0.2em] text-neutral-800">
                  Acesso do vendedor
                </span>
                <ShieldCheck className="h-8 w-8 text-neutral-950" />
              </div>
              <div>
                <p className="text-[92px] font-black leading-[0.72] tracking-[-0.09em] text-neutral-950 sm:text-[112px]">
                  04
                </p>
                <p className="mt-5 max-w-[230px] text-sm font-black uppercase leading-5 tracking-[0.13em] text-neutral-900">
                  ambientes prontos para apresentar
                </p>
              </div>
              <KeyRound className="absolute -bottom-8 -right-6 h-36 w-36 rotate-[-12deg] text-black/[0.07]" />
            </div>
          </div>

          <div className="grid divide-y divide-white/15 bg-neutral-950 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {HERO_FACTS.map(([value, label]) => (
              <div key={label} className="flex items-baseline gap-3 px-6 py-4 sm:px-8">
                <span className="text-2xl font-black tracking-[-0.04em] text-yellow-300">{value}</span>
                <span className="text-[10px] font-black uppercase tracking-[0.16em] text-white/65">
                  {label}
                </span>
              </div>
            ))}
          </div>
        </section>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(330px,0.65fr)]">
          <section className="overflow-hidden rounded-[26px] border border-neutral-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-neutral-200 px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-7">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-yellow-600">
                  Ambientes disponíveis
                </p>
                <h2 className="mt-2 text-2xl font-black tracking-[-0.035em] text-neutral-950">
                  Escolha o ponto de vista
                </h2>
              </div>
              <p className="max-w-xs text-xs font-semibold leading-5 text-neutral-500">
                Cada acesso abre em uma nova aba e preserva sua sessão de vendedor.
              </p>
            </div>

            <div className="divide-y divide-neutral-200">
              {DEMO_PROFILE_KEYS.map((profileKey) => {
                const profile = DEMO_PROFILES[profileKey];
                const presentation = PROFILE_PRESENTATION[profileKey];
                const Icon = presentation.icon;
                return (
                  <article
                    key={profileKey}
                    className="group grid gap-5 px-5 py-6 transition-colors hover:bg-yellow-50 sm:grid-cols-[64px_minmax(0,1fr)_auto] sm:items-center sm:px-7"
                  >
                    <div className="flex items-center gap-4 sm:block">
                      <span className="block text-4xl font-black tracking-[-0.06em] text-neutral-200 transition-colors group-hover:text-yellow-400">
                        {presentation.index}
                      </span>
                      <Icon className="mt-0 h-7 w-7 text-neutral-950 sm:mt-3" strokeWidth={1.8} />
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <h3 className="text-xl font-black tracking-[-0.025em] text-neutral-950">
                          {profile.label}
                        </h3>
                        <span className="text-[9px] font-black uppercase tracking-[0.18em] text-yellow-700">
                          Persona João
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] font-black uppercase tracking-[0.17em] text-neutral-400">
                        {presentation.eyebrow}
                      </p>
                      <p className="mt-3 max-w-xl text-sm font-medium leading-6 text-neutral-600">
                        {presentation.description}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-black uppercase tracking-[0.12em] text-neutral-500">
                        {presentation.highlights.map((highlight, index) => (
                          <span key={highlight} className="flex items-center gap-3">
                            {index > 0 && <span className="h-1 w-1 rounded-full bg-yellow-400" />}
                            {highlight}
                          </span>
                        ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => openDemo(profileKey)}
                      className="flex h-12 items-center justify-center gap-3 rounded-xl bg-neutral-950 px-5 text-xs font-black text-white transition hover:bg-yellow-400 hover:text-neutral-950 sm:min-w-[150px]"
                    >
                      Entrar como {profile.label.toLowerCase()}
                      <ArrowUpRight className="h-4 w-4" />
                    </button>
                  </article>
                );
              })}
            </div>
          </section>

          <aside className="overflow-hidden rounded-[26px] bg-neutral-950 text-white shadow-sm lg:sticky lg:top-6">
            <div className="p-6 sm:p-7">
              <div className="flex items-center justify-between gap-4">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-yellow-300">
                  Roteiro de apresentação
                </p>
                <KeyRound className="h-6 w-6 text-yellow-300" />
              </div>
              <h2 className="mt-4 text-2xl font-black leading-tight tracking-[-0.035em]">
                Mostre o fluxo completo em três movimentos.
              </h2>

              <ol className="mt-7 space-y-5">
                {[
                  ["01", "Escolha o perfil que mais se aproxima do cliente."],
                  ["02", "Rode um dos CPFs abaixo na simulação de crédito."],
                  ["03", "Avance pelo plano, dados e pagamento demonstrativo."],
                ].map(([step, text]) => (
                  <li key={step} className="grid grid-cols-[34px_1fr] gap-3">
                    <span className="text-sm font-black text-yellow-300">{step}</span>
                    <p className="text-sm font-medium leading-6 text-white/72">{text}</p>
                  </li>
                ))}
              </ol>
            </div>

            <div className="border-y border-white/15 px-6 sm:px-7">
              {DEMO_CPF_SCENARIOS.map((scenario) => {
                const presentation = SCENARIO_PRESENTATION[scenario.decision];
                const Icon = presentation.icon;
                return (
                  <div
                    key={scenario.cpf}
                    className="grid grid-cols-[24px_1fr_auto] items-center gap-3 border-b border-white/10 py-4 last:border-b-0"
                  >
                    <Icon className={`h-5 w-5 ${presentation.iconClass}`} strokeWidth={1.8} />
                    <div>
                      <p className="font-mono text-sm font-black text-white">{scenario.cpf}</p>
                      <p className="mt-0.5 text-[10px] font-semibold text-white/45">
                        {presentation.caption}
                      </p>
                    </div>
                    <span className="text-[9px] font-black uppercase tracking-[0.14em] text-white/60">
                      {scenario.label}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-3 bg-yellow-300 p-5 text-neutral-950 sm:px-7">
              <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0" />
              <p className="text-xs font-bold leading-5">
                Sessões isoladas: nenhum cenário aciona a análise de crédito real ou aparece para o
                administrador.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </DashboardLayout>
  );
}
