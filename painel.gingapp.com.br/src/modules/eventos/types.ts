import type { ParticipantStatus } from "@/modules/rodas/types";

export const EVENT_TYPE_LABEL: Record<string, string> = {
  BATIZADO: "Batizado",
  WORKSHOP: "Workshop",
  CAMPEONATO: "Campeonato",
  FESTIVAL: "Festival",
  ENCONTRO: "Encontro",
  FORMATURA: "Formatura",
  VIAGEM: "Viagem",
  AULA_ESPECIAL: "Aula especial",
  OUTRO: "Outro",
};

export const EVENT_TYPES = Object.keys(EVENT_TYPE_LABEL);

export type EventStatus = "DRAFT" | "PUBLISHED" | "CANCELLED" | "CLOSED";

export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  DRAFT: "Rascunho",
  PUBLISHED: "Publicado",
  CANCELLED: "Cancelado",
  CLOSED: "Encerrado",
};

export const EVENT_STATUSES = Object.keys(EVENT_STATUS_LABEL) as EventStatus[];

export interface EventItem {
  id: number;
  unitId: number | null;
  title: string;
  description: string | null;
  date: string;
  location: string | null;
  /** Posição no mapa da comunidade (opcional). */
  latitude?: number | null;
  longitude?: number | null;
  isPublic: boolean;
  type: string;
  stateId: number | null;
  cityId: number | null;
  imageUrl: string | null;
  /** Vagas (`null`/ausente = ilimitado). */
  capacity?: number | null;
  /** Valor informativo da inscrição em centavos (`null`/0 = gratuito). */
  priceCents?: number | null;
  status?: EventStatus;
  /** Prazo de inscrição dos alunos (ISO); `null` = sem prazo. */
  registrationDeadline?: string | null;
  /** Total de inscrições (qualquer situação). */
  participantsCount?: number;
  /** Inscrições CONFIRMED + ATTENDED. */
  confirmedCount?: number;
  waitlistCount?: number;
  /** Vagas restantes (`null` = ilimitado). */
  spotsLeft?: number | null;
}

export interface EventPayload {
  title?: string | undefined;
  date?: string | undefined;
  type?: string | undefined;
  isPublic?: boolean | undefined;
  /** Posição no mapa: o par junto; `null`/`null` limpa; omitido = não mexe (o servidor geocodifica se o local mudou). */
  latitude?: number | null | undefined;
  longitude?: number | null | undefined;
  /** Opcionais: `null` LIMPA a coluna no PATCH (e `""` em imageUrl daria 400); omitido = não mexe. */
  description?: string | null | undefined;
  location?: string | null | undefined;
  unitId?: number | null | undefined;
  stateId?: number | null | undefined;
  cityId?: number | null | undefined;
  imageUrl?: string | null | undefined;
  /** `null` = vagas ilimitadas. */
  capacity?: number | null | undefined;
  /** Centavos; `null` = gratuito. */
  priceCents?: number | null | undefined;
  status?: EventStatus | undefined;
  /** ISO; `null` limpa o prazo. */
  registrationDeadline?: string | null | undefined;
}

export interface EventParticipant {
  id: number;
  eventId: number;
  studentId: number | null;
  guestName: string | null;
  status: ParticipantStatus;
  student: { id: number; name: string } | null;
}

export interface ParticipantPayload {
  studentId?: number | undefined;
  guestName?: string | undefined;
  status?: ParticipantStatus | undefined;
  /** Evento lotado: entra na lista de espera em vez de receber 409 EVENT_FULL. */
  joinWaitlist?: boolean | undefined;
}