import { createFileRoute, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { canAccessRoute, homeFor, ROUTE_FORBIDDEN_MESSAGE } from "@/lib/nav";
import { getUser } from "@/lib/session";
import { PatrocinadoresPage } from "@/modules/patrocinadores";

export const Route = createFileRoute("/_app/patrocinadores")({
  // Patrocinadores do grupo são só do MESTRE (mesma regra do menu, `roles` em NAV_ITEMS; o backend também recusa com 403).
  beforeLoad: () => {
    if (!canAccessRoute(getUser()?.role, "/patrocinadores")) {
      toast.error(ROUTE_FORBIDDEN_MESSAGE);
      throw redirect({ to: homeFor(getUser()?.role) });
    }
  },
  head: () => ({ meta: [{ title: "Patrocinadores — Painel GingApp" }] }),
  component: PatrocinadoresPage,
});
