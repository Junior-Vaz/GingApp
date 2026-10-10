import { format, formatDistanceToNowStrict, isValid, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

/**
 * Datas "só dia" (aula, vencimento, graduação, certificado) chegam como meia-noite UTC.
 * Converte para a data local equivalente do mesmo dia civil, evitando o bug de "um dia antes".
 */
export function dayOnly(iso: string): Date {
  const d = new Date(iso);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function toDate(iso: string): Date {
  const d = parseISO(iso);
  return isValid(d) ? d : new Date(iso);
}

export const fmt = (date: Date, pattern: string) => format(date, pattern, { locale: ptBR });

/**
 * Origem do app do aluno, onde moram as páginas públicas de verificação (/verificar/:code).
 * O painel NÃO tem essas rotas, então o link do QR não pode usar window.location.origin.
 *
 * Ordem: `VITE_APP_URL` (se definida no build) > convenção de subdomínio (`painel.<dominio>` →
 * `app.<dominio>`, mesmo protocolo/porta — é assim que a stack do Easypanel é publicada, sem
 * precisar de nenhuma variável) > `http://localhost:4173` (app em dev).
 */
export const appOrigin = (): string => {
  const configured = (import.meta.env["VITE_APP_URL"] as string | undefined)?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const { protocol, hostname, port } = window.location;
  if (hostname.startsWith("painel.")) {
    return `${protocol}//app.${hostname.slice("painel.".length)}${port ? `:${port}` : ""}`;
  }
  return "http://localhost:4173";
};

/** URL pública (aberta pelo QR Code) de um certificado. */
export const verificationUrl = (code: string) => `${appOrigin()}/verificar/${code}`;

/** URL pública (aberta pelo QR Code) do Passaporte compartilhado. */
export const passportUrl = (code: string) => `${appOrigin()}/verificar-passaporte/${code}`;

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatCurrency(amountCents: number): string {
  return (amountCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function relativeTime(iso: string): string {
  return formatDistanceToNowStrict(toDate(iso), { locale: ptBR, addSuffix: true });
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Mistura a cor com branco (a cor cadastrada é a da corda real, forte demais em blocos grandes). */
export function softenColor(hex: string | null | undefined, whiteMix = 0.35): string | null {
  if (!hex) return null;
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return hex;
  const channel = (start: number, end: number) =>
    Math.round(parseInt(clean.slice(start, end), 16) * (1 - whiteMix) + 255 * whiteMix);
  const toHex = (value: number) => value.toString(16).padStart(2, "0");
  return `#${toHex(channel(0, 2))}${toHex(channel(2, 4))}${toHex(channel(4, 6))}`;
}

/** Ícone claro/escuro conforme a luminância da cor (ex.: "Crua" é quase branca). */
export function readableIconColor(hex: string | null | undefined): string {
  if (!hex) return "#ffffff";
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return "#ffffff";
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.75 ? "#16181d" : "#ffffff";
}
