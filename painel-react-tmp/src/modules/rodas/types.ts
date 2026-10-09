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
  imageUrl: string | null;
}

export interface RodaPayload {
  title?: string | undefined;
  description?: string | undefined;
  date?: string | undefined;
  location?: string | undefined;
  stateId?: number | undefined;
  cityId?: number | undefined;
  imageUrl?: string | undefined;
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

export type ParticipantStatus = "INVITED" | "CONFIRMED" | "DECLINED" | "ATTENDED" | "CANCELLED";

export const PARTICIPANT_STATUS_LABEL: Record<ParticipantStatus, string> = {
  INVITED: "Convidado",
  CONFIRMED: "Confirmado",
  DECLINED: "Recusou",
  ATTENDED: "Compareceu",
  CANCELLED: "Cancelado",
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