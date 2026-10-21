import { createFileRoute, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { canAccessRoute, homeFor, ROUTE_FORBIDDEN_MESSAGE } from "@/lib/nav";
import { getUser } from "@/lib/session";
import { AniversariantesPage } from "@/modules/aniversariantes";

// Aniversariantes: MESTRE, PROFESSOR e INSTRUTOR. O MONITOR volta ao início com aviso. O backend também responde 403;
// isto é só a barreira de UX.
export const Route = createFileRoute("/_app/aniversariantes")({
  beforeLoad: () => {
    if (!canAccessRoute(getUser()?.role, "/aniversariantes")) {
      toast.error(ROUTE_FORBIDDEN_MESSAGE);
      throw redirect({ to: homeFor(getUser()?.role) });
    }
  },
  head: () => ({ meta: [{ title: "Aniversariantes — Painel GingApp" }] }),
  component: AniversariantesPage,
});
