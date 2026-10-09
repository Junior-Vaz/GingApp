import { createFileRoute, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { canAccessRoute, ROUTE_FORBIDDEN_MESSAGE } from "@/lib/nav";
import { getUser } from "@/lib/session";
import { UnidadesPage } from "@/modules/unidades/unidades-page";

export const Route = createFileRoute("/_app/unidades")({
  // Unidades é só do MESTRE (mesma regra do menu, `roles` em NAV_ITEMS). O PROFESSOR abrindo por URL
  // direta é levado ao /dashboard com aviso, sem perder a sessão - igual ao /financeiro.
  beforeLoad: () => {
    if (!canAccessRoute(getUser()?.role, "/unidades")) {
      toast.error(ROUTE_FORBIDDEN_MESSAGE);
      throw redirect({ to: "/dashboard" });
    }
  },
  head: () => ({ meta: [{ title: "Unidades — Painel GingApp" }] }),
  component: UnidadesPage,
});
