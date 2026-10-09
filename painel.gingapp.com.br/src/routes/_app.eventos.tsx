import { createFileRoute } from "@tanstack/react-router";
import { EventosPage } from "@/modules/eventos";

export const Route = createFileRoute("/_app/eventos")({
  head: () => ({ meta: [{ title: "Eventos — Painel GingApp" }] }),
  component: EventosPage,
});