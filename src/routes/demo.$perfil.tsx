import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Banknote,
  Check,
  CheckCircle2,
  CircleUserRound,
  Clock3,
  CreditCard,
  FileCheck2,
  FileSignature,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  QrCode,
  ReceiptText,
  Search,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { LogoNox } from "@/components/LogoNox";
import {
  DEMO_CPF_SCENARIOS,
  DEMO_PLANS,
  DEMO_PROFILES,
  getDemoDecision,
  isDemoProfileKey,
  maskDemoCpf,
  type DemoDecision,
  type DemoProfileKey,
} from "@/lib/demo-accounts";

export const Route = createFileRoute("/demo/$perfil")({
  component: DemoRoute,
});

type DemoStep = "inicio" | "consulta" | "resultado" | "dados" | "pagamento" | "contrato";
type PaymentMethod = "pix" | "boleto" | "cartao";

type PersistedDemoState = {
  step: DemoStep;
  cpf: string;
  decision: DemoDecision | null;
  planId: string | null;
  paymentMethod: PaymentMethod;
  signed: boolean;
};

const DEFAULT_STATE: PersistedDemoState = {
  step: "inicio",
  cpf: "",
  decision: null,
  planId: null,
  paymentMethod: "pix",
  signed: false,
};

const STEP_ORDER: DemoStep[] = ["consulta", "resultado", "dados", "pagamento", "contrato"];
const STEP_LABELS: Record<DemoStep, string> = {
  inicio: "Início",
  consulta: "Consulta",
  resultado: "Resultado e plano",
  dados: "Dados",
  pagamento: "Pagamento",
  contrato: "Contrato",
};

function DemoRoute() {
  const { perfil } = Route.useParams();

  if (!isDemoProfileKey(perfil)) {
    return (
      <main className="grid min-h-screen place-items-center bg-neutral-100 p-6">
        <div className="max-w-md rounded-3xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
          <AlertTriangle className="mx-auto h-10 w-10 text-yellow-500" />
          <h1 className="mt-4 text-2xl font-black text-neutral-950">Conta demo inválida</h1>
          <p className="mt-2 text-sm leading-6 text-neutral-500">Volte ao portal do vendedor e escolha um dos quatro perfis disponíveis.</p>
          <button className="mt-6 rounded-xl bg-neutral-950 px-5 py-3 text-sm font-black text-yellow-300" onClick={() => window.close()}>
            Fechar aba
          </button>
        </div>
      </main>
    );
  }

  return <DemoExperience profileKey={perfil} />;
}

function DemoExperience({ profileKey }: { profileKey: DemoProfileKey }) {
  const profile = DEMO_PROFILES[profileKey];
  const [state, setState] = useState<PersistedDemoState>(DEFAULT_STATE);
  const [loaded, setLoaded] = useState(false);
  const [cpfError, setCpfError] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const sessionKey = useMemo(() => {
    if (typeof window === "undefined") return `nox-demo:${profileKey}:preview`;
    const session = new URLSearchParams(window.location.search).get("session") || "preview";
    return `nox-demo:${profileKey}:${session}`;
  }, [profileKey]);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(sessionKey);
      if (raw) setState({ ...DEFAULT_STATE, ...(JSON.parse(raw) as PersistedDemoState) });
    } catch {
      // A demonstração continua em memória quando o navegador bloqueia o storage.
    }
    setLoaded(true);
  }, [sessionKey]);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.sessionStorage.setItem(sessionKey, JSON.stringify(state));
    } catch {
      // Sem persistência, mas sem interromper a apresentação.
    }
  }, [loaded, sessionKey, state]);

  const selectedPlan = DEMO_PLANS.find((plan) => plan.id === state.planId) ?? null;

  function update(patch: Partial<PersistedDemoState>) {
    setState((current) => ({ ...current, ...patch }));
  }

  function startConsultation() {
    update({ step: "consulta", decision: null, planId: null, signed: false });
    setCpfError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function simulateConsultation() {
    const decision = getDemoDecision(state.cpf);
    if (!decision) {
      setCpfError("Use um dos CPFs de demonstração: 999, 888 ou 000.");
      return;
    }
    setCpfError("");
    update({ decision, step: "resultado", planId: null });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetDemo() {
    setState(DEFAULT_STATE);
    setCpfError("");
    try {
      window.sessionStorage.removeItem(sessionKey);
    } catch {}
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const visibleStepIndex = state.step === "inicio" ? -1 : STEP_ORDER.indexOf(state.step);

  return (
    <div className="min-h-screen bg-[#f7f7f5] text-neutral-950 lg:grid lg:grid-cols-[250px_minmax(0,1fr)]">
      <aside className={`${mobileMenuOpen ? "flex" : "hidden"} fixed inset-0 z-40 flex-col bg-neutral-950 text-white lg:sticky lg:top-0 lg:flex lg:h-screen`}>
        <div className="flex h-[82px] items-center justify-between border-b border-white/10 px-6">
          <LogoNox variant="escuro" size="sm" />
          <button className="rounded-lg p-2 text-neutral-400 lg:hidden" onClick={() => setMobileMenuOpen(false)} aria-label="Fechar menu">
            <XCircle className="h-6 w-6" />
          </button>
        </div>
        <div className="border-b border-white/10 p-5">
          <div className="rounded-2xl border border-yellow-400/30 bg-yellow-400/10 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-yellow-300">Ambiente demo</p>
            <p className="mt-1 font-black text-white">{profile.label}</p>
            <p className="mt-1 text-xs leading-5 text-neutral-400">Nenhuma ação é real.</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          {profile.menu.map((item, index) => {
            const active = index === 0 && state.step === "inicio";
            return (
              <button
                key={item}
                type="button"
                onClick={() => {
                  if (index === 1 || item.includes("Consulta") || item.includes("Contratar")) startConsultation();
                  else update({ step: "inicio" });
                  setMobileMenuOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-bold transition ${active ? "bg-yellow-400 text-neutral-950" : "text-neutral-400 hover:bg-white/5 hover:text-white"}`}
              >
                {index === 0 ? <LayoutDashboard className="h-4 w-4" /> : index === 1 ? <Search className="h-4 w-4" /> : <ReceiptText className="h-4 w-4" />}
                {item}
              </button>
            );
          })}
        </nav>
        <div className="border-t border-white/10 p-4">
          <button type="button" onClick={resetDemo} className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-neutral-300 hover:bg-white/5">
            Reiniciar demonstração
          </button>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-[66px] items-center justify-between border-b border-neutral-200 bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button className="rounded-xl border border-neutral-200 p-2 lg:hidden" onClick={() => setMobileMenuOpen(true)} aria-label="Abrir menu">
              <Menu className="h-5 w-5" />
            </button>
            <p className="hidden text-sm text-neutral-500 sm:block">Bem-vindo, <strong className="text-neutral-950">{profile.accountName}</strong></p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-yellow-300 bg-yellow-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-yellow-800">Demo segura</span>
            <div className="grid h-9 w-9 place-items-center rounded-full bg-neutral-950 text-yellow-300"><CircleUserRound className="h-5 w-5" /></div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1320px] p-4 sm:p-6 lg:p-8">
          {state.step !== "inicio" && (
            <div className="mb-5 overflow-x-auto rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
              <div className="flex min-w-[680px] items-center">
                {STEP_ORDER.map((step, index) => {
                  const complete = index < visibleStepIndex;
                  const active = index === visibleStepIndex;
                  return (
                    <div key={step} className="flex flex-1 items-center last:flex-none">
                      <div className="flex items-center gap-2">
                        <div className={`grid h-8 w-8 place-items-center rounded-full text-xs font-black ${complete ? "bg-emerald-600 text-white" : active ? "bg-yellow-400 text-neutral-950" : "bg-neutral-100 text-neutral-400"}`}>
                          {complete ? <Check className="h-4 w-4" /> : index + 1}
                        </div>
                        <span className={`text-xs font-black ${active ? "text-neutral-950" : "text-neutral-400"}`}>{STEP_LABELS[step]}</span>
                      </div>
                      {index < STEP_ORDER.length - 1 && <div className={`mx-3 h-px flex-1 ${index < visibleStepIndex ? "bg-emerald-500" : "bg-neutral-200"}`} />}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {state.step === "inicio" && <DemoHome profileKey={profileKey} onStart={startConsultation} />}
          {state.step === "consulta" && (
            <ConsultationStep
              cpf={state.cpf}
              error={cpfError}
              onCpfChange={(cpf) => update({ cpf: maskDemoCpf(cpf) })}
              onSelectCpf={(cpf) => { update({ cpf }); setCpfError(""); }}
              onSubmit={simulateConsultation}
              onBack={() => update({ step: "inicio" })}
            />
          )}
          {state.step === "resultado" && state.decision && (
            <ResultStep
              decision={state.decision}
              cpf={state.cpf}
              selectedPlanId={state.planId}
              onSelectPlan={(planId) => update({ planId })}
              onContinue={() => update({ step: "dados" })}
              onTryAgain={startConsultation}
            />
          )}
          {state.step === "dados" && selectedPlan && (
            <DataStep
              pending={state.decision === "pendente"}
              onBack={() => update({ step: "resultado" })}
              onContinue={() => update({ step: "pagamento" })}
            />
          )}
          {state.step === "pagamento" && selectedPlan && (
            <PaymentStep
              plan={selectedPlan}
              method={state.paymentMethod}
              onMethodChange={(paymentMethod) => update({ paymentMethod })}
              onBack={() => update({ step: "dados" })}
              onPay={() => update({ step: "contrato", signed: false })}
            />
          )}
          {state.step === "contrato" && selectedPlan && (
            <ContractStep
              planName={selectedPlan.name}
              signed={state.signed}
              onSign={() => update({ signed: true })}
              onReset={resetDemo}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function DemoHome({ profileKey, onStart }: { profileKey: DemoProfileKey; onStart: () => void }) {
  const profile = DEMO_PROFILES[profileKey];
  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-[28px] border border-yellow-300 bg-gradient-to-br from-yellow-300 via-yellow-400 to-amber-400 p-6 shadow-sm sm:p-8">
        <div className="relative z-10 max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full bg-neutral-950 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-yellow-300"><Sparkles className="h-3.5 w-3.5" /> Conta {profile.label}</span>
          <h1 className="mt-5 text-3xl font-black tracking-[-0.04em] sm:text-5xl">Olá, João.</h1>
          <p className="mt-3 max-w-xl text-sm font-semibold leading-6 text-neutral-800 sm:text-base">{profile.welcome}</p>
          <button type="button" onClick={onStart} className="mt-6 inline-flex h-12 items-center gap-2 rounded-xl bg-neutral-950 px-5 text-sm font-black text-yellow-300 shadow-lg shadow-yellow-800/10 hover:bg-neutral-800">
            Fazer consulta demo <ArrowRight className="h-4 w-4" />
          </button>
        </div>
        <ShieldCheck className="absolute -bottom-8 -right-5 h-48 w-48 text-white/35" strokeWidth={1.4} />
      </section>
      <div className="grid gap-4 sm:grid-cols-3">
        {profile.stats.map((stat) => (
          <div key={stat.label} className="rounded-[22px] border border-neutral-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold text-neutral-500">{stat.label}</p>
            <p className="mt-2 text-2xl font-black tracking-tight text-neutral-950">{stat.value}</p>
          </div>
        ))}
      </div>
      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-[24px] border border-neutral-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-black">Como apresentar</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {["Escolha um CPF de cenário", "Mostre o resultado instantâneo", "Selecione um plano NOX", "Conclua pagamento e contrato fake"].map((item, index) => (
              <div key={item} className="flex items-center gap-3 rounded-2xl bg-neutral-50 p-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-yellow-400 text-xs font-black">{index + 1}</span>
                <span className="text-sm font-bold text-neutral-700">{item}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 p-6">
          <LockKeyhole className="h-6 w-6 text-emerald-700" />
          <h2 className="mt-3 text-lg font-black text-emerald-950">100% isolado</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-emerald-800">Nenhuma consulta demo aparece para o administrador e nenhum serviço externo é acionado.</p>
        </div>
      </section>
    </div>
  );
}

function ConsultationStep({ cpf, error, onCpfChange, onSelectCpf, onSubmit, onBack }: { cpf: string; error: string; onCpfChange: (value: string) => void; onSelectCpf: (value: string) => void; onSubmit: () => void; onBack: () => void }) {
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageTitle eyebrow="Consulta demonstrativa" title="Dados do inquilino" description="O cadastro de João já vem preenchido. Altere somente o CPF para escolher o resultado da apresentação." />
      <section className="rounded-[26px] border border-neutral-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="grid gap-5 sm:grid-cols-2">
          <ReadOnlyField label="Nome completo" value="João da Silva" />
          <div>
            <label className="text-xs font-black uppercase tracking-wider text-neutral-600">CPF de demonstração *</label>
            <input value={cpf} onChange={(event) => onCpfChange(event.target.value)} inputMode="numeric" placeholder="000.000.000-00" className={`mt-2 h-12 w-full rounded-xl border bg-white px-4 text-base font-black outline-none transition focus:ring-4 ${error ? "border-red-400 focus:ring-red-100" : "border-neutral-200 focus:border-yellow-400 focus:ring-yellow-100"}`} />
            {error && <p className="mt-2 text-xs font-bold text-red-600">{error}</p>}
          </div>
          <ReadOnlyField label="E-mail" value="joao.demo@noxfianca.com" />
          <ReadOnlyField label="Telefone" value="(47) 99999-0000" />
          <ReadOnlyField label="Valor do aluguel" value="R$ 2.000,00" />
          <ReadOnlyField label="Condomínio + taxas" value="R$ 500,00" />
          <div className="sm:col-span-2"><ReadOnlyField label="Imóvel" value="Rua das Palmeiras, 120 — Centro, Balneário Camboriú/SC" /></div>
        </div>
        <div className="mt-6 rounded-2xl border border-yellow-200 bg-yellow-50 p-4">
          <p className="text-xs font-black uppercase tracking-wider text-yellow-800">Escolha um cenário</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {DEMO_CPF_SCENARIOS.map((scenario) => (
              <button key={scenario.cpf} type="button" onClick={() => onSelectCpf(scenario.cpf)} className={`rounded-xl border px-3 py-3 text-left transition ${cpf === scenario.cpf ? "border-yellow-500 bg-yellow-300" : "border-yellow-200 bg-white hover:border-yellow-400"}`}>
                <p className="font-mono text-xs font-black">{scenario.cpf}</p>
                <p className="mt-1 text-[11px] font-bold text-neutral-500">{scenario.label}</p>
              </button>
            ))}
          </div>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <SecondaryButton onClick={onBack}><ArrowLeft className="h-4 w-4" /> Voltar</SecondaryButton>
          <PrimaryButton onClick={onSubmit}>Consultar CPF <Search className="h-4 w-4" /></PrimaryButton>
        </div>
      </section>
    </div>
  );
}

function ResultStep({ decision, cpf, selectedPlanId, onSelectPlan, onContinue, onTryAgain }: { decision: DemoDecision; cpf: string; selectedPlanId: string | null; onSelectPlan: (id: string) => void; onContinue: () => void; onTryAgain: () => void }) {
  const status = {
    aprovado: { title: "Crédito aprovado!", description: "João está elegível para contratar a Fiança NOX.", icon: CheckCircle2, wrap: "border-emerald-200 bg-emerald-50", iconColor: "text-emerald-700" },
    recusado: { title: "Crédito recusado", description: "Este cenário demonstra uma análise sem limite aprovado.", icon: XCircle, wrap: "border-red-200 bg-red-50", iconColor: "text-red-700" },
    pendente: { title: "Análise pendente", description: "No ambiente demo, a documentação é liberada automaticamente para você continuar.", icon: Clock3, wrap: "border-amber-200 bg-amber-50", iconColor: "text-amber-700" },
  }[decision];
  const StatusIcon = status.icon;
  return (
    <div className="space-y-5">
      <section className={`rounded-[26px] border p-6 shadow-sm sm:p-8 ${status.wrap}`}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-white shadow-sm"><StatusIcon className={`h-9 w-9 ${status.iconColor}`} /></div>
          <div className="flex-1">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">Resultado demo • CPF {cpf}</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-neutral-950">{status.title}</h1>
            <p className="mt-2 text-sm font-semibold leading-6 text-neutral-700">{status.description}</p>
          </div>
          <span className="rounded-full bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wider text-neutral-600 shadow-sm">Sem consulta externa</span>
        </div>
      </section>

      {decision === "recusado" ? (
        <section className="rounded-[26px] border border-neutral-200 bg-white p-7 text-center shadow-sm">
          <p className="text-sm font-semibold text-neutral-600">Planos não são exibidos em um cenário recusado.</p>
          <PrimaryButton className="mt-5" onClick={onTryAgain}>Tentar outro CPF <ArrowRight className="h-4 w-4" /></PrimaryButton>
        </section>
      ) : (
        <section className="rounded-[26px] border border-neutral-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div><p className="text-xs font-black uppercase tracking-wider text-yellow-700">Planos NOX</p><h2 className="mt-1 text-2xl font-black">Escolha a proteção</h2></div>
            {decision === "pendente" && <span className="rounded-full bg-amber-100 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-amber-800">Continuidade liberada no demo</span>}
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {DEMO_PLANS.map((plan) => {
              const selected = selectedPlanId === plan.id;
              return (
                <button key={plan.id} type="button" onClick={() => onSelectPlan(plan.id)} className={`relative rounded-[22px] border-2 p-5 text-left transition ${selected ? "border-yellow-400 bg-yellow-50 shadow-md" : "border-neutral-200 bg-white hover:border-yellow-300"}`}>
                  {plan.featured && <span className="absolute right-4 top-4 rounded-full bg-neutral-950 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-yellow-300">Popular</span>}
                  <p className="text-lg font-black">{plan.name}</p>
                  <p className="mt-3 text-3xl font-black tracking-tight">{money(plan.monthly)}<span className="text-xs text-neutral-400">/mês</span></p>
                  <p className="mt-3 text-xs font-black text-yellow-700">{plan.coverage}</p>
                  <p className="mt-2 text-sm leading-5 text-neutral-500">{plan.details}</p>
                  <div className={`mt-5 flex items-center gap-2 text-xs font-black ${selected ? "text-emerald-700" : "text-neutral-400"}`}><span className={`grid h-5 w-5 place-items-center rounded-full border ${selected ? "border-emerald-600 bg-emerald-600 text-white" : "border-neutral-300"}`}>{selected && <Check className="h-3 w-3" />}</span>{selected ? "Plano selecionado" : "Selecionar plano"}</div>
                </button>
              );
            })}
          </div>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <SecondaryButton onClick={onTryAgain}><ArrowLeft className="h-4 w-4" /> Trocar CPF</SecondaryButton>
            <PrimaryButton disabled={!selectedPlanId} onClick={onContinue}>Continuar com o plano <ArrowRight className="h-4 w-4" /></PrimaryButton>
          </div>
        </section>
      )}
    </div>
  );
}

function DataStep({ pending, onBack, onContinue }: { pending: boolean; onBack: () => void; onContinue: () => void }) {
  const documents = ["Documento com foto", "Comprovante de renda", "Comprovante de residência"];
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageTitle eyebrow="Dados complementares" title="Cadastro liberado automaticamente" description="Para a apresentação, todos os campos e documentos de João já estão preenchidos e validados." />
      {pending && <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4"><Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" /><p className="text-sm font-semibold leading-6 text-amber-900">Cenário pendente detectado: a etapa documental foi aprovada automaticamente apenas nesta demonstração.</p></div>}
      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-[26px] border border-neutral-200 bg-white p-5 shadow-sm sm:p-7">
          <h2 className="text-lg font-black">Dados do contrato</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <ReadOnlyField label="Inquilino" value="João da Silva" />
            <ReadOnlyField label="Estado civil" value="Solteiro" />
            <ReadOnlyField label="E-mail" value="joao.demo@noxfianca.com" />
            <ReadOnlyField label="Telefone" value="(47) 99999-0000" />
            <div className="sm:col-span-2"><ReadOnlyField label="Endereço do imóvel" value="Rua das Palmeiras, 120, Apto 802 — Centro" /></div>
            <ReadOnlyField label="Cidade / UF" value="Balneário Camboriú / SC" />
            <ReadOnlyField label="Responsável pelo pagamento" value="Inquilino" />
          </div>
        </section>
        <section className="rounded-[26px] border border-neutral-200 bg-white p-5 shadow-sm sm:p-7">
          <h2 className="text-lg font-black">Documentos automáticos</h2>
          <p className="mt-1 text-sm text-neutral-500">Nenhum upload é necessário no ambiente demo.</p>
          <div className="mt-5 space-y-3">
            {documents.map((document) => <div key={document} className="flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-4"><div className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-600 text-white"><FileCheck2 className="h-5 w-5" /></div><div><p className="text-sm font-black text-emerald-950">{document}</p><p className="text-xs font-semibold text-emerald-700">Preenchido e validado</p></div></div>)}
          </div>
        </section>
      </div>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between"><SecondaryButton onClick={onBack}><ArrowLeft className="h-4 w-4" /> Voltar</SecondaryButton><PrimaryButton onClick={onContinue}>Ir para pagamento <ArrowRight className="h-4 w-4" /></PrimaryButton></div>
    </div>
  );
}

function PaymentStep({ plan, method, onMethodChange, onBack, onPay }: { plan: (typeof DEMO_PLANS)[number]; method: PaymentMethod; onMethodChange: (method: PaymentMethod) => void; onBack: () => void; onPay: () => void }) {
  const methods: Array<{ id: PaymentMethod; label: string; detail: string; icon: typeof QrCode }> = [
    { id: "pix", label: "Pix", detail: "Aprovação imediata", icon: QrCode },
    { id: "boleto", label: "Boleto", detail: "Vencimento em 3 dias", icon: Banknote },
    { id: "cartao", label: "Cartão", detail: "Cobrança recorrente", icon: CreditCard },
  ];
  const fireFee = 104.96;
  const total = plan.monthly + fireFee;
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageTitle eyebrow="Pagamento demonstrativo" title="Finalize a contratação" description="Escolha uma forma de pagamento. Nenhuma cobrança real será criada." />
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <section className="rounded-[26px] border border-neutral-200 bg-white p-5 shadow-sm sm:p-7">
          <h2 className="text-lg font-black">Forma de pagamento</h2>
          <div className="mt-5 space-y-3">
            {methods.map((option) => {
              const Icon = option.icon;
              const active = method === option.id;
              return <button key={option.id} type="button" onClick={() => onMethodChange(option.id)} className={`flex w-full items-center gap-4 rounded-2xl border-2 p-4 text-left transition ${active ? "border-yellow-400 bg-yellow-50" : "border-neutral-200 hover:border-yellow-200"}`}><div className={`grid h-11 w-11 place-items-center rounded-xl ${active ? "bg-yellow-400" : "bg-neutral-100"}`}><Icon className="h-5 w-5" /></div><div className="flex-1"><p className="font-black">{option.label}</p><p className="text-xs font-semibold text-neutral-500">{option.detail}</p></div><span className={`grid h-5 w-5 place-items-center rounded-full border ${active ? "border-neutral-950 bg-neutral-950 text-yellow-300" : "border-neutral-300"}`}>{active && <Check className="h-3 w-3" />}</span></button>;
            })}
          </div>
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" /><p className="text-sm font-semibold leading-6 text-blue-900">Simulação protegida: não pedimos cartão, não geramos Pix e não emitimos boleto real.</p></div>
        </section>
        <section className="h-fit rounded-[26px] bg-neutral-950 p-6 text-white shadow-lg">
          <p className="text-xs font-black uppercase tracking-wider text-yellow-300">Resumo</p>
          <h2 className="mt-2 text-2xl font-black">{plan.name}</h2>
          <div className="mt-6 space-y-3 border-y border-white/10 py-5 text-sm"><SummaryRow label="Prêmio mensal" value={money(plan.monthly)} /><SummaryRow label="Incêndio obrigatório" value={money(fireFee)} /></div>
          <div className="mt-5 flex items-end justify-between"><span className="text-sm font-bold text-neutral-400">Total demo</span><span className="text-3xl font-black text-yellow-300">{money(total)}</span></div>
          <button type="button" onClick={onPay} className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-yellow-400 text-sm font-black text-neutral-950 hover:bg-yellow-300">Simular pagamento <BadgeCheck className="h-5 w-5" /></button>
        </section>
      </div>
      <SecondaryButton onClick={onBack}><ArrowLeft className="h-4 w-4" /> Voltar</SecondaryButton>
    </div>
  );
}

function ContractStep({ planName, signed, onSign, onReset }: { planName: string; signed: boolean; onSign: () => void; onReset: () => void }) {
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <section className="overflow-hidden rounded-[28px] border border-emerald-200 bg-white shadow-sm">
        <div className="bg-emerald-600 p-7 text-white sm:p-9"><div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/15"><FileSignature className="h-8 w-8" /></div><p className="mt-5 text-xs font-black uppercase tracking-[0.16em] text-emerald-100">Contrato fictício enviado</p><h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Contratação demonstrada com sucesso.</h1><p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-emerald-50">O contrato {planName} foi enviado de forma simulada para joao.demo@noxfianca.com. Nenhum e-mail, WhatsApp ou assinatura externa foi acionado.</p></div>
        <div className="p-6 sm:p-8">
          <div className="grid gap-3 sm:grid-cols-3">
            <TimelineItem icon={CheckCircle2} title="Pagamento" text="Confirmado no demo" complete />
            <TimelineItem icon={FileCheck2} title="Contrato" text="Gerado e enviado" complete />
            <TimelineItem icon={FileSignature} title="Assinatura" text={signed ? "Assinado no demo" : "Aguardando simulação"} complete={signed} />
          </div>
          {!signed ? <button type="button" onClick={onSign} className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 text-sm font-black text-yellow-300 hover:bg-neutral-800">Simular assinatura do João <FileSignature className="h-4 w-4" /></button> : <div className="mt-6 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><CheckCircle2 className="h-6 w-6 text-emerald-700" /><div><p className="font-black text-emerald-950">Contrato assinado e seguro ativado</p><p className="text-sm font-semibold text-emerald-700">Conclusão inteiramente fictícia para apresentação.</p></div></div>}
          <button type="button" onClick={onReset} className="mt-4 h-12 w-full rounded-xl border border-neutral-200 text-sm font-black text-neutral-700 hover:bg-neutral-50">Iniciar outra demonstração</button>
        </div>
      </section>
    </div>
  );
}

function PageTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div><p className="text-xs font-black uppercase tracking-[0.14em] text-yellow-700">{eyebrow}</p><h1 className="mt-1 text-3xl font-black tracking-[-0.035em] text-neutral-950">{title}</h1><p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-neutral-500">{description}</p></div>;
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return <div><label className="text-xs font-black uppercase tracking-wider text-neutral-600">{label}</label><div className="mt-2 flex min-h-12 items-center rounded-xl border border-neutral-200 bg-neutral-50 px-4 text-sm font-bold text-neutral-700">{value}</div></div>;
}

function PrimaryButton({ children, onClick, disabled = false, className = "" }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; className?: string }) {
  return <button type="button" onClick={onClick} disabled={disabled} className={`inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-yellow-400 px-5 text-sm font-black text-neutral-950 transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}>{children}</button>;
}

function SecondaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-5 text-sm font-black text-neutral-700 hover:bg-neutral-50">{children}</button>;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4"><span className="font-semibold text-neutral-400">{label}</span><span className="font-black text-white">{value}</span></div>;
}

function TimelineItem({ icon: Icon, title, text, complete }: { icon: typeof CheckCircle2; title: string; text: string; complete: boolean }) {
  return <div className={`rounded-2xl border p-4 ${complete ? "border-emerald-200 bg-emerald-50" : "border-neutral-200 bg-neutral-50"}`}><Icon className={`h-5 w-5 ${complete ? "text-emerald-700" : "text-neutral-400"}`} /><p className="mt-3 text-sm font-black">{title}</p><p className="mt-1 text-xs font-semibold text-neutral-500">{text}</p></div>;
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}
