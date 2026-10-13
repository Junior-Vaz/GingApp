/** Redes sociais do grupo (todas opcionais; só URLs http/https). */
export type OrganizationSocialLinks = Partial<
  Record<"instagram" | "youtube" | "tiktok" | "facebook" | "whatsapp", string | null>
>;

/** GET /organizations devolve a propria organização do MEMBER (objeto); PLATFORM recebe lista. */
export interface Organization {
  id: number;
  name: string;
  slug: string;
  type: string;
  status: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  /** Perfil institucional (PATCH /organizations/me): ausentes em respostas antigas = não informado. */
  logo?: string | null;
  description?: string | null;
  history?: string | null;
  foundedYear?: number | null;
  city?: string | null;
  state?: string | null;
  website?: string | null;
  /** "Como pagar" mostrado ao aluno/responsável no app (E07). */
  paymentInstructions?: string | null;
  /** Mapa da comunidade: false esconde o grupo de GET /map/places (ausente em respostas antigas = true). */
  mapVisible?: boolean;
  /** Avisar responsáveis e alunos (notificação) quando a presença é registrada. Ausente em respostas antigas = desligado. */
  attendanceNotifications?: boolean;
  socialLinks?: OrganizationSocialLinks | null;
}

type SubscriptionStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED";

export interface Subscription {
  id: number;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  plan: { id: number; name: string; priceCents: number; maxStudents: number | null; maxUnits: number | null };
}

export const SUBSCRIPTION_LABEL: Record<SubscriptionStatus, string> = {
  TRIALING: "Em teste",
  ACTIVE: "Ativa",
  PAST_DUE: "Pagamento pendente",
  CANCELED: "Cancelada",
  EXPIRED: "Expirada",
};

/** Percentual de uso do limite do plano (null = ilimitado). Regra portada do ConfiguraçõesView.vue. */
export function usagePercent(used: number, max: number | null | undefined): number | null {
  if (!max) return null;
  return Math.min(100, Math.round((used / max) * 100));
}
