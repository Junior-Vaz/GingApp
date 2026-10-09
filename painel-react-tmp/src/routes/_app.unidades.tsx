import { createFileRoute } from "@tanstack/react-router";
import { EmConstrucao } from "@/components/painel/em-construcao";

// Fase 2b: substitua EmConstrucao pela página do módulo (src/modules/unidades/).
export const Route = createFileRoute("/_app/unidades")({
  head: () => ({ meta: [{ title: "Unidades — Painel GingApp" }] }),
  component: () => <EmConstrucao title="Unidades" />,
});
