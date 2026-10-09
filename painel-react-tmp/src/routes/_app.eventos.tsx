import { createFileRoute } from "@tanstack/react-router";
import { EmConstrucao } from "@/components/painel/em-construcao";

// Fase 2b: substitua EmConstrucao pela página do módulo (src/modules/eventos/).
export const Route = createFileRoute("/_app/eventos")({
  head: () => ({ meta: [{ title: "Eventos — Painel GingApp" }] }),
  component: () => <EmConstrucao title="Eventos" />,
});
