import { createFileRoute } from "@tanstack/react-router";
import { EmConstrucao } from "@/components/painel/em-construcao";

// Fase 2b: substitua EmConstrucao pela página do módulo (src/modules/aulas/).
export const Route = createFileRoute("/_app/aulas")({
  head: () => ({ meta: [{ title: "Aulas — Painel GingApp" }] }),
  component: () => <EmConstrucao title="Aulas" />,
});
