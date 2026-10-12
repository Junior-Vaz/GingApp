import { api } from "@/lib/api";

/**
 * Check-in por QR: o aluno confirma a PROPRIA presenca (dependente via studentId).
 * Token: 'E12-K7QXM3PA2B' (E = evento, 12 = id do evento) ou 'L7-XXXXXXXXXX' (L = aula, 7 = id da aula).
 * O QR impresso no painel contem '<APP_URL>/checkin?token=<token>' (ou so o token).
 */
export type CheckinKind = "EVENTO" | "AULA";

export interface ParsedCheckin {
  /** Token normalizado (maiusculas, sem espacos) - exatamente o que vai no corpo do POST. */
  token: string;
  kind: CheckinKind;
  /** Id do evento ou da aula embutido no token. */
  id: number;
}

export interface CheckinResult {
  kind: CheckinKind;
  studentId: number;
  alreadyCheckedIn: boolean;
}

const TOKEN_PATTERN = /^([EL])(\d+)-/i;

/** Aceita o token puro ou a URL inteira (extrai ?token=); normaliza caixa e espacos. */
export function normalizeCheckinInput(input: string): string {
  const raw = input.trim();
  let candidate = raw;
  if (/token=/i.test(raw)) {
    try {
      candidate = new URL(raw, "http://local").searchParams.get("token") ?? raw;
    } catch {
      candidate = /token=([^&#\s]+)/i.exec(raw)?.[1] ?? raw;
    }
  }
  return candidate.replace(/\s+/g, "").toUpperCase();
}

/** Extrai tipo/id do codigo; null se o formato for invalido. */
export function parseCheckinToken(input: string): ParsedCheckin | null {
  const token = normalizeCheckinInput(input);
  const match = TOKEN_PATTERN.exec(token);
  if (!match) return null;
  const id = Number(match[2]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { token, kind: match[1]!.toUpperCase() === "E" ? "EVENTO" : "AULA", id };
}

interface EventCheckinResponse {
  studentId: number;
  alreadyCheckedIn: boolean;
}

/** Chama o endpoint certo (evento ou aula). So envia campos conhecidos: o backend usa forbidNonWhitelisted. */
export async function submitCheckin(parsed: ParsedCheckin, studentId?: number): Promise<CheckinResult> {
  const body = studentId === undefined ? { token: parsed.token } : { token: parsed.token, studentId };
  const path = parsed.kind === "EVENTO" ? `/events/${parsed.id}/checkin-self` : "/attendance/self-checkin";
  const response = await api.post<EventCheckinResponse>(path, body);
  return {
    kind: parsed.kind,
    studentId: response?.studentId ?? studentId ?? 0,
    alreadyCheckedIn: response?.alreadyCheckedIn === true,
  };
}
