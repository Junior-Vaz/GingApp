export type Recurrence = "NONE" | "WEEKLY" | "MONTHLY_WEEKDAY" | "MONTHLY_DAY";

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  NONE: "Não se repete",
  WEEKLY: "Toda semana (mesmo dia da semana)",
  MONTHLY_WEEKDAY: "Todo mês no mesmo dia da semana (ex.: toda 1ª sexta)",
  MONTHLY_DAY: "Todo mês no mesmo dia do mês",
};

export const RECURRENCES = Object.keys(RECURRENCE_LABEL) as Recurrence[];

export interface Roda {
  id: number;
  organizationId: number | null;
  communityId: number | null;
  stateId: number | null;
  cityId: number | null;
  title: string;
  description: string | null;
  date: string;
  location: string | null;
  /** Posição no mapa da comunidade (opcional). */
  latitude?: number | null;
  longitude?: number | null;
  imageUrl: string | null;
  /** Regra de repetição da roda "mãe" (derivada da data dela). */
  recurrence?: Recurrence;
  /** Último dia da série (ISO ou yyyy-MM-dd); `null` = sem fim. */
  recurrenceUntil?: string | null;
  /** Preenchido nas ocorrências geradas (id da roda mãe). */
  parentRodaId?: number | null;
}

/** Roda "mãe" de uma série (recorrente e que não é ela mesma uma ocorrência gerada). */
export const isSeriesParent = (roda: Roda): boolean => !roda.parentRodaId && !!roda.recurrence && roda.recurrence !== "NONE";

/** Ocorrências futuras mantidas abertas por padrão e o máximo aceito por POST /rodas/:id/generate-occurrences. */
export const DEFAULT_OCCURRENCES = 3;
export const MAX_OCCURRENCES = 12;

/** POST /rodas/:id/generate-occurrences (idempotente). */
export interface GenerateOccurrencesResult {
  rule: string | null;
  created: number;
  occurrences: Roda[];
}

export interface RodaPayload {
  title?: string | undefined;
  date?: string | undefined;
  /** Posição no mapa: o par junto; `null`/`null` limpa; omitido = não mexe (o servidor geocodifica se o local mudou). */
  latitude?: number | null | undefined;
  longitude?: number | null | undefined;
  /** Opcionais: `null` LIMPA a coluna no PATCH (e `""` em imageUrl daria 400); omitido = não mexe. */
  description?: string | null | undefined;
  location?: string | null | undefined;
  stateId?: number | null | undefined;
  cityId?: number | null | undefined;
  communityId?: number | null | undefined;
  imageUrl?: string | null | undefined;
  /** Ocorrências geradas (parentRodaId) não aceitam recurrence != NONE (400): não envie. */
  recurrence?: Recurrence | undefined;
  /** yyyy-MM-dd; `null` limpa o fim da série. */
  recurrenceUntil?: string | null | undefined;
}

export interface State {
  id: number;
  name: string;
  uf: string;
}

export interface City {
  id: number;
  name: string;
  stateId: number;
}

/** WAITLIST: só eventos (lista de espera; não ocupa vaga e é promovido a CONFIRMED quando abre vaga). */
export type ParticipantStatus = "INVITED" | "CONFIRMED" | "DECLINED" | "ATTENDED" | "CANCELLED" | "WAITLIST";

export const PARTICIPANT_STATUS_LABEL: Record<ParticipantStatus, string> = {
  INVITED: "Convidado",
  CONFIRMED: "Confirmado",
  DECLINED: "Recusou",
  ATTENDED: "Compareceu",
  CANCELLED: "Cancelado",
  WAITLIST: "Lista de espera",
};

export interface RodaParticipant {
  id: number;
  rodaId: number;
  userId: number | null;
  studentId: number | null;
  guestName: string | null;
  status: ParticipantStatus;
  user: { id: number; name: string } | null;
  student: { id: number; name: string } | null;
}