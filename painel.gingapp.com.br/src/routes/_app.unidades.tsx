import { createFileRoute } from "@tanstack/react-router";
import { UnidadesPage } from "@/modules/unidades/unidades-page";

export const Route = createFileRoute("/_app/unidades")({
  head: () => ({ meta: [{ title: "Unidades — Painel GingApp" }] }),
  component: UnidadesPage,
});
