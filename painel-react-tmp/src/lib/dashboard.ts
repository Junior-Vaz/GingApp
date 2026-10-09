import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** Contrato de GET /dashboard (backend: DashboardService.getSummary). */
export interface DashboardSummary {
  students: { active: number; new30d: number; inactive: number };
  classes: { active: number };
  lessonsToday: number;
  finance: {
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
