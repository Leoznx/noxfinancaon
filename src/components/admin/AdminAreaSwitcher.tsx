import { Link, useLocation } from "@tanstack/react-router";
import { DollarSign, Megaphone, ReceiptText, Shuffle } from "lucide-react";

const AREA_OPTIONS = {
  leads: [
    { label: "Leads Marketing", href: "/admin/leads", icon: Megaphone },
    { label: "Distribuição de Leads", href: "/admin/distribuicao-leads", icon: Shuffle },
  ],
  financeiro: [
    { label: "Financeiro", href: "/admin/financeiro", icon: DollarSign },
    { label: "Faturamento", href: "/admin/faturamento", icon: ReceiptText },
  ],
} as const;

export function AdminAreaSwitcher({ area }: { area: keyof typeof AREA_OPTIONS }) {
  const location = useLocation();

  return (
    <nav
      aria-label={area === "leads" ? "Selecionar área de leads" : "Selecionar área financeira"}
      className="inline-flex w-full flex-col gap-1.5 rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-sm sm:w-auto sm:flex-row"
    >
      {AREA_OPTIONS[area].map((option) => {
        const active = location.pathname === option.href;
        const Icon = option.icon;
        return (
          <Link
            key={option.href}
            to={option.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-extrabold transition ${
              active
                ? "bg-neutral-950 text-white shadow-sm"
                : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950"
            }`}
          >
            <Icon className={`h-4 w-4 ${active ? "text-yellow-400" : ""}`} />
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}
