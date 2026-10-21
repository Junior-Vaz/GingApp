import { plural } from "@/lib/plural";
import type { BirthdayItem } from "./types";

export const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

export const MONTH_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"] as const;

export const GREETING_MAX = 500;

/** Nome do mês (1..12) em minúsculas; vazio fora da faixa. */
export const monthName = (month: number): string => MONTH_NAMES[month - 1] ?? "";

/** Dia/mês de hoje no fuso do grupo (America/Sao_Paulo), independente do fuso do computador. */
export function todaySP(now: Date = new Date()): { day: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    day: "numeric",
    month: "numeric",
  }).formatToParts(now);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { day: pick("day"), month: pick("month") };
}

/**
 * "faz 12 anos" / "fez 12 anos" (o aniversário deste ano já passou: o backend calcula sempre a idade do ano corrente, para
 * todos os dias do mês). `null` quando o backend não manda a idade (`turnsAge` nulo ou fora de 0..130). `viewed` = mês em tela.
 */
export function turnsAgeText(
  item: Pick<BirthdayItem, "day" | "turnsAge">,
  viewedMonth: number,
  today: { day: number; month: number },
): string | null {
  if (item.turnsAge === null || item.turnsAge === undefined) return null;
  const passed = viewedMonth < today.month || (viewedMonth === today.month && item.day < today.day);
  return `${passed ? "fez" : "faz"} ${plural(item.turnsAge, "ano")}`;
}

/** "05/03" */
export const dayMonthLabel = (item: Pick<BirthdayItem, "day" | "month">): string =>
  `${String(item.day).padStart(2, "0")}/${String(item.month).padStart(2, "0")}`;

/** Nome curto para a mensagem: apelido, senão o primeiro nome. */
export function greetingName(item: Pick<BirthdayItem, "name" | "nickname">): string {
  const nick = item.nickname?.trim();
  if (nick) return nick;
  return item.name.trim().split(/\s+/)[0] ?? item.name;
}

/** Modelos de mensagem de parabéns (editáveis no diálogo). `{nome}` e o grupo já vêm preenchidos. */
export interface GreetingTemplate {
  key: string;
  label: string;
  build: (name: string, group: string | null) => string;
}

export const GREETING_TEMPLATES: readonly GreetingTemplate[] = [
  {
    key: "simples",
    label: "Parabéns simples",
    build: (name, group) => `Parabéns, ${name}! 🎉 ${group ? `A família ${group}` : "Toda a nossa família"} deseja um ótimo dia.`,
  },
  {
    key: "axe",
    label: "Com axé",
    build: (name) => `${name}, hoje o dia é seu! 🥳 Muito axé, saúde e muitos anos de roda pela frente. Parabéns!`,
  },
  {
    key: "gratidao",
    label: "Gratidão",
    build: (name, group) =>
      `Feliz aniversário, ${name}! 🎂 Gratidão por fazer parte ${group ? `do ${group}` : "do nosso grupo"}. Que o seu ano seja cheio de conquistas!`,
  },
];

export const defaultGreeting = (item: Pick<BirthdayItem, "name" | "nickname">, group: string | null): string =>
  GREETING_TEMPLATES[0]!.build(greetingName(item), group);

/**
 * Atalho do WhatsApp: `https://wa.me/55<dígitos>?text=<mensagem>`. Só dígitos; o DDI 55 entra quando o número é
 * brasileiro sem DDI (10 ou 11 dígitos). `null` quando não há telefone utilizável.
 */
export function whatsappLink(phone: string | null | undefined, text: string): string | null {
  const digits = (phone ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length < 10) return null;
  const full = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${full}?text=${encodeURIComponent(text)}`;
}
