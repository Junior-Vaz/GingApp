import { createFileRoute, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { canAccessRoute, homeFor, ROUTE_FORBIDDEN_MESSAGE } from "@/lib/nav";
import { getUser } from "@/lib/session";
import { CertificadosPage } from "@/modules/certificados/certificados-page";

export const Route = createFileRoute("/_app/certificados")({
  // Certificados: o MONITOR não tem certificates:view (mesma regra do menu, `roles` em NAV_ITEMS); é levado à tela inicial dele com aviso, sem perder a sessão.
  beforeLoad: () => {
    if (!canAccessRoute(getUser()?.role, "/certificados")) {
      toast.error(ROUTE_FORBIDDEN_MESSAGE);
      throw redirect({ to: homeFor(getUser()?.role) });
    }
  },
  head: () => ({ meta: [{ title: "Certificados — Painel GingApp" }] }),
  component: CertificadosPage,
});
