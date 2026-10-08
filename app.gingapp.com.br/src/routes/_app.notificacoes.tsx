import { createFileRoute } from "@tanstack/react-router";
import { NotificationsPage } from "@/components/gingapp/pages";

export const Route = createFileRoute("/_app/notificacoes")({
  head: () => ({ meta: [{ title: "Meus recados — GingApp" }] }),
  component: NotificationsPage,
});
