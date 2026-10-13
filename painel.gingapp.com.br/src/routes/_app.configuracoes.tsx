import { createFileRoute, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { canAccessRoute, homeFor, ROUTE_FORBIDDEN_MESSAGE } from "@/lib/nav";
import { getUser } from "@/lib/session";
import { ConfiguracoesPage } from "@/modules/configuracoes/configuracoes-page";

export const Route = createFileRoute("/_app/configuracoes")({
  // Configurações é só do MESTRE (mesma regra do menu, `roles` em NAV_ITEMS). O PROFESSOR abrindo por
  // URL direta é levado ao /dashboard com aviso, sem perder a sessão - igual ao /financeiro.
  beforeLoad: () => {
    if (!canAccessRoute(getUser()?.role, "/configuracoes")) {
      toast.error(ROUTE_FORBIDDEN_MESSAGE);
      throw redirect({ to: homeFor(getUser()?.role) });
    }
  },
  head: () => ({ meta: [{ title: "Configurações — Painel GingApp" }] }),
  component: ConfiguracoesPage,
});
