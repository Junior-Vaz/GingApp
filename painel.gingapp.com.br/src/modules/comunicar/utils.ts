import { ApiError, errorMessage } from "@/lib/api";
import type { OrgRole } from "@/lib/session";
import { fmt, toDate } from "@/lib/format";
import { plural } from "@/lib/plural";
import type { CommRole, CommScope, CommStatus, CommunicationItem, ResendResult, ScopeType } from "./types";

export const TITLE_MIN = 2;
export const TITLE_MAX = 80;
export const BODY_MIN = 2;
export const BODY_MAX = 2000;
/** O envio agendado vale até 90 dias à frente (contrato). */
export const MAX_SCHEDULE_DAYS = 90;
/** Acima disso o servidor exige `confirmCount` igual à contagem atual (RECIPIENTS_CHANGED); o painel sempre envia. */
export const BIG_SEND_THRESHOLD = 50;

/** Alcances que cada papel pode escolher: MESTRE todos; PROFESSOR/INSTRUTOR só a turma (as próprias). */
export function allowedScopes(role: OrgRole | undefined): ScopeType[] {
  if (role === "MESTRE") return ["GROUP", "UNIT", "CLASS", "ROLE", "BIRTHDAY_MONTH"];
  if (role === "PROFESSOR" || role === "INSTRUTOR") return ["CLASS"];
  return [];
}

export interface ScopePick {
  type: ScopeType | "";
  unitId: string;
  classId: string;
  role: CommRole | "";
}

/** Alcance pronto para a API; `null` = falta escolher o alvo (unidade, turma ou papel). */
export function buildScope(pick: ScopePick): CommScope | null {
  switch (pick.type) {
    case "GROUP":
    case "BIRTHDAY_MONTH":
      return { type: pick.type };
    case "UNIT":
      return pick.unitId ? { type: "UNIT", unitId: Number(pick.unitId) } : null;
    case "CLASS":
      return pick.classId ? { type: "CLASS", classId: Number(pick.classId) } : null;
    case "ROLE":
      return pick.role ? { type: "ROLE", role: pick.role } : null;
    default:
      return null;
  }
}

/** Query de GET /communications/preview (`scope` é o tipo; o resto são os alvos). */
export function previewParams(scope: CommScope): Record<string, string | number> {
  return {
    scope: scope.type,
    ...(scope.unitId !== undefined ? { unitId: scope.unitId } : {}),
    ...(scope.classId !== undefined ? { classId: scope.classId } : {}),
    ...(scope.role !== undefined ? { role: scope.role } : {}),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Date -> valor de <input type="datetime-local"> (hora local, sem fuso). */
export function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Date -> valor de <input type="date">. */
export function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function scheduleBounds(now: Date = new Date()): { min: string; max: string } {
  const min = new Date(now.getTime() + 60_000);
  const max = new Date(now.getTime() + MAX_SCHEDULE_DAYS * 86_400_000);
  return { min: toLocalInput(min), max: toLocalInput(max) };
}

/** Valida a data/hora do agendamento (futura, até 90 dias). Devolve o ISO ou a mensagem de erro. */
export function parseSchedule(local: string, now: Date = new Date()): { iso: string } | { error: string } {
  if (!local) return { error: "Escolha a data e a hora do envio." };
  const date = new Date(local);
  if (Number.isNaN(date.getTime())) return { error: "Data e hora inválidas." };
  if (date.getTime() <= now.getTime() + 30_000) return { error: "Escolha um horário no futuro." };
  if (date.getTime() > now.getTime() + MAX_SCHEDULE_DAYS * 86_400_000) {
    return { error: `O agendamento vai até ${MAX_SCHEDULE_DAYS} dias a partir de hoje.` };
  }
  return { iso: date.toISOString() };
}

/** "Fixar até" (só a data): vale até o fim desse dia. Precisa ser depois do envio. */
export function parsePinnedUntil(day: string, after: Date): { iso: string } | { error: string } | null {
  if (!day) return null;
  const date = new Date(`${day}T23:59:00`);
  if (Number.isNaN(date.getTime())) return { error: "Data de fixação inválida." };
  if (date.getTime() <= after.getTime()) return { error: "A data para fixar precisa ser depois do envio." };
  return { iso: date.toISOString() };
}

export interface TextCheck {
  titleOk: boolean;
  bodyOk: boolean;
}

export function checkText(title: string, body: string): TextCheck {
  const t = title.trim().length;
  const b = body.trim().length;
  return { titleOk: t >= TITLE_MIN && t <= TITLE_MAX, bodyOk: b >= BODY_MIN && b <= BODY_MAX };
}

/** Mensagem amigável por código de negócio do backend; o resto cai no texto do servidor/reserva. */
export function commErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "COMM_QUOTA_EXCEEDED":
        return "O limite de envios de hoje foi atingido. Tente novamente amanhã ou fale com o Mestre do grupo.";
      case "RESEND_TOO_SOON":
        return "Esta mensagem já foi reenviada nas últimas 24 horas. Tente de novo mais tarde.";
      case "ALREADY_SENT":
        return "Esta mensagem já foi enviada e não pode mais ser cancelada.";
      case "RECIPIENTS_CHANGED":
        return "A lista de destinatários mudou. Confira a nova quantidade e confirme de novo.";
      default:
    }
    if (error.status === 403) {
      // O backend diz o motivo em português ("Você só pode enviar para as suas turmas.", "Apenas o Mestre pode enviar para
      // este alcance."); só o 403 sem texto próprio ("Forbidden"/"Erro 403 ao chamar…") cai na frase genérica.
      const own = error.message && !/^(Forbidden|Erro \d+)/i.test(error.message) ? error.message : null;
      return own ?? "Você não tem permissão para esta ação.";
    }
    if (error.status === 429) return "Muitas tentativas seguidas. Aguarde um instante e tente de novo.";
    return error.message || fallback;
  }
  if (error instanceof TypeError) return "Sem conexão com o servidor. Verifique a internet e tente de novo.";
  return errorMessage(error, fallback);
}

/**
 * Texto do aviso depois de "reenviar para quem não leu". O backend responde 201 `{ sent: n }`; `sent: 0` = não havia
 * ninguém sem ler (nada foi enviado e o direito de 24 h não foi gasto). Resposta sem `sent` (backend antigo) = texto genérico.
 */
export function resendMessage(result: Partial<ResendResult> | null | undefined): string {
  const sent = result?.sent;
  if (typeof sent !== "number" || !Number.isFinite(sent)) return "Mensagem reenviada para quem não leu.";
  if (sent <= 0) return "Ninguém ficou sem ler: não há para quem reenviar.";
  return `Mensagem reenviada para ${plural(sent, "pessoa")}.`;
}

/** Nova contagem do 409 RECIPIENTS_CHANGED (`{count}` no corpo), ou `null` se não veio. */
export function changedCount(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.code !== "RECIPIENTS_CHANGED") return null;
  const count = error.body?.["count"];
  return typeof count === "number" && Number.isFinite(count) ? count : null;
}

export const STATUS_VARIANT: Record<CommStatus, "default" | "secondary" | "outline" | "destructive"> = {
  SENT: "default",
  SCHEDULED: "outline",
  CANCELLED: "secondary",
};

/** Data que importa em cada situação: quando foi enviada, para quando está agendada, ou quando foi criada. */
export function whenOf(item: Pick<CommunicationItem, "status" | "scheduledAt" | "sentAt" | "createdAt">): string {
  const iso = item.status === "SCHEDULED" ? (item.scheduledAt ?? item.createdAt) : (item.sentAt ?? item.scheduledAt ?? item.createdAt);
  return fmt(toDate(iso), "dd/MM/yyyy HH:mm");
}
