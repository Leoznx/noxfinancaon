export const WEEKLY_FOLLOWUP_MESSAGES = [
  "Olá, {nome}! 😊 Faz alguns dias que você não acessa a NOX. Está tudo bem? Se precisar de ajuda com o sistema, estamos aqui para você avançar e fechar mais contratos! 💛",
  "Olá, {nome}! 👋 Sentimos sua falta na plataforma. Precisa de ajuda para retomar suas simulações e transformar oportunidades em novos contratos? Conte com a NOX! 😊",
  "Olá, {nome}! 🚀 Percebemos que você está há alguns dias sem acessar. Podemos ajudar em alguma etapa para você voltar a simular e fechar mais contratos? 💛",
  "Olá, {nome}! 😄 Está tudo bem por aí? Se alguma dúvida no sistema impediu seu avanço, fale com a NOX. Vamos ajudar você a concluir mais contratos! 🤝",
  "Olá, {nome}! 💛 Passando para saber se está tudo bem. Nossa equipe pode ajudar você a usar a plataforma e aproveitar mais oportunidades de contrato. 😊",
  "Olá, {nome}! 👋 Faz alguns dias que não vemos você na NOX. Se travou em alguma etapa, conte com nossa ajuda para voltar e fechar mais contratos. 🚀",
  "Olá, {nome}! 😊 Como você está? Podemos ajudar na retomada das simulações para deixar o processo mais simples e gerar novos contratos. 💛",
  "Olá, {nome}! 😄 Sentimos sua falta! Se precisar de suporte com o sistema, a equipe NOX está pronta para ajudar você a avançar e fechar contratos. 🤝",
] as const;

export const WEEKLY_FOLLOWUP_SITE_URL = "https://www.noxfianca.com";
export const WEEKLY_FOLLOWUP_TITLE = "NOX Fiança • Podemos ajudar?";

function accountFirstName(value: string | null | undefined) {
  const firstName =
    String(value || "")
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
        label: "Acessar a NOX",
        url: WEEKLY_FOLLOWUP_SITE_URL,
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
