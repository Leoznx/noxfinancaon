import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Download,
  FileDown,
  FileText,
  FolderOpen,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  UploadCloud,
} from "lucide-react";

import type { TenantDashboardData, TenantDashboardDocument } from "@/lib/tenant-dashboard";
import { isTenantInvoiceOpen, isTenantInvoicePaid } from "@/lib/tenant-dashboard";
import type { TenantBillingItem } from "@/lib/tenant-billing";
import { calculateTenantScore, tenantScoreLevel } from "@/lib/tenant-score";

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const SHORT_DATE = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

type ContractState = {
  badge: string;
  situation: string;
  stage: string;
};

function toDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value?: string | null, uppercase = false) {
  const date = toDate(value);
  if (!date) return "—";
  const result = SHORT_DATE.format(date).replace(" de ", " ").replace(" de ", " ");
  return uppercase ? result.toLocaleUpperCase("pt-BR") : result;
}

function formatShortMonth(value?: string | null) {
  const date = toDate(value);
  if (!date) return { day: "—", month: "" };
  return {
    day: String(date.getDate()).padStart(2, "0"),
    month: date
      .toLocaleDateString("pt-BR", { month: "short" })
      .replace(".", "")
      .toLocaleUpperCase("pt-BR"),
  };
}

function getTenantContractState(data: TenantDashboardData): ContractState {
  const signature = data.signature;
  const policyActive = ["ativa", "ativo", "active"].includes(
    String(data.policy?.status || "").toLocaleLowerCase("pt-BR"),
  );
  if (signature?.status === "active" || policyActive) {
    return { badge: "Contrato ativo", situation: "Ativo", stage: "Ativação" };
  }
  if (signature?.status === "signed") {
    return {
      badge: "Assinatura concluída",
      situation: "Em andamento",
      stage: "Ativação",
    };
  }
  if (signature?.status === "awaiting_signature") {
    return {
      badge: "Aguardando assinatura",
      situation: "Em andamento",
      stage: "Assinatura",
    };
  }
  if (signature) {
    return {
      badge: "Contrato em preparação",
      situation: "Em andamento",
      stage: "Documentos",
    };
  }
  if (data.consultation?.approved_at) {
    return {
      badge: "Documentos em andamento",
      situation: "Em andamento",
      stage: "Documentos",
    };
  }
  if (data.consultation) {
    return {
      badge: "Análise em andamento",
      situation: "Em andamento",
      stage: "Análise",
    };
  }
  return {
    badge: "Nenhum contrato ativo",
    situation: "Sem contrato",
    stage: "Aguardando contratação",
  };
}

export function TenantDashboardHero({ data }: { data: TenantDashboardData }) {
  const state = getTenantContractState(data);
  return (
    <section className="relative min-h-[212px] overflow-hidden rounded-[26px] border border-[#f4df9c] bg-[linear-gradient(118deg,#fffdf8_0%,#fff8dd_48%,#fffdf9_100%)] px-6 py-6 shadow-[0_14px_42px_rgba(117,86,0,0.06)] sm:px-10 xl:h-full xl:min-h-0 xl:px-8 xl:py-4">
      <div className="pointer-events-none absolute inset-0 opacity-50 [background:linear-gradient(135deg,transparent_22%,rgba(255,214,79,.22)_22.2%,transparent_22.6%,transparent_72%,rgba(255,214,79,.18)_72.2%,transparent_72.6%)]" />
      <div className="relative z-10 flex max-w-xl flex-col items-start">
        <span className="inline-flex items-center gap-2 rounded-xl border border-[#e6ad18] bg-white/75 px-3 py-2 text-xs font-extrabold text-[#7f5710] shadow-sm backdrop-blur-sm">
          <ShieldCheck size={17} strokeWidth={2.2} />
          {state.badge}
        </span>
        <h1 className="mt-4 text-[2rem] font-black leading-none tracking-[-0.045em] text-neutral-950 sm:text-[2.65rem] xl:mt-3 xl:text-[2.1rem]">
          Meu seguro-fiança
        </h1>
        <p className="mt-2 text-sm font-medium text-neutral-600 sm:text-base">
          Parcelas, proteção e seu score para locação em um só lugar.
        </p>
        <Link
          to="/inquilino/painel"
          className="mt-5 inline-flex h-10 items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 text-xs font-extrabold text-neutral-900 shadow-sm transition hover:-translate-y-0.5 hover:border-[#e8c352] hover:shadow-md xl:mt-3 xl:h-9"
        >
          Ver detalhes do contrato <ChevronRight size={16} />
        </Link>
      </div>
      <img
        src="/assets/tenant-dashboard/tenant-contract-hero-v2.png"
        alt="Contrato, proteção, imóvel e cobranças"
        className="pointer-events-none absolute -bottom-4 right-[-2%] hidden h-[226px] w-[58%] object-contain object-right-bottom lg:block xl:right-[1%] xl:h-full xl:w-[62%]"
      />
    </section>
  );
}

export function TenantDashboardSummary({ data }: { data: TenantDashboardData }) {
  const state = getTenantContractState(data);
  const open = data.invoices.filter((item) => isTenantInvoiceOpen(item.status));
  const next = [...open].sort(
    (a, b) =>
      (toDate(a.dueDate)?.getTime() ?? Infinity) - (toDate(b.dueDate)?.getTime() ?? Infinity),
  )[0];
  const totalOpen = open.reduce((sum, item) => sum + item.amount, 0);
  const updated = data.documents[0]?.updated_at || data.documents[0]?.created_at;

  const cards = [
    {
      icon: ShieldCheck,
      label: "Situação",
      value: state.situation,
      detail: `Etapa: ${state.stage}`,
    },
    {
      icon: FolderOpen,
      label: "Documentos disponíveis",
      value: String(data.documents.length),
      detail: updated ? `Atualizado em ${formatDate(updated)}` : "Nenhum documento ainda",
    },
    {
      icon: ReceiptText,
      label: "Faturas em aberto",
      value: String(open.length),
      detail: `Total: ${BRL.format(totalOpen)}`,
    },
    {
      icon: CalendarDays,
      label: "Próximo vencimento",
      value: next?.dueDate ? formatDate(next.dueDate, true) : "—",
      detail: next ? BRL.format(next.amount) : "Sem vencimento pendente",
    },
    {
      icon: CircleDollarSign,
      label: "Total em aberto",
      value: BRL.format(totalOpen),
      detail: `${open.length} ${open.length === 1 ? "fatura" : "faturas"}`,
    },
  ];

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 xl:h-full">
      {cards.map(({ icon: Icon, label, value, detail }) => (
        <article
          key={label}
          className="flex min-h-[108px] items-center gap-4 rounded-2xl border border-neutral-200 bg-white px-4 py-4 shadow-[0_8px_22px_rgba(15,23,42,0.045)] xl:h-full xl:min-h-0 xl:gap-3 xl:px-3 xl:py-2"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#fff7dc] text-[#eca900] xl:h-10 xl:w-10 xl:rounded-xl">
            <Icon size={24} strokeWidth={1.8} />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-medium text-neutral-500">{label}</span>
            <strong className="mt-1 block truncate text-lg font-black tracking-tight text-neutral-950">
              {value}
            </strong>
            <span className="mt-1 block truncate text-[11px] text-neutral-500">{detail}</span>
          </span>
        </article>
      ))}
    </section>
  );
}

function invoiceStatus(item: TenantBillingItem) {
  if (isTenantInvoicePaid(item.status)) {
    return { label: "Pago", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  }
  if (item.status === "overdue") {
    return { label: "Vencida", className: "border-red-200 bg-red-50 text-red-700" };
  }
  if (item.status === "pending") {
    return { label: "Em aberto", className: "border-[#f0d184] bg-[#fff8e7] text-[#b97300]" };
  }
  return { label: "Processando", className: "border-neutral-200 bg-neutral-100 text-neutral-600" };
}

export type TenantQuickActions = {
  onInvoice: () => void;
  onContract: () => void;
  onUpload: () => void;
  uploading: boolean;
};

export function TenantInvoicesPanel({
  invoices,
  actions,
}: {
  invoices: TenantBillingItem[];
  actions: TenantQuickActions;
}) {
  const rows = [...invoices]
    .sort((a, b) => {
      const priority = (item: TenantBillingItem) =>
        item.status === "overdue" ? 0 : isTenantInvoiceOpen(item.status) ? 1 : 2;
      return (
        priority(a) - priority(b) ||
        (toDate(a.dueDate)?.getTime() ?? Infinity) - (toDate(b.dueDate)?.getTime() ?? Infinity)
      );
    })
    .slice(0, 3);

  return (
    <section className="flex min-h-[374px] flex-col rounded-2xl border border-neutral-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.05)] xl:h-full xl:min-h-0 xl:p-3">
      <PanelTitle icon={ReceiptText} title="Minhas faturas">
        <Link
          to="/inquilino/faturas"
          className="inline-flex h-8 items-center rounded-xl border border-neutral-200 px-3 text-[10px] font-bold text-neutral-900 transition hover:border-[#e6bb2f]"
        >
          Ver todas faturas
        </Link>
      </PanelTitle>

      {rows.length ? (
        <div className="mt-3 divide-y divide-neutral-100">
          <div className="grid grid-cols-[84px_1fr_90px_92px_18px] gap-2 pb-2 text-[10px] font-bold text-neutral-500 max-md:hidden">
            <span>Vencimento</span>
            <span>Descrição</span>
            <span>Status</span>
            <span className="text-right">Valor</span>
            <span />
          </div>
          {rows.map((item) => {
            const due = formatShortMonth(item.dueDate);
            const status = invoiceStatus(item);
            return (
              <Link
                key={item.id}
                to="/inquilino/faturas"
                className="grid min-h-[62px] grid-cols-[52px_1fr_auto] items-center gap-3 py-2.5 md:grid-cols-[84px_1fr_90px_92px_18px] xl:h-12 xl:min-h-0 xl:py-1"
              >
                <span className="flex h-11 w-11 flex-col items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 leading-none">
                  <b className="text-sm text-neutral-900">{due.day}</b>
                  <small className="mt-1 text-[9px] font-bold text-neutral-500">{due.month}</small>
                </span>
                <span className="min-w-0">
                  <b className="block truncate text-xs text-neutral-900">Mensalidade</b>
                  <small className="mt-0.5 block truncate text-[10px] text-neutral-500">
                    Parcela {item.installmentNumber}
                    {item.installmentTotal > 1 ? ` de ${item.installmentTotal}` : ""}
                  </small>
                </span>
                <span className="flex items-center justify-end gap-3 md:contents">
                  <span
                    className={`hidden rounded-lg border px-2 py-1 text-[10px] font-bold md:inline-flex ${status.className}`}
                  >
                    {status.label}
                  </span>
                  <b className="text-right text-xs text-neutral-900">{BRL.format(item.amount)}</b>
                  <ChevronRight size={15} className="text-neutral-500" />
                </span>
              </Link>
            );
          })}
        </div>
      ) : (
        <EmptyPanel icon={ReceiptText} text="Nenhuma fatura disponível ainda." />
      )}

      {rows.some((item) => isTenantInvoiceOpen(item.status)) ? (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-[#f1d891] bg-[#fffaf0] px-3 py-2 text-[11px] text-neutral-600 xl:mt-2 xl:py-1.5">
          <Clock3 size={15} className="shrink-0 text-[#d99500]" />
          Mantenha suas faturas em dia para evitar interrupções no contrato.
        </div>
      ) : null}

      <div className="mt-auto border-t border-neutral-100 pt-3 xl:pt-2">
        <h3 className="text-sm font-black text-neutral-950">Ações rápidas</h3>
        <div className="mt-2 grid grid-cols-3 gap-2 xl:mt-1">
          <QuickButton
            icon={FileDown}
            title="Baixar boleto"
            subtitle="Gerar 2ª via"
            onClick={actions.onInvoice}
          />
          <QuickButton
            icon={FileText}
            title="Ver contrato"
            subtitle="Abrir documento"
            onClick={actions.onContract}
          />
          <QuickButton
            icon={UploadCloud}
            title={actions.uploading ? "Enviando..." : "Enviar documento"}
            subtitle="Anexar arquivos"
            onClick={actions.onUpload}
            disabled={actions.uploading}
          />
        </div>
      </div>
    </section>
  );
}

export function TenantScoreCard({
  name,
  invoices,
}: {
  name: string;
  invoices: TenantBillingItem[];
}) {
  const result = calculateTenantScore(invoices);
  const level = tenantScoreLevel(result.score);
  const progress = Math.max(0, Math.min(1, result.score / result.maxScore));
  const gaugeLength = Math.PI * 130;
  const visibleProgress = Math.max(progress, 0.015);
  const markerAngle = Math.PI * (1 - progress);
  const markerX = 180 + 130 * Math.cos(markerAngle);
  const markerY = 170 - 130 * Math.sin(markerAngle);

  return (
    <section className="tenant-score-card relative flex min-h-[374px] items-center justify-center overflow-hidden rounded-2xl border border-neutral-200 bg-white px-5 py-6 shadow-[0_8px_24px_rgba(15,23,42,0.05)] sm:px-8 xl:h-full xl:min-h-0 xl:py-3">
      <span className="pointer-events-none absolute -left-28 -top-32 h-72 w-72 rounded-full bg-red-50/70 blur-3xl" />
      <span className="pointer-events-none absolute -bottom-40 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-yellow-50 blur-3xl" />
      <span className="pointer-events-none absolute -right-28 -top-32 h-72 w-72 rounded-full bg-emerald-50/70 blur-3xl" />

      <div className="relative flex w-full max-w-[680px] flex-col items-center text-center">
        <span className="tenant-score-kicker inline-flex items-center gap-2 rounded-full border border-[#f0d781] bg-[#fffaf0] px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.22em] text-[#9d6900]">
          <Sparkles size={13} /> Score para locação
        </span>
        <p className="tenant-score-name mt-3 max-w-full truncate text-base font-black text-neutral-950 sm:text-lg">
          {name}
        </p>
        <svg
          viewBox="0 0 360 180"
          role="img"
          aria-label={`Score para locação de ${result.score} pontos, classificação ${level.label}`}
          className="tenant-score-gauge mt-1 max-h-[280px] w-full max-w-[600px] overflow-visible xl:max-h-[230px]"
        >
          <defs>
            <linearGradient id="tenant-score-gauge" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#e84444" />
              <stop offset="48%" stopColor="#f3c720" />
              <stop offset="100%" stopColor="#25a96b" />
            </linearGradient>
          </defs>
          <path
            d="M 50 170 A 130 130 0 0 1 310 170"
            fill="none"
            stroke="#edf0f2"
            strokeWidth="26"
            strokeLinecap="round"
          />
          <path
            d="M 50 170 A 130 130 0 0 1 310 170"
            fill="none"
            stroke="url(#tenant-score-gauge)"
            strokeWidth="26"
            strokeLinecap="round"
            strokeDasharray={`${gaugeLength * visibleProgress} ${gaugeLength}`}
          />
          <circle
            cx={markerX}
            cy={markerY}
            r="8"
            fill="#ffffff"
            stroke={level.color}
            strokeWidth="5"
          />
          <text
            x="180"
            y="126"
            textAnchor="middle"
            fill="#111111"
            fontSize="60"
            fontWeight="900"
            letterSpacing="-3"
          >
            {result.score}
          </text>
          <text
            x="180"
            y="151"
            textAnchor="middle"
            fill={level.color}
            fontSize="12"
            fontWeight="900"
            letterSpacing="1.6"
          >
            {level.label.toUpperCase()}
          </text>
        </svg>
      </div>
    </section>
  );
}

export function TenantDocumentsPanel({
  documents,
  onOpen,
}: {
  documents: TenantDashboardDocument[];
  onOpen: (document: TenantDashboardDocument) => void;
}) {
  const rows = documents.slice(0, 5);
  return (
    <section className="flex min-h-[374px] flex-col rounded-2xl border border-neutral-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
      <PanelTitle icon={FolderOpen} title="Contrato e documentos">
        <Link
          to="/inquilino/documentos"
          className="inline-flex h-8 items-center rounded-xl border border-neutral-200 px-3 text-[10px] font-bold text-neutral-900 transition hover:border-[#e6bb2f]"
        >
          Ver todos
        </Link>
      </PanelTitle>
      {rows.length ? (
        <div className="mt-3 divide-y divide-neutral-100">
          {rows.map((document) => {
            const extension = (document.file_name.split(".").pop() || "ARQ").toUpperCase();
            const title = documentTitle(document);
            return (
              <button
                key={document.id}
                type="button"
                onClick={() => onOpen(document)}
                className="flex min-h-[52px] w-full items-center gap-3 py-2 text-left transition hover:bg-neutral-50"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-500">
                  <FileText size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-xs text-neutral-900">{title}</b>
                  <small className="mt-0.5 block truncate text-[10px] text-neutral-500">
                    {document.file_name} · {formatDate(document.updated_at || document.created_at)}
                  </small>
                </span>
                <span className="text-[10px] font-bold text-neutral-500">{extension}</span>
                <Download size={16} className="text-neutral-600" />
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyPanel icon={FolderOpen} text="Documento ainda não disponível." />
      )}
      <Link
        to="/inquilino/documentos"
        className="mt-auto inline-flex h-9 w-fit items-center gap-2 rounded-xl border border-neutral-200 px-4 text-xs font-bold text-neutral-900 transition hover:border-[#e6bb2f]"
      >
        Ir para documentos <ChevronRight size={15} />
      </Link>
    </section>
  );
}

type TimelineStep = {
  label: string;
  detail: string;
  state: "complete" | "current" | "future";
  date: string | null;
};

function timelineSteps(data: TenantDashboardData): TimelineStep[] {
  const signature = data.signature;
  const active = signature?.status === "active" || !!data.consultation?.activation_completed_at;
  const signed = active || signature?.status === "signed";
  const signatureStarted = signed || signature?.status === "awaiting_signature";
  const documentsStarted = signatureStarted || !!signature || !!data.consultation?.approved_at;
  const analysisComplete = documentsStarted;
  return [
    {
      label: "Análise",
      detail: analysisComplete ? "Análise concluída" : "Estamos analisando seus dados.",
      state: analysisComplete ? "complete" : "current",
      date: data.consultation?.approved_at || null,
    },
    {
      label: "Documentos",
      detail: signatureStarted
        ? "Documentos conferidos"
        : documentsStarted
          ? "Estamos conferindo seus documentos."
          : "Aguardando etapa anterior",
      state: signatureStarted ? "complete" : documentsStarted ? "current" : "future",
      date: signature?.sent_at || null,
    },
    {
      label: "Assinatura",
      detail: signed
        ? "Assinatura concluída"
        : signatureStarted
          ? "Aguardando sua assinatura."
          : "Aguardando etapa anterior",
      state: signed ? "complete" : signatureStarted ? "current" : "future",
      date: signature?.signed_at || null,
    },
    {
      label: "Ativação",
      detail: active
        ? "Seguro-fiança ativado"
        : signed
          ? "Ativação em processamento."
          : "Aguardando etapa anterior",
      state: active ? "complete" : signed ? "current" : "future",
      date: signature?.activated_at || data.consultation?.activation_completed_at || null,
    },
  ];
}

export function TenantTimelinePanel({ data }: { data: TenantDashboardData }) {
  const steps = timelineSteps(data);
  const activatedAt = data.signature?.activated_at || data.consultation?.activation_completed_at;
  return (
    <section className="flex min-h-[374px] flex-col rounded-2xl border border-neutral-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
      <PanelTitle icon={ArrowRight} title="Acompanhar contrato" />
      <p className="ml-9 mt-[-2px] text-[11px] text-neutral-500">
        Etapas da ativação do seu seguro
      </p>
      <div className="mt-4 flex-1">
        {steps.map((step, index) => (
          <div key={step.label} className="relative flex min-h-[62px] gap-3">
            {index < steps.length - 1 ? (
              <span className="absolute left-[13px] top-7 h-[38px] w-px bg-neutral-200" />
            ) : null}
            <span
              className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-black ${
                step.state === "complete"
                  ? "border-[#ffc400] bg-[#ffc400] text-neutral-950"
                  : step.state === "current"
                    ? "border-[#ffc400] bg-[#fff2b7] text-neutral-950"
                    : "border-neutral-200 bg-neutral-100 text-neutral-500"
              }`}
            >
              {step.state === "complete" ? <Check size={15} strokeWidth={3} /> : index + 1}
            </span>
            <span className="min-w-0 pt-0.5">
              <span className="flex flex-wrap items-center gap-2">
                <b className="text-xs text-neutral-900">{step.label}</b>
                {step.state === "current" ? (
                  <small className="text-[10px] font-bold text-[#c78600]">Em andamento</small>
                ) : null}
              </span>
              <small className="mt-1 block text-[10px] leading-4 text-neutral-500">
                {step.date && step.state === "complete"
                  ? `${step.detail} em ${formatDate(step.date)}`
                  : step.detail}
              </small>
            </span>
          </div>
        ))}
      </div>
      {activatedAt ? (
        <div className="mt-auto flex items-center gap-2 rounded-xl border border-[#efd88c] bg-[#fffaf0] px-3 py-2 text-[11px] text-neutral-600">
          <Clock3 size={16} className="text-[#d99500]" />
          Contrato ativado em {formatDate(activatedAt)}
        </div>
      ) : null}
    </section>
  );
}

function PanelTitle({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof ReceiptText;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-center gap-3">
      <Icon size={19} className="text-[#e9aa00]" />
      <h2 className="flex-1 text-sm font-black text-neutral-950">{title}</h2>
      {children}
    </div>
  );
}

function QuickButton({
  icon: Icon,
  title,
  subtitle,
  onClick,
  disabled,
}: {
  icon: typeof FileDown;
  title: string;
  subtitle: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-[62px] items-center gap-2 rounded-xl border border-neutral-200 bg-white px-2 text-left transition hover:border-[#e6bb2f] hover:bg-[#fffdf5] disabled:opacity-60 xl:h-12 xl:min-h-0"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#fff5cf] text-[#e4a400]">
        <Icon size={17} />
      </span>
      <span className="min-w-0">
        <b className="block truncate text-[10px] text-neutral-900">{title}</b>
        <small className="mt-0.5 block truncate text-[9px] text-neutral-500">{subtitle}</small>
      </span>
    </button>
  );
}

function EmptyPanel({ icon: Icon, text }: { icon: typeof ReceiptText; text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center text-neutral-400">
      <Icon size={28} strokeWidth={1.5} />
      <p className="max-w-[220px] text-xs">{text}</p>
    </div>
  );
}

function documentTitle(document: TenantDashboardDocument) {
  const type = String(document.document_type || "").toLocaleLowerCase("pt-BR");
  if (type === "contrato") return "Contrato de locação";
  if (type === "apolice") return "Apólice do seguro";
  if (type === "garantia") return "Condições gerais";
  if (type === "comprovante_residencia") return "Comprovante de residência";
  if (type === "rg" || type === "cnh") return "Documento de identificação";
  return document.file_name || "Documento";
}
