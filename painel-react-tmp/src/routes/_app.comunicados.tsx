import { createFileRoute } from "@tanstack/react-router";
import { ComunicadosPage } from "@/modules/comunicados/comunicados-page";

export const Route = createFileRoute("/_app/comunicados")({
  head: () => ({ meta: [{ title: "Comunicados — Painel GingApp" }] }),
  component: ComunicadosPage,
});
