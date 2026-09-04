import { supabase } from "@/integrations/supabase/client";

export type TimeClockPunchType = "entrada" | "inicio_intervalo" | "fim_intervalo" | "saida";
export type TimeClockClassification =
  | "no_horario"
  | "atrasado"
  | "adiantado"
  | "saida_antecipada"
  | "hora_extra";

export type TimeClockPunch = {
  id: string;
  type: TimeClockPunchType;
  punched_at: string;
  expected_at: string;
  deviation_minutes: number;
  classification: TimeClockClassification;
  photo_path: string;
};

export type TimeClockDay = {
  work_date: string;
  weekday: number;
  scheduled_minutes: number;
  worked_minutes: number | null;
  bank_minutes: number | null;
  raw_bank_minutes: number | null;
  late_minutes: number;
  early_departure_minutes: number;
  tolerance_applied: boolean;
  status: "completo" | "em_andamento" | "sem_registro" | "pendente";
  punches: TimeClockPunch[];
  employee_id?: string;
  employee_name?: string;
  employee_email?: string;
  seller_type?: "sdr" | "closer" | null;
  employee_status?: string;
  time_clock_enabled?: boolean;
};

export type TimeClockDashboard = {
  enabled: boolean;
  employee: { id: string; name: string; seller_type: "sdr" | "closer" | null };
  timezone: string;
  tolerance: { per_punch_minutes: number; daily_minutes: number };
  schedule: { monday_thursday: string[]; friday: string[] };
  bank_balance_minutes: number;
  next_punch_type: TimeClockPunchType | null;
  today: TimeClockDay;
  history: TimeClockDay[];
};

export const TIME_CLOCK_LABELS: Record<TimeClockPunchType, string> = {
  entrada: "Entrada",
  inicio_intervalo: "Saída para almoço",
  fim_intervalo: "Retorno do almoço",
  saida: "Saída",
};

export const TIME_CLOCK_CLASSIFICATION_LABELS: Record<TimeClockClassification, string> = {
  no_horario: "Dentro da tolerância",
  atrasado: "Atraso",
  adiantado: "Adiantado",
  saida_antecipada: "Saída antecipada",
  hora_extra: "Tempo adicional",
};

function dateInput(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function defaultTimeClockRange() {
  const now = new Date();
  const to = dateInput(now);
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1, 12);
  return { from: dateInput(firstDay), to };
}

export async function fetchMyTimeClockDashboard(from?: string, to?: string) {
  const { data, error } = await (supabase as any).rpc("get_my_time_clock_dashboard", {
    p_from: from ?? null,
    p_to: to ?? null,
  });
  if (error) throw new Error(error.message || "Não foi possível carregar o controle de ponto.");
  return data as TimeClockDashboard;
}

export async function fetchAdminTimeClockHistory(from: string, to: string, employeeId?: string) {
  const { data, error } = await (supabase as any).rpc("get_admin_time_clock_history", {
    p_from: from,
    p_to: to,
    p_employee_id: employeeId || null,
  });
  if (error) throw new Error(error.message || "Não foi possível carregar o histórico de ponto.");
  return data as { from: string; to: string; rows: TimeClockDay[] };
}

export async function setSellerTimeClockEnabled(employeeId: string, enabled: boolean) {
  const { error } = await (supabase as any).rpc("set_seller_time_clock_enabled", {
    p_employee_id: employeeId,
    p_enabled: enabled,
  });
  if (error) throw new Error(error.message || "Não foi possível alterar o acesso ao ponto.");
}

async function normalizePhoto(file: File): Promise<File> {
  if (file.size <= 1_800_000 && ["image/jpeg", "image/png", "image/webp"].includes(file.type)) return file;

  const imageUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const value = new Image();
      value.onload = () => resolve(value);
      value.onerror = () => reject(new Error("Não foi possível processar a foto."));
      value.src = imageUrl;
    });
    const longest = Math.max(image.naturalWidth, image.naturalHeight);
    const scale = Math.min(1, 1440 / longest);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Não foi possível processar a foto.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Não foi possível compactar a foto."))), "image/jpeg", 0.82),
    );
    return new File([blob], "registro-ponto.jpg", { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function uuid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function registerTimeClockPunch(type: TimeClockPunchType, sourceFile: File) {
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) throw new Error("Sua sessão expirou. Entre novamente para registrar o ponto.");
  if (!sourceFile.type.startsWith("image/")) throw new Error("Registre uma foto válida para confirmar a marcação.");

  const file = await normalizePhoto(sourceFile);
  if (file.size > 5 * 1024 * 1024) throw new Error("A foto precisa ter no máximo 5 MB.");
  const today = dateInput(new Date());
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${userId}/${today}/${uuid()}.${extension}`;
  const bucket = supabase.storage.from("time-clock-photos");
  const { error: uploadError } = await bucket.upload(path, file, {
    contentType: file.type,
    cacheControl: "31536000",
    upsert: false,
  });
  if (uploadError) throw new Error(uploadError.message || "Não foi possível enviar a foto.");

  const { data, error } = await (supabase as any).rpc("register_time_clock_punch", {
    p_punch_type: type,
    p_photo_path: path,
    p_client_metadata: {
      channel: "web",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      user_agent: navigator.userAgent.slice(0, 500),
    },
  });
  if (error) {
    await bucket.remove([path]);
    throw new Error(error.message || "Não foi possível registrar o ponto.");
  }

  let emailWarning: string | null = null;
  if (data?.email_notification_required) {
    const { error: emailError } = await supabase.functions.invoke("notify-time-clock", {
      body: { punchId: data.punch_id },
    });
    if (emailError) emailWarning = "O ponto foi salvo, mas o aviso por e-mail não pôde ser enviado agora.";
  }
  return { ...(data as Record<string, unknown>), emailWarning } as {
    punch_id: string;
    classification: TimeClockClassification;
    deviation_minutes: number;
    message: string;
    day: TimeClockDay;
    emailWarning: string | null;
  };
}

export async function createTimeClockPhotoUrl(path: string, expiresIn = 300) {
  const { data, error } = await supabase.storage.from("time-clock-photos").createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) throw new Error(error?.message || "Não foi possível abrir a foto.");
  return data.signedUrl;
}

export function formatTimeClockMinutes(value: number | null | undefined) {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const absolute = Math.abs(value);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  if (hours === 0) return `${sign}${minutes} min`;
  return `${sign}${hours}h${minutes ? ` ${minutes}min` : ""}`;
}

export function formatPunchTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
