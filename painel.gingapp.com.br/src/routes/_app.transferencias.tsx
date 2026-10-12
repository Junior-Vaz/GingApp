import { createFileRoute, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { canAccessRoute, ROUTE_FORBIDDEN_MESSAGE } from "@/lib/nav";
import { getUser } from "@/lib/session";
import { TransferenciasPage } from "@/modules/transferencias/transferencias-page";

export const Route = createFileRoute("/_app/transferencias")({
  // Transferências entre grupos são só do MESTRE (mesma regra do menu, `roles` em NAV_ITEMS; o backend também recusa com 403).
  beforeLoad: () => {
    if (!canAccessRoute(getUser()?.role, "/transferencias")) {
      toast.error(ROUTE_FORBIDDEN_MESSAGE);
      throw redirect({ to: "/dashboard" });
    }
  },
  head: () => ({ meta: [{ title: "Transferências — Painel GingApp" }] }),
  component: TransferenciasPage,
});
