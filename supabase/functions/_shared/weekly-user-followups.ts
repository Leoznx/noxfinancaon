export const WEEKLY_FOLLOWUP_MESSAGES = [
  "E aí, {nome}! 😊 Tá conseguindo fazer as simulações certinho? Se precisar de ajuda, chama a gente por aqui! 💛",
  "Oi, {nome}! Tudo bem por aí? 👋 Conseguiu fazer suas simulações direitinho? A equipe NOX está por aqui se precisar. 😊",
  "Passando pra saber como estão as simulações, {nome}! 🚀 Tá conseguindo fazer tudo certinho? Conta com a NOX! 💛",
  "E aí, {nome}! 😄 Como estão as simulações esta semana? Se surgir qualquer dúvida, pode falar com a gente! 🤝",
  "Oi, {nome}! Só passando pra acompanhar você. 💛 As simulações estão saindo certinho? Estamos aqui pra ajudar! 😊",
  "Fala, {nome}! 👋 Tá tudo certo com suas simulações? Se travar em alguma etapa, chama a NOX que a gente ajuda. 🚀",
  "Como você está, {nome}? 😊 Conseguiu avançar nas simulações? Pode contar com a gente pra deixar tudo mais simples! 💛",
  "E aí, {nome}! Passando com aquele lembrete amigo. 😄 Tá conseguindo simular certinho? Qualquer coisa, chama a NOX! 🤝",
] as const;

export const WEEKLY_FOLLOWUP_SITE_URL = "https://noxfianca.com/login";
export const WEEKLY_FOLLOWUP_SIMULATION_URL = "https://noxfianca.com/simular";
export const WEEKLY_FOLLOWUP_TITLE = "NOX Fiança • acompanhamento semanal";
export const WEEKLY_FOLLOWUP_FOOTER = "Se preferir não receber estes lembretes, responda SAIR.";

function accountName(value: string | null | undefined) {
  const clean = String(value || "").trim() || "tudo bem";
  return clean.slice(0, 80);
}

export function buildWeeklyFollowupMessage(params: {
  name?: string | null;
  variant?: number | null;
}) {
  const content = buildWeeklyFollowupInteractiveContent(params);
  return `${content.message}\n\n${content.footer}`;
}

export function buildWeeklyFollowupInteractiveContent(params: {
  name?: string | null;
  variant?: number | null;
}) {
  const index = Math.abs(Math.trunc(Number(params.variant) || 0)) % WEEKLY_FOLLOWUP_MESSAGES.length;
  return {
    message: WEEKLY_FOLLOWUP_MESSAGES[index].replace("{nome}", accountName(params.name)),
    title: WEEKLY_FOLLOWUP_TITLE,
    footer: WEEKLY_FOLLOWUP_FOOTER,
    buttonActions: [
      {
        id: "acessar-site-nox",
        type: "URL" as const,
        label: "Acessar o site",
        url: WEEKLY_FOLLOWUP_SITE_URL,
      },
      {
        id: "fazer-simulacao-nox",
        type: "URL" as const,
        label: "Fazer simulação",
        url: WEEKLY_FOLLOWUP_SIMULATION_URL,
      },
    ],
  };
}

export type WeeklyFollowupPreference = "opt_out" | "opt_in" | null;

export function parseWeeklyFollowupPreference(
  value: string | null | undefined,
): WeeklyFollowupPreference {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (["sair", "pare", "parar", "cancelar", "stop"].includes(normalized)) {
    return "opt_out";
  }
  if (["voltar", "receber", "retomar"].includes(normalized)) {
    return "opt_in";
  }
  return null;
}

export function saoPauloBusinessClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  return {
    date,
    weekday,
    hour,
    minute,
    insideBusinessWindow: weekday >= 1 && weekday <= 5 && hour >= 9 && hour < 18,
  };
}
