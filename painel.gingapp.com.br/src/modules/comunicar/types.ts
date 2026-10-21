/** Tipos do módulo Comunicar (contrato: docs/CONTRATO_FEED_ANIVERSARIOS_COMUNICACAO.md, seção 3). */

export type ScopeType = "GROUP" | "UNIT" | "CLASS" | "ROLE" | "BIRTHDAY_MONTH";
export type CommRole = "ALUNO" | "RESPONSAVEL" | "EQUIPE";
export type AckMode = "NONE" | "READ" | "GOING";
export type CommStatus = "SENT" | "SCHEDULED" | "CANCELLED";
export type AckResponse = "READ" | "GOING" | "NOT_GOING";

export const SCOPE_LABEL: Record<ScopeType, string> = {
  GROUP: "Todo o grupo",
  UNIT: "Uma unidade",
  CLASS: "Uma turma",
  ROLE: "Por papel",
  BIRTHDAY_MONTH: "Aniversariantes do mês",
};

export const ROLE_LABEL: Record<CommRole, string> = {
  ALUNO: "Alunos",
  RESPONSAVEL: "Responsáveis",
  EQUIPE: "Equipe",
};

export const ACK_LABEL: Record<AckMode, string> = {
  NONE: "Nenhuma",
  READ: "“Li” (confirmar leitura)",
  GOING: "“Vou” (confirmar presença)",
};

export const STATUS_LABEL: Record<CommStatus, string> = {
  SENT: "Enviado",
  SCHEDULED: "Agendado",
  CANCELLED: "Cancelado",
};

/** Alcance enviado em POST /communications. */
export interface CommScope {
  type: ScopeType;
  unitId?: number;
  classId?: number;
  role?: CommRole;
}

/** GET /communications/preview. */
export interface PreviewResult {
  count: number;
  sample: { name: string }[];
}

/** Corpo de POST /communications. */
export interface CreateCommunicationInput {
  title: string;
  body: string;
  imageUrl?: string;
  scope: CommScope;
  scheduledAt?: string;
  requiresAck?: AckMode;
  pinToFeed?: boolean;
  pinnedUntil?: string;
  confirmCount: number;
}

export interface CreateCommunicationResult {
  id: number;
  status: "SENT" | "SCHEDULED";
  recipients: number;
}

/** Item de GET /communications. */
export interface CommunicationItem {
  id: number;
  title: string;
  status: CommStatus;
  scopeType: ScopeType;
  scheduledAt: string | null;
  sentAt: string | null;
  recipientsCount: number;
  readCount: number;
  ackCount: number;
  requiresAck: AckMode;
  pinToFeed: boolean;
  /** Fixado até (só com `pinToFeed`); `null` = sem prazo. Acréscimo do backend real. */
  pinnedUntil: string | null;
  /** Último "reenviar para quem não leu" (o backend barra um novo em 24 h). Acréscimo do backend real. */
  lastResendAt: string | null;
  createdAt: string;
  /** `null` quando o autor foi removido. */
  createdByName: string | null;
}

/** Alcance devolvido por GET /communications/:id: todas as chaves sempre presentes (`null` quando não se aplicam). */
export interface CommunicationScopeView {
  type: ScopeType | null;
  unitId: number | null;
  unitName: string | null;
  classId: number | null;
  className: string | null;
  role: CommRole | null;
}

/** GET /communications/:id (lista + corpo, alcance e confirmações). */
export interface CommunicationDetail extends CommunicationItem {
  body: string;
  imageUrl: string | null;
  scope: CommunicationScopeView;
  acks: { READ: number; GOING: number; NOT_GOING: number };
  pending: number;
}

/**
 * POST /communications/:id/resend-unread (201): `{ sent }` = quantas notificações de lembrete foram criadas.
 * `sent: 0` = ninguém a quem reenviar (todos já leram/confirmaram); nesse caso o direito de 24 h NÃO é gasto.
 */
export interface ResendResult {
  sent: number;
}
