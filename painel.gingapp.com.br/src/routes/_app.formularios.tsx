import { createFileRoute, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { canAccessRoute, homeFor, ROUTE_FORBIDDEN_MESSAGE } from "@/lib/nav";
import { getUser } from "@/lib/session";
import { FormulariosPage } from "@/modules/formularios";

// Formulários de inscrição: quem gerencia eventos (MESTRE, PROFESSOR, INSTRUTOR). O MONITOR (só leitura) volta ao início
// com aviso. O backend também responde 403 (CanAccessGuard); isto é só a barreira de UX.
export const Route = createFileRoute("/_app/formularios")({
  beforeLoad: () => {
    if (!canAccessRoute(getUser()?.role, "/formularios")) {
      toast.error(ROUTE_FORBIDDEN_MESSAGE);
      throw redirect({ to: homeFor(getUser()?.role) });
    }
  },
  head: () => ({ meta: [{ title: "Formulários de inscrição — Painel GingApp" }] }),
  component: FormulariosPage,
});
