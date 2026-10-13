import { createFileRoute, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { canAccessRoute, homeFor, ROUTE_FORBIDDEN_MESSAGE } from "@/lib/nav";
import { getUser } from "@/lib/session";
import { DashboardPage } from "@/modules/dashboard/dashboard-page";

export const Route = createFileRoute("/_app/dashboard")({
  // Dashboard: o MONITOR não tem dashboard:view (mesma regra do menu, `roles` em NAV_ITEMS); é levado à tela inicial dele com aviso, sem perder a sessão.
  beforeLoad: () => {
    if (!canAccessRoute(getUser()?.role, "/dashboard")) {
      toast.error(ROUTE_FORBIDDEN_MESSAGE);
      throw redirect({ to: homeFor(getUser()?.role) });
    }
  },
  head: () => ({ meta: [{ title: "Dashboard — Painel GingApp" }] }),
  component: DashboardPage,
});
