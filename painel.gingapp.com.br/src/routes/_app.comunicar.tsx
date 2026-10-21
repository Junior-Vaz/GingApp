import { createFileRoute, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { canAccessRoute, homeFor, ROUTE_FORBIDDEN_MESSAGE } from "@/lib/nav";
import { getUser } from "@/lib/session";
import { ComunicarPage } from "@/modules/comunicar";

// Comunicar: quem cria comunicados (MESTRE, PROFESSOR, INSTRUTOR). O MONITOR (só leitura) volta ao início com aviso.
// O backend também responde 403 (CanAccessGuard); isto é só a barreira de UX.
export const Route = createFileRoute("/_app/comunicar")({
  beforeLoad: () => {
    if (!canAccessRoute(getUser()?.role, "/comunicar")) {
      toast.error(ROUTE_FORBIDDEN_MESSAGE);
      throw redirect({ to: homeFor(getUser()?.role) });
    }
  },
  head: () => ({ meta: [{ title: "Comunicar — Painel GingApp" }] }),
  component: ComunicarPage,
});
