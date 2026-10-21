import { createFileRoute, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { canAccessRoute, homeFor, ROUTE_FORBIDDEN_MESSAGE } from "@/lib/nav";
import { getUser } from "@/lib/session";
import { FeedModeracaoPage } from "@/modules/feed";

// Feed do grupo: moderação para MESTRE, PROFESSOR e INSTRUTOR (as configurações do feed são só do MESTRE e o MONITOR
// não modera). O backend também responde 403; isto é só a barreira de UX.
export const Route = createFileRoute("/_app/feed-moderacao")({
  beforeLoad: () => {
    if (!canAccessRoute(getUser()?.role, "/feed-moderacao")) {
      toast.error(ROUTE_FORBIDDEN_MESSAGE);
      throw redirect({ to: homeFor(getUser()?.role) });
    }
  },
  head: () => ({ meta: [{ title: "Feed do grupo — Painel GingApp" }] }),
  component: FeedModeracaoPage,
});
