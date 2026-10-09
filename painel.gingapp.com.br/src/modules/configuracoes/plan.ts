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
