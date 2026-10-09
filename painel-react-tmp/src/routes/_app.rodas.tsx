import { createFileRoute } from "@tanstack/react-router";
import { EmConstrucao } from "@/components/painel/em-construcao";

// Fase 2b: substitua EmConstrucao pela página do módulo (src/modules/rodas/).
export const Route = createFileRoute("/_app/rodas")({
  head: () => ({ meta: [{ title: "Rodas — Painel GingApp" }] }),
  component: () => <EmConstrucao title="Rodas" />,
});
