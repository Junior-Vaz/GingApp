import { createFileRoute } from "@tanstack/react-router";
import { EmConstrucao } from "@/components/painel/em-construcao";

// Fase 2b: substitua EmConstrucao pela página do módulo (src/modules/comunicados/).
export const Route = createFileRoute("/_app/comunicados")({
  head: () => ({ meta: [{ title: "Comunicados — Painel GingApp" }] }),
  component: () => <EmConstrucao title="Comunicados" />,
});
