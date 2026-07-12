import { supabase } from "@/integrations/supabase/client";

export type SellerContext = {
  authUserId: string;
  email: string | null;
  sellerId: string | null;
  isSeller: boolean;
};

export const LEAD_STATUS = [
  { value: "pendente", label: "Pendente" },
  { value: "em_atendimento", label: "Em atendimento" },
  { value: "atendido", label: "Atendido" },
  { value: "sem_resposta", label: "Sem resposta" },
  { value: "convertido", label: "Convertido" },
  { value: "perdido", label: "Perdido" },
] as const;

export const STATUS_PIPELINE = [
  { key: "pendente", label: "Pendente" },
  { key: "em_atendimento", label: "Em atendimento" },
  { key: "atendido", label: "Atendido" },
  { key: "sem_resposta", label: "Sem resposta" },
  { key: "convertido", label: "Convertido" },
  { key: "perdido", label: "Perdido" },
] as const;

export const STATUS_ABERTOS = ["pendente", "em_atendimento", "sem_resposta", "novo", "em_contato"] as const;
export const STATUS_ATIVOS_APOLICE = ["ativa", "apolice_ativa", "apólice ativa", "aprovado", "contrato_fechado", "contrato fechado", "pago"] as const;
export const STATUS_COMISSAO_VALIDA = ["elegivel", "retida", "liberada_parcial", "liberada_total", "paga", "pago", "aprovada", "aprovado"] as const;

export async function getSellerContext(): Promise<SellerContext> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Usuário não autenticado.");

  const { data, error } = await supabase
    .from("internal_users" as any)
    .select("id, role, status, email")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (error) throw error;

  const internal = data as any;
  const isSeller = internal?.role === "vendedor" && internal?.status === "ativo";

  return {
    authUserId: user.id,
    email: user.email ?? null,
    sellerId: internal?.id ?? null,
    isSeller,
  };
}

export function normalizeLeadStatus(status?: string | null) {
  if (!status || status === "novo") return "pendente";
  if (status === "em_contato" || status === "qualificado" || status === "proposta_enviada" || status === "negociacao") return "em_atendimento";
  return status;
}

export function leadStatusLabel(status?: string | null) {
  const normalized = normalizeLeadStatus(status);
  return LEAD_STATUS.find((item) => item.value === normalized)?.label ?? normalized;
}

export function leadStatusClass(status?: string | null) {
  const normalized = normalizeLeadStatus(status);
  const classes: Record<string, string> = {
    pendente: "bg-yellow-100 text-yellow-800 border-yellow-200",
    em_atendimento: "bg-blue-100 text-blue-800 border-blue-200",
    atendido: "bg-emerald-100 text-emerald-800 border-emerald-200",
    sem_resposta: "bg-orange-100 text-orange-800 border-orange-200",
    convertido: "bg-green-100 text-green-800 border-green-200",
    perdido: "bg-red-100 text-red-800 border-red-200",
  };
  return classes[normalized] ?? "bg-neutral-100 text-neutral-700 border-neutral-200";
}

export function formatMoney(value?: number | string | null) {
  const amount = Number(value ?? 0);
  return amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatDateTime(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function toDatetimeLocal(value?: string | null) {
  const date = value ? new Date(value) : defaultFollowUpDate();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export function defaultFollowUpDate() {
  const date = new Date();
  date.setDate(date.getDate() + 2);
  date.setHours(9, 0, 0, 0);
  return date;
}

export function whatsappUrl(nome: string, telefone?: string | null) {
  const digits = String(telefone ?? "").replace(/\D/g, "");
  if (!digits) return "";
  const phone = digits.startsWith("55") ? digits : `55${digits}`;
  const message = `Olá, ${nome}! Tudo bem? Aqui é da NOX Fiança. Estou entrando em contato sobre sua simulação/atendimento.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function isToday(value?: string | null) {
  if (!value) return false;
  const date = new Date(value);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return date >= start && date <= end;
}

export function isPastOpenDate(value?: string | null) {
  if (!value) return false;
  return new Date(value) < new Date();
}
