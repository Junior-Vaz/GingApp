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

export interface EventItem {
  id: number;
  unitId: number | null;
  title: string;
  description: string | null;
  date: string;
  location: string | null;
  isPublic: boolean;
  type: string;
  stateId: number | null;
  cityId: number | null;
  imageUrl: string | null;
}

export interface EventPayload {
  title?: string | undefined;
  date?: string | undefined;
  type?: string | undefined;
  isPublic?: boolean | undefined;
  /** Opcionais: `null` LIMPA a coluna no PATCH (e `""` em imageUrl daria 400); omitido = não mexe. */
  description?: string | null | undefined;
  location?: string | null | undefined;
  unitId?: number | null | undefined;
  stateId?: number | null | undefined;
  cityId?: number | null | undefined;
  imageUrl?: string | null | undefined;
}

export interface Unit {
  id: number;
  name: string;
}

export interface StudentOption {
  id: number;
  name: string;
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
}