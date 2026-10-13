import { createFileRoute, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { canAccessRoute, homeFor, ROUTE_FORBIDDEN_MESSAGE } from "@/lib/nav";
import { getUser } from "@/lib/session";
import { AtividadePage } from "@/modules/atividade/atividade-page";

export const Route = createFileRoute("/_app/atividade")({
  // Atividade do grupo é só do MESTRE (mesma regra do menu, `roles` em NAV_ITEMS; o backend também recusa com 403).
  beforeLoad: () => {
    if (!canAccessRoute(getUser()?.role, "/atividade")) {
      toast.error(ROUTE_FORBIDDEN_MESSAGE);
      throw redirect({ to: homeFor(getUser()?.role) });
    }
  },
  head: () => ({ meta: [{ title: "Atividade do grupo — Painel GingApp" }] }),
  component: AtividadePage,
});
