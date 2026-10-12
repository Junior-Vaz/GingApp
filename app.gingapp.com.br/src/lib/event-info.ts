import { fmt, formatCurrency, toDate } from "@/lib/format";

/**
 * Vagas, preco, situacao e recorrencia de eventos/rodas. Campos novos do contrato da API (GET /events e
 * GET /calendar); todos OPCIONAIS: backend antigo nao os envia e a tela simplesmente nao mostra nada.
 */
export type EventStatus = "DRAFT" | "PUBLISHED" | "CANCELLED" | "CLOSED";

/** Campos brutos de capacidade/preco/situacao/recorrencia que chegam na listagem. */
export interface EventInfoFields {
  /** Total de vagas; null = ilimitado. */
  capacity?: number | null;
  /** Vagas restantes; null = ilimitado; 0 = lotado. */
  spotsLeft?: number | null;
  /** Quantos estao na lista de espera. */
  waitlistCount?: number;
  /** Preco em centavos (informativo, sem pagamento online); null/0 = gratuito. */
  priceCents?: number | null;
  /** Prazo final das inscricoes (ISO) ou null. */
  registrationDeadline?: string | null;
  /** Situacao do evento em GET /events. */
  status?: EventStatus | string;
  /** Situacao do evento em GET /calendar (so PUBLISHED/CLOSED aparecem la). */
  eventStatus?: EventStatus | string;
  /** Roda que faz parte de uma serie recorrente (GET /calendar). */
  inSeries?: boolean;
  /** Regra legivel da recorrencia, ex.: 'toda 1a sexta do mes' (GET /calendar). */
  recurrenceRule?: string | null;
}

/** Subconjunto normalizado guardado no Encounter (a situacao vira sempre `eventStatus`). */
export interface EncounterInfo {
  capacity?: number | null;
  spotsLeft?: number | null;
  waitlistCount?: number;
  priceCents?: number | null;
  registrationDeadline?: string | null;
  eventStatus?: string;
  inSeries?: boolean;
  recurrenceRule?: string | null;
}

/** Copia SO os campos presentes (nao cria chaves `undefined`: backend antigo => Encounter sem esses campos). */
export function pickEventInfo(source: EventInfoFields): EncounterInfo {
  const info: EncounterInfo = {};
  if (source.capacity !== undefined) info.capacity = source.capacity;
  if (source.spotsLeft !== undefined) info.spotsLeft = source.spotsLeft;
  if (source.waitlistCount !== undefined) info.waitlistCount = source.waitlistCount;
  if (source.priceCents !== undefined) info.priceCents = source.priceCents;
  if (source.registrationDeadline !== undefined) info.registrationDeadline = source.registrationDeadline;
  const status = source.eventStatus ?? source.status;
  if (status !== undefined) info.eventStatus = status;
  if (source.inSeries !== undefined) info.inSeries = source.inSeries;
  if (source.recurrenceRule !== undefined) info.recurrenceRule = source.recurrenceRule;
  return info;
}

/** '12 vagas restantes' / '1 vaga restante' / 'Lotado' / 'Vagas ilimitadas'; null se o servidor nao informou capacidade. */
export function spotsLabel(info: EncounterInfo): string | null {
  if (info.capacity === undefined) return null;
  if (info.capacity === null || info.spotsLeft === null) return "Vagas ilimitadas";
  if (info.spotsLeft === undefined) return null;
  if (info.spotsLeft <= 0) return "Lotado";
  return info.spotsLeft === 1 ? "1 vaga restante" : `${info.spotsLeft} vagas restantes`;
}

/** 'Gratuito' (sem preco ou 0) ou 'R$ 150,00'; null se o servidor nao informou o campo. */
export function priceLabel(info: EncounterInfo): string | null {
  if (info.priceCents === undefined) return null;
  return info.priceCents === null || info.priceCents <= 0 ? "Gratuito" : formatCurrency(info.priceCents);
}

export interface EventSituation {
  label: string;
  /** true = nao aceita mais inscricoes novas (cancelado, encerrado ou prazo vencido). */
  closed: boolean;
}

/** Cancelado / Encerrado / prazo vencido / 'Inscricoes ate dd/MM'; null quando nada a destacar. */
export function eventSituation(info: EncounterInfo, now: Date = new Date()): EventSituation | null {
  if (info.eventStatus === "CANCELLED") return { label: "Cancelado", closed: true };
  if (info.eventStatus === "CLOSED") return { label: "Encerrado", closed: true };
  if (info.registrationDeadline) {
    const deadline = toDate(info.registrationDeadline);
    if (Number.isNaN(deadline.getTime())) return null;
    if (deadline.getTime() < now.getTime()) return { label: "Inscrições encerradas", closed: true };
    return { label: `Inscrições até ${fmt(deadline, "dd/MM")}`, closed: false };
  }
  return null;
}

export function waitlistLabel(info: EncounterInfo): string | null {
  const count = info.waitlistCount ?? 0;
  return count > 0 ? `${count} na lista de espera` : null;
}

/** Texto da regra de recorrencia quando a roda e recorrente (`null` = nao e); '' = recorrente sem regra legivel. */
export function recurrenceText(info: EncounterInfo): string | null {
  if (info.inSeries || info.recurrenceRule) return info.recurrenceRule ?? "";
  return null;
}
