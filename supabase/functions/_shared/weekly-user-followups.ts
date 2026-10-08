export const WEEKLY_FOLLOWUP_MESSAGES = [
  "Olá, {nome}! 😊 Tá conseguindo fazer as simulações certinho? Se precisar de ajuda, chama a gente por aqui! 💛",
  "Olá, {nome}! 👋 Tudo bem por aí? Conseguiu fazer suas simulações direitinho? A equipe NOX está por aqui se precisar. 😊",
  "Olá, {nome}! 🚀 Passando pra saber como estão as simulações. Tá conseguindo fazer tudo certinho? Conta com a NOX! 💛",
  "Olá, {nome}! 😄 Como estão as simulações esta semana? Se surgir qualquer dúvida, pode falar com a gente! 🤝",
  "Olá, {nome}! 💛 Só passando pra acompanhar você. As simulações estão saindo certinho? Estamos aqui pra ajudar! 😊",
  "Olá, {nome}! 👋 Tá tudo certo com suas simulações? Se travar em alguma etapa, chama a NOX que a gente ajuda. 🚀",
  "Olá, {nome}! 😊 Como você está? Conseguiu avançar nas simulações? Pode contar com a gente pra deixar tudo mais simples! 💛",
  "Olá, {nome}! 😄 Passando com aquele lembrete amigo. Tá conseguindo simular certinho? Qualquer coisa, chama a NOX! 🤝",
] as const;

export const WEEKLY_FOLLOWUP_SITE_URL = "https://noxfianca.com/login";
export const WEEKLY_FOLLOWUP_SIMULATION_URL = "https://noxfianca.com/simular";
export const WEEKLY_FOLLOWUP_TITLE = "NOX Fiança • Acompanhamento semanal";

function accountFirstName(value: string | null | undefined) {
  const firstName = String(value || "")
    .trim()
    .split(/\s+/u)[0]
    .slice(0, 80) || "Cliente";
  const normalized = firstName.toLocaleLowerCase("pt-BR");
  return `${normalized.charAt(0).toLocaleUpperCase("pt-BR")}${normalized.slice(1)}`;
}

export function buildWeeklyFollowupMessage(params: {
  name?: string | null;
  variant?: number | null;
}) {
  const content = buildWeeklyFollowupInteractiveContent(params);
  return content.message;
}

export function buildWeeklyFollowupInteractiveContent(params: {
  name?: string | null;
  variant?: number | null;
}) {
  const index = Math.abs(Math.trunc(Number(params.variant) || 0)) % WEEKLY_FOLLOWUP_MESSAGES.length;
  return {
    message: WEEKLY_FOLLOWUP_MESSAGES[index].replace("{nome}", accountFirstName(params.name)),
    title: WEEKLY_FOLLOWUP_TITLE,
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
