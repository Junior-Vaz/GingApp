import { createFileRoute, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { canAccessRoute, homeFor, ROUTE_FORBIDDEN_MESSAGE } from "@/lib/nav";
import { getUser } from "@/lib/session";
import { ProfessoresPage } from "@/modules/professores/professores-page";

export const Route = createFileRoute("/_app/professores")({
  // Equipe: o MONITOR não tem teachers:view (mesma regra do menu, `roles` em NAV_ITEMS); é levado à tela inicial dele com aviso, sem perder a sessão.
  beforeLoad: () => {
    if (!canAccessRoute(getUser()?.role, "/professores")) {
      toast.error(ROUTE_FORBIDDEN_MESSAGE);
      throw redirect({ to: homeFor(getUser()?.role) });
    }
  },
  head: () => ({ meta: [{ title: "Equipe — Painel GingApp" }] }),
  component: ProfessoresPage,
});
