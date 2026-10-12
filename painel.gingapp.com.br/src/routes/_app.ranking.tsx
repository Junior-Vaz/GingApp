import { createFileRoute, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { canAccessRoute, ROUTE_FORBIDDEN_MESSAGE } from "@/lib/nav";
import { getUser, roleCan } from "@/lib/session";
import { RankingPage } from "@/modules/ranking/ranking-page";

export const Route = createFileRoute("/_app/ranking")({
  // Ranking do grupo: quem vê alunos (MESTRE e PROFESSOR). O backend também recusa com 403.
  beforeLoad: () => {
    const role = getUser()?.role;
    if (!canAccessRoute(role, "/ranking") || !roleCan(role, "students", "view")) {
      toast.error(ROUTE_FORBIDDEN_MESSAGE);
      throw redirect({ to: "/dashboard" });
    }
  },
  head: () => ({ meta: [{ title: "Ranking — Painel GingApp" }] }),
  component: RankingPage,
});
