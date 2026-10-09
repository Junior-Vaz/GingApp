import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** Contrato de GET /dashboard (backend: DashboardService.getSummary). */
export interface DashboardSummary {
  students: { active: number; new30d: number; inactive: number };
  classes: { active: number };
  lessonsToday: number;
  /** Só vem para quem tem finance:view (MESTRE). Para o PROFESSOR a chave não existe. */
  finance?: {
    pendingCount: number;
    pendingCents: number;
    overdueCount: number;
    overdueCents: number;
  };
  attendance: { last30dPercent: number | null };
  graduations: { last30d: number };
  upcomingEvents: Array<{ id: number; title: string; date: string; location: string | null }>;
}

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardSummary>("/dashboard"),
  });
}
