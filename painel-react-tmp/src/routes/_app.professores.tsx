import { createFileRoute } from "@tanstack/react-router";
import { EmConstrucao } from "@/components/painel/em-construcao";

// Fase 2b: substitua EmConstrucao pela página do módulo (src/modules/professores/).
export const Route = createFileRoute("/_app/professores")({
  head: () => ({ meta: [{ title: "Professores — Painel GingApp" }] }),
  component: () => <EmConstrucao title="Professores" />,
});
