import { createFileRoute } from "@tanstack/react-router";
import { EmConstrucao } from "@/components/painel/em-construcao";

// Fase 2b: substitua EmConstrucao pela página do módulo (src/modules/turmas/).
export const Route = createFileRoute("/_app/turmas")({
  head: () => ({ meta: [{ title: "Turmas — Painel GingApp" }] }),
  component: () => <EmConstrucao title="Turmas" />,
});
